// Cockpit v2: the wiring. Each event hands its facts to state.ts; the band and the pane redraw from state.
// Redraws are event-driven (session.measure, turns, tools); `pace` runs a timer only while a countdown shows.

import type { Register } from 'claude-code'

import type { Launcher } from '../types'
import { GLASS_COLORS, parseColor, parseOpacity } from './art/glass'
import { drawBand } from './band'
import { drawLaunch, presses } from './glass'
import { readSettings } from './model'
import { drawPane } from './pane'
import {
  PANE,
  agentDone, agentStarted, agentStep, agentTool, armKeepWarm, config, countTool, endSqueeze, finishTurn, isKeepWarmOn, isSqueezing, judgePrompt,
  changeLook, loadLauncher, loadLook, loadPlan, markCompacted, measure, pace, paneExtras, pin, readTurnTokens, remember, resetForClear,
  isPaneOpen, isPaneShown, openPane, redraw, resumeCacheClock, setKeepWarm, snapshot, stampRequest, startSqueeze, startTurn, togglePane,
} from './state'

const isLauncher = (x: unknown): x is Launcher =>
  typeof x === 'object' && x !== null && Array.isArray((x as Launcher).pinned) && Array.isArray((x as Launcher).recent)

/** A pad's press and release can both arrive for one click (after a redraw); the second within this is the same. */
const PAD_SETTLE_MS = 400
const lastPadPress = new Map<string, number>()

export const register: Register = (on, options) => {
  config.settings = readSettings(options, undefined)

  on('session.start', async ($, e, next) => {
    const settings = await $.settings.read().catch(() => ({}) as Record<string, unknown>)
    config.settings = readSettings(options, settings.autoCompactWindow)
    await loadPlan($)
    await loadLook($)
    const saved = await $.store.get('launcher')
    if (isLauncher(saved)) await loadLauncher($, saved)
    await measure($, await $.session.usage())
    await $.command.register({
      name: 'cockpit',
      description: 'Open the Control Center: chat, cache, limits, agents, handoff and the launcher',
      argumentHint: '[color <name|#hex|none> | opacity <0-100|clear|tinted> | keepwarm on|off | pin <command>]',
    })
    if (config.settings.keepWarm && !(await isKeepWarmOn($))) await setKeepWarm($, true)
    else await armKeepWarm($)
    await pace($)
    if (config.settings.openAtStart) await openPane($)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear') await resetForClear($)
    else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      await resumeCacheClock($, e.seconds_since_last_response)
    }
    await armKeepWarm($)
    await pace($)
    return r
  })

  on('session.measure', async ($, e, next) => {
    await measure($, e)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await startTurn($)
      await pace($)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!e.agentId) await countTool($)
    else await agentTool($, e.agentId, e.tool, e as Readonly<Record<string, unknown>>)
    return next(e)
  })

  // Each answered model request: the main thread's restarts the cache clock; a subagent's fills in its card.
  // A request with no response (a login or network error) cached nothing, so it leaves the clock alone.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const u = r.usage
    // The compaction's own request reads the old chat, whose cache it is about to make useless: no restart for it.
    if (!e.agentId && u && !(await isSqueezing($))) await stampRequest($)
    if (e.agentId && u) {
      await agentStep($, e.agentId, u.model || e.model, u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, e.effort)
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) {
      await agentDone($, e.agentId, e.reason === 'answer')
      return r
    }
    await finishTurn($, { durationMs: e.durationMs, isAborted: e.isAborted, hasUsage: e.usage !== undefined })
    await armKeepWarm($)
    await pace($)
    return r
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started
    await agentStarted($, {
      id: started.agentId ?? e.tool_use_id,
      type: e.subagentType,
      description: e.description,
      model: started.model,
      status: 'running',
      endedAt: null,
      steps: 0,
      tokens: 0,
    })
    return started
  })

  on('session.compact', async ($, e, next) => {
    const isMain = !e.agentId && e.trigger !== 'precompute'
    if (isMain) await startSqueeze($)
    let didCompact = false
    try {
      const r = await next(e)
      if (isMain && r.skip === undefined) {
        didCompact = true
        await markCompacted($, r.tokensAfter)
        await armKeepWarm($)
      }
      return r
    } finally {
      if (isMain) await endSqueeze($, didCompact)
    }
  })

  // The cold-send guard: the first message after the cache went cold on a big chat is held once, with the reason.
  on('prompt.submit', async ($, e, next) => {
    const { decision, why } = await judgePrompt($, e.origin.kind, e.text)
    if (decision === 'warn') $.ui.log(`Cockpit: ${why}. Sending anyway, since nobody can resend this ${e.origin.kind} message.`)
    if (decision !== 'drop') return next(e)
    return { drop: `Cockpit held this message: ${why}. Send it again to go ahead, or press Compact first in the band.` }
  })

  on('command.run', { command: 'cockpit' }, async ($, e) => {
    const [verb, arg] = e.args.trim().split(/\s+/)
    if (verb === 'keepwarm' && (arg === 'on' || arg === 'off')) {
      await setKeepWarm($, arg === 'on')
      return { text: arg === 'on' ? 'Keep-warm is on.' : 'Keep-warm is off.' }
    }
    if (verb === 'color' || verb === 'colour') {
      const color = arg ? parseColor(arg) : undefined
      if (color === undefined) return { text: `Colours: ${Object.keys(GLASS_COLORS).join(', ')}, a #rrggbb, or none.` }
      await changeLook($, { color })
      return { text: color ? `Control Center glass tinted ${arg}.` : 'Control Center glass back to neutral.' }
    }
    if (verb === 'opacity') {
      const opacity = arg ? parseOpacity(arg) : undefined
      if (opacity === undefined) return { text: 'Opacity: 0 (clear) to 100 (solid), or clear, tinted or default.' }
      await changeLook($, { opacity })
      return { text: `Control Center glass at ${opacity}% opacity.` }
    }
    if (verb === 'pin' && arg) {
      const name = arg.replace(/^\//, '')
      await pin($, name)
      return { text: `Toggled the pin on /${name}.` }
    }
    await togglePane($)
    return { text: (await isPaneOpen($)) ? 'Control Center opened.' : 'Control Center closed. /cockpit brings it back.' }
  })

  // Commands the person runs land in the launcher's Recent group.
  on('command.run', async ($, e, next) => {
    if (e.origin.kind === 'composer' && e.command !== 'cockpit') await remember($, e.command)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // On the desktop the Control Center is the display, so the band stays empty; /cockpit opens and closes it.
    if (e.surface !== 'terminal') return next(e)
    const v = await snapshot($)
    const turnTokens = await readTurnTokens($)
    return drawBand($, $.ui.resolve(e), { bodyColumns: e.props.bodyColumns, isWorking: e.props.isWorking, isTerminal: e.surface === 'terminal' }, v, turnTokens)
  })

  // On the desktop, a button after the footer's mode labels opens the Control Center and, open, closes it.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const els = $.ui.resolve(e)
    return drawLaunch(els, e.props.modes, await isPaneShown($), () => void togglePane($))
  })

  // A pad over a glass tile was pressed (./pad.tsx): run what that tile does.
  on('ui.message', async ($, e, next) => {
    const press = presses.get(e.element)
    if (!press || (e.data as { press?: unknown } | null)?.press !== true) return next(e)
    const now = await $.clock.now()
    if (now - (lastPadPress.get(e.element) ?? 0) < PAD_SETTLE_MS) return {}
    lastPadPress.set(e.element, now)
    press()
    return {}
  })

  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE) await redraw($)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const v = await snapshot($)
    const commands = (await $.command.list()).map(c => ({ name: c.name, description: c.description }))
    const extras = await paneExtras($)
    return drawPane($, $.ui.resolve(e), { bodyColumns: e.props.bodyColumns, isTerminal: e.surface === 'terminal', commands, ...extras }, v)
  })
}
