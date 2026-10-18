// Cockpit's state: the atoms the band and pane draw from, the snapshot they read, what each event changes,
// and what the buttons do (shrink, handoff, launch, keep-warm). Every read and write of an atom lives here.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import type { AgentCard, Launcher, Look, Notice, Pressed, Sample, Squeeze, Tone, TurnInfo, Usage, Warmth } from '../types'
import { DEFAULT_LOOK } from './art/glass'
import {
  FIVE_HOURS, MINUTE, WEEK,
  actNeeded, cacheTtl, cacheView, chatView, doingOf, fmtDuration, fmtTokens, guardDecision, holdLimit, isCold, isWarmPing, paceView, pingDelay,
  pushRecent, readSettings, startFreshReason, toUsage, togglePin,
} from './model'
import type { Act, CacheView, ChatView, PaceView, Settings } from './model'

export const PANE = 'cockpit'
export const PANE_TITLE = 'Control Center'
/** How every open asks for the pane: inline above the prompt it wants room for all five sections. */
export const PANE_OPEN = { id: PANE, title: PANE_TITLE, rows: 34 } as const
const NOTICE_MS = 20_000

const EMPTY_USAGE: Usage = { tokens: 0, window: 0, five: null, week: null, costUsd: null, isPlan: false }
const IDLE: TurnInfo = { startedAt: 0, tools: 0, isWorking: false, lastSeconds: null }
const COLD_START: Warmth = { lastRequestAt: 0, isCompacted: false, keepWarmUntil: 0, lastPing: null, stopped: null, ackedAt: 0 }

export const usage = atom({ plugin: 'cockpit', key: 'usage' } as const, EMPTY_USAGE)
export const turn = atom({ plugin: 'cockpit', key: 'turn' } as const, IDLE)
export const agents = atom({ plugin: 'cockpit', key: 'agents' } as const, [] as AgentCard[])
export const warmth = atom({ plugin: 'cockpit', key: 'warmth' } as const, COLD_START)
export const notice = atom({ plugin: 'cockpit', key: 'notice' } as const, null as Notice | null)
export const samples = atom({ plugin: 'cockpit', key: 'samples' } as const, [] as Sample[])
export const turnTokens = atom({ plugin: 'cockpit', key: 'turnTokens' } as const, [] as number[])
export const filter = atom({ plugin: 'cockpit', key: 'filter' } as const, '')
export const expanded = atom({ plugin: 'cockpit', key: 'expanded' } as const, null as string | null)
export const launcher = atom({ plugin: 'cockpit', key: 'launcher' } as const, { pinned: [], recent: [] } as Launcher)
export const tick = atom({ plugin: 'cockpit', key: 'tick' } as const, 0)
export const pressed = atom({ plugin: 'cockpit', key: 'pressed' } as const, null as Pressed | null)
export const look = atom({ plugin: 'cockpit', key: 'look' } as const, DEFAULT_LOOK as Look)
export const customizing = atom({ plugin: 'cockpit', key: 'customizing' } as const, false)
export const squeeze = atom({ plugin: 'cockpit', key: 'squeeze' } as const, null as Squeeze | null)

/**
 * Set once per load: the person's options and the compact point from their settings. `isPlan` decides the
 * auto cache life; it is remembered across sessions and assumed until a reply shows no plan limits.
 */
export const config: { settings: Settings; isPlan: boolean } = { settings: readSettings({}, undefined), isPlan: true }

export async function loadPlan($: EngineInterface) {
  const saved = await $.store.get('isPlan')
  if (typeof saved === 'boolean') config.isPlan = saved
}

async function learnPlan($: EngineInterface, isPlan: boolean) {
  if (config.isPlan === isPlan) return
  config.isPlan = isPlan
  await $.store.set('isPlan', isPlan)
}

export const ttlNow = () => cacheTtl(config.settings, config.isPlan)

// ── The snapshot every drawing reads ────────────────────────────────────────

export type View = {
  now: number
  usage: Usage
  settings: Settings
  ttl: number
  chat: ChatView
  cache: CacheView
  five: PaceView | null
  week: PaceView | null
  turn: TurnInfo
  agents: AgentCard[]
  warmth: Warmth
  notice: Notice | null
  act: Act | null
  freshReason: string | null
  isKeepingWarm: boolean
  pressed: Pressed | null
  look: Look
  isCustomizing: boolean
  squeeze: Squeeze | null
  tone: Tone
}

export async function snapshot($: EngineInterface): Promise<View> {
  await read($, tick)
  const now = await $.clock.now()
  const u = await read($, usage)
  const w = await read($, warmth)
  const n = await read($, notice)
  const settings = config.settings
  const ttl = ttlNow()
  const chat = chatView(u.tokens, settings.compactAt, u.window)
  const cache = cacheView(w.lastRequestAt, w.isCompacted, ttl, now, u.tokens, settings.guardTokens)
  const five = paceView(u.five, FIVE_HOURS, now)
  const week = paceView(u.week, WEEK, now)
  const tones = [chat.tone, cache.tone, five?.tone ?? 'fine']
  return {
    now, usage: u, settings, ttl, chat, cache, five, week,
    turn: await read($, turn),
    agents: await read($, agents),
    warmth: w,
    notice: n && now - n.at < NOTICE_MS ? n : null,
    act: actNeeded(chat, cache, five, u.tokens),
    freshReason: startFreshReason(chat, cache),
    isKeepingWarm: w.keepWarmUntil > now,
    pressed: await read($, pressed),
    look: await read($, look),
    isCustomizing: await read($, customizing),
    squeeze: await read($, squeeze),
    tone: tones.includes('act') ? 'act' : tones.includes('watch') ? 'watch' : 'fine',
  }
}

// ── The Control Center pane ─────────────────────────────────────────────────

/** Asks every drawing to redraw, so the band notices the pane opening or closing. */
export async function redraw($: EngineInterface) {
  await update($, tick, n => n + 1)
}

export async function isPaneOpen($: EngineInterface) {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

/** Whether the pane is open, for a drawing: it reads the redraw counter, so it is drawn again when that changes. */
export async function isPaneShown($: EngineInterface) {
  await read($, tick)
  return isPaneOpen($)
}

export async function openPane($: EngineInterface) {
  await $.ui.open(PANE_OPEN)
  await redraw($)
}

/** Opens the Control Center, or closes it when it is open. */
export async function togglePane($: EngineInterface) {
  if (await isPaneOpen($)) await $.ui.close({ id: PANE })
  else await openPane($)
  await redraw($)
}

// ── Readings ────────────────────────────────────────────────────────────────

/** Keeps the latest usage figures and a sample for the sparkline. */
export async function measure($: EngineInterface, raw: Parameters<typeof toUsage>[0]) {
  const fresh = toUsage(raw)
  const at = await $.clock.now()
  const prev = await read($, usage)
  // Limits seen earlier in this chat still mean a plan, so a reading without them (or a reload) keeps the 1-hour cache.
  if (fresh.isPlan || prev.five !== null || prev.week !== null) await learnPlan($, true)
  const u = { ...fresh, five: holdLimit(prev.five, fresh.five, at), week: holdLimit(prev.week, fresh.week, at) }
  await update($, usage, () => u)
  await update($, samples, list => [...list, { at, five: u.five?.percentUsed ?? null, tokens: u.tokens }].slice(-48))
}

// ── What the events change ──────────────────────────────────────────────────

export async function loadLauncher($: EngineInterface, saved: Launcher) {
  await update($, launcher, () => saved)
}

const isLook = (x: unknown): x is Look =>
  typeof x === 'object' && x !== null && typeof (x as Look).opacity === 'number' && ((x as Look).color === null || typeof (x as Look).color === 'string')

/** The look chosen in an earlier chat, kept across sessions like the launcher. */
export async function loadLook($: EngineInterface) {
  const saved = await $.store.get('look')
  if (isLook(saved)) await update($, look, () => saved)
}

/** Changes the glass's colour or opacity, here and in every chat after. */
export async function changeLook($: EngineInterface, change: Partial<Look>) {
  const next = await update($, look, l => ({ ...l, ...change }))
  await $.store.set('look', next)
  return next
}

/** Opens or closes the Appearance panel under the Control Center's grid. */
export async function toggleCustomize($: EngineInterface) {
  await update($, customizing, x => !x)
}

export async function isKeepWarmOn($: EngineInterface) {
  return (await read($, warmth)).keepWarmUntil > 0
}

/** /clear starts a new conversation: nothing measured before it still applies. */
export async function resetForClear($: EngineInterface) {
  generation++
  await update($, warmth, w => ({ ...w, lastRequestAt: 0, isCompacted: false, ackedAt: 0 }))
  await update($, turnTokens, () => [])
  await update($, agents, () => [])
}

/** A resumed chat brings its cache clock with it. */
export async function resumeCacheClock($: EngineInterface, secondsSince: number) {
  generation++
  const now = await $.clock.now()
  await update($, warmth, w => ({ ...w, lastRequestAt: now - secondsSince * 1000, isCompacted: false }))
}

export async function startTurn($: EngineInterface) {
  const startedAt = await $.clock.now()
  await update($, turn, () => ({ startedAt, tools: 0, isWorking: true, lastSeconds: null }))
}

export async function countTool($: EngineInterface) {
  await update($, turn, t => ({ ...t, tools: t.tools + 1 }))
}

/** A main-thread model request just went out: the cache clock restarts. */
export async function stampRequest($: EngineInterface) {
  const at = await $.clock.now()
  await update($, warmth, w => ({ ...w, lastRequestAt: at, isCompacted: false }))
}

/** How long the Context glass takes to drain while compacting, and to settle on the new level afterwards. */
export const DRAIN_MS = 40_000
export const SETTLE_MS = 1_200
/** What the drain leaves while the compaction is still running: a thin pool, not an empty glass. */
export const DRAIN_FLOOR = 3

/** Where a drain that began at `fromPct` stands `ms` in: a steady fall to the floor. */
export const drainLevel = (fromPct: number, ms: number) =>
  fromPct - (fromPct - Math.min(fromPct, DRAIN_FLOOR)) * Math.min(1, Math.max(0, ms / DRAIN_MS))

/** A compaction began: the Context glass starts draining from where it stands. */
export async function startSqueeze($: EngineInterface) {
  const at = await $.clock.now()
  const u = await read($, usage)
  const fromPct = chatView(u.tokens, config.settings.compactAt, u.window).pct
  await update($, squeeze, () => ({ startedAt: at, fromPct, doneAt: null, doneLevel: null }))
}

/** The compaction ended: settle on the new reading, or, when it did nothing, put the glass back. */
export async function endSqueeze($: EngineInterface, didCompact: boolean) {
  const at = await $.clock.now()
  await update($, squeeze, s => (s && didCompact ? { ...s, doneAt: at, doneLevel: drainLevel(s.fromPct, at - s.startedAt) } : null))
}

export async function isSqueezing($: EngineInterface) {
  const s = await read($, squeeze)
  return s !== null && s.doneAt === null
}

export async function agentStep($: EngineInterface, id: string, model: string, spent: number, effort?: string | number) {
  await update($, agents, list =>
    list.map(a => (a.id === id ? { ...a, model, steps: a.steps + 1, tokens: a.tokens + spent, effort: effort ?? a.effort ?? null } : a)),
  )
}

/** What a subagent is doing now, from the tool it just called. */
export async function agentTool($: EngineInterface, id: string, tool: string, input: Readonly<Record<string, unknown>>) {
  const doing = doingOf(tool, input)
  await update($, agents, list => (list.some(a => a.id === id) ? list.map(a => (a.id === id ? { ...a, tool, doing } : a)) : list))
}

export async function agentDone($: EngineInterface, id: string, isAnswered: boolean) {
  const now = await $.clock.now()
  await update($, agents, list =>
    list.map(a => (a.id === id ? { ...a, status: isAnswered ? 'done' : 'failed', endedAt: now } : a)),
  )
}

export async function agentStarted($: EngineInterface, card: Omit<AgentCard, 'startedAt'>) {
  const startedAt = await $.clock.now()
  await update($, agents, list => [...list.filter(a => a.id !== card.id), { ...card, startedAt }].slice(-20))
}

/** The main turn ended: the timer stops, the cache clock settles, the forecast gets a reading. */
export async function finishTurn($: EngineInterface, e: { durationMs: number; isAborted: boolean; hasUsage: boolean }) {
  const now = await $.clock.now()
  const t = await read($, turn)
  const took = t.startedAt > 0 ? Math.round((now - t.startedAt) / 1000) : null
  await update($, turn, x => ({ ...x, isWorking: false, lastSeconds: took }))
  // Only a turn the API answered touched the cache; an aborted or failed one (no usage) did not.
  await update($, warmth, w => ({
    ...w,
    lastRequestAt: e.hasUsage && now - w.lastRequestAt > e.durationMs ? now : w.lastRequestAt,
    isCompacted: false,
    ackedAt: 0,
  }))
  const after = toUsage(await $.session.usage())
  const tokens = after.tokens
  // A real reply that reported no plan limits, in a chat that never showed any, means an API key: the cache lives 5 minutes.
  const held = await read($, usage)
  if (e.hasUsage && !after.isPlan && held.five === null && held.week === null) await learnPlan($, false)
  if (tokens > 0) await update($, turnTokens, list => [...list, tokens].slice(-16))
  if (took !== null && took >= 60) $.ui.toast(`Done in ${fmtDuration(took * 1000)} · ${t.tools} tool call${t.tools === 1 ? '' : 's'}`)
}

/** The chat was compacted: the context reading drops at once, to core's count when it gives one. */
export async function markCompacted($: EngineInterface, tokensAfter?: number) {
  generation++
  await update($, warmth, w => ({ ...w, isCompacted: true, ackedAt: 0 }))
  await update($, turnTokens, () => [])
  await measure($, await $.session.usage())
  if (tokensAfter !== undefined) await update($, usage, u => ({ ...u, tokens: tokensAfter }))
}

/** The cold-send guard's verdict on one prompt, and the words for it. */
export async function judgePrompt($: EngineInterface, originKind: string, text: string) {
  const w = await read($, warmth)
  const u = await read($, usage)
  const now = await $.clock.now()
  const ttl = ttlNow()
  const decision = guardDecision({
    isCold: isCold(w.lastRequestAt, w.isCompacted, ttl, now),
    tokens: u.tokens,
    guardTokens: config.settings.guardTokens,
    originKind,
    text,
    ackedAt: w.ackedAt,
    lastRequestAt: w.lastRequestAt,
  })
  // Held once: the same message sent again goes through.
  if (decision === 'drop') await update($, warmth, x => ({ ...x, ackedAt: x.lastRequestAt }))
  const why = `the cache went cold ${fmtDuration(now - w.lastRequestAt - ttl)} ago and this chat is ${fmtTokens(u.tokens)}, so this message re-reads all of it`
  return { decision, why }
}

export async function toggleExpanded($: EngineInterface, id: string) {
  await update($, expanded, cur => (cur === id ? null : id))
}

export async function setFilter($: EngineInterface, text: string) {
  await update($, filter, () => text)
}

/** What the pane draws beyond the shared snapshot. */
export async function paneExtras($: EngineInterface) {
  return {
    turnTokens: await read($, turnTokens),
    samples: await read($, samples),
    query: await read($, filter),
    launcher: await read($, launcher),
    open: await read($, expanded),
  }
}

export async function readTurnTokens($: EngineInterface) {
  return read($, turnTokens)
}

// ── Notices ─────────────────────────────────────────────────────────────────

export async function say($: EngineInterface, text: string, tone: Tone) {
  const at = await $.clock.now()
  await update($, notice, () => ({ text, tone, at }))
  // The desktop Control Center draws no text lines: there the notice is the app's own toast.
  try {
    if ((await $.session.surfaces()).some(x => x !== 'terminal')) $.ui.toast(text)
  } catch {}
  $.clock.after(NOTICE_MS, () => {
    void update($, notice, n => (n && n.at === at ? null : n))
  })
}

const errText = (err: unknown) => String(err instanceof Error ? err.message : err).slice(0, 160)

// ── Actions ─────────────────────────────────────────────────────────────────

/** A second press this soon after the first is the same press: a double click acts once. */
const PRESS_SETTLE_MS = 800

/**
 * Runs a Control Center action once per press: lights its tile at once, ignores the same key again while it
 * runs or within the settle time, and marks it done when its work resolves.
 */
export async function pressOnce($: EngineInterface, key: string, work: () => Promise<unknown>) {
  const now = await $.clock.now()
  const last = await read($, pressed)
  if (last && last.key === key && (last.isBusy || now - last.at < PRESS_SETTLE_MS)) return
  await update($, pressed, () => ({ key, at: now, isBusy: true }))
  try {
    await work()
  } finally {
    await update($, pressed, p => (p && p.key === key && p.at === now ? { ...p, isBusy: false } : p))
  }
}

const KEEP =
  'Keep: the current goal, decisions made and why, key file paths, what is done, what is left, and the exact next step.'

const QUICK_HANDOFF =
  'Write a short handoff note right here in the chat, no files: the goal, where things stand, and the exact next step, as one block I can paste as the first message of a fresh chat. Keep it under 12 lines.'

const FULL_HANDOFF =
  'Prepare a full handoff. First check git status and the last few commits. Then write HANDOFF.md in the project root (do not commit it) with: the goal, what is done, what is left, key files, decisions made and why, the git state, and three numbered next steps. Finish with one short line I can paste as the first message of a fresh chat.'

export async function shrink($: EngineInterface) {
  const before = (await read($, usage)).tokens
  await say($, 'Shrinking the chat. This can take up to a minute.', 'watch')
  try {
    await $.command.run({ command: 'compact', args: KEEP })
    const after = toUsage(await $.session.usage()).tokens
    await say($, before && after ? `Chat shrunk from ${fmtTokens(before)} to ${fmtTokens(after)}.` : 'Chat shrunk. The summary is in the chat above.', 'fine')
  } catch (err) {
    await say($, `Shrink failed: ${errText(err)}`, 'act')
  }
}

export async function handoff($: EngineInterface, kind: 'quick' | 'full') {
  await say($, kind === 'quick' ? 'Writing a quick handoff note.' : 'Writing HANDOFF.md with the git state and next steps.', 'watch')
  try {
    await $.prompt.submit({ text: kind === 'quick' ? QUICK_HANDOFF : FULL_HANDOFF })
  } catch (err) {
    await say($, `Handoff failed: ${errText(err)}`, 'act')
  }
}

export async function remember($: EngineInterface, name: string) {
  const next = await update($, launcher, l => ({ ...l, recent: pushRecent(l.recent, name) }))
  await $.store.set('launcher', next)
}

export async function launch($: EngineInterface, name: string) {
  await remember($, name)
  try {
    await $.command.run({ command: name })
  } catch (err) {
    await say($, `/${name} failed: ${errText(err)}`, 'act')
  }
}

export async function pin($: EngineInterface, name: string) {
  const next = await update($, launcher, l => ({ ...l, pinned: togglePin(l.pinned, name) }))
  await $.store.set('launcher', next)
}

/** The person chose to pay the cold re-read: the guard lets the next message through. */
export async function sendAnyway($: EngineInterface) {
  await update($, warmth, w => ({ ...w, ackedAt: w.lastRequestAt }))
  await say($, 'Your next message goes through and re-reads the chat once.', 'watch')
}

// ── Keep-warm: a tiny ping over the cached chat before the cache would expire ──

const PING_PROMPT = 'Reply with the single word: warm'
const MAX_RETRIES = 2

let pending: Timer | null = null
let inFlight = false
let generation = 0
let retries = 0

export async function setKeepWarm($: EngineInterface, isOn: boolean) {
  const now = await $.clock.now()
  generation++
  retries = 0
  await update($, warmth, w => ({ ...w, keepWarmUntil: isOn ? now + config.settings.keepWarmMs : 0, stopped: null }))
  if (isOn) await say($, `Keeping the cache warm for ${fmtDuration(config.settings.keepWarmMs)}. Each ping is a small model request.`, 'fine')
  await armKeepWarm($)
}

async function stopKeepWarm($: EngineInterface, why: string) {
  generation++
  pending?.cancel()
  pending = null
  await update($, warmth, w => ({ ...w, keepWarmUntil: 0, stopped: why }))
  await say($, `Keep-warm stopped: ${why}.`, 'watch')
}

/** Sets the one timer: a ping before the cache would cool, or the window's end. */
export async function armKeepWarm($: EngineInterface) {
  pending?.cancel()
  pending = null
  const w = await read($, warmth)
  const now = await $.clock.now()
  if (!w.keepWarmUntil) return
  if (now >= w.keepWarmUntil) {
    await update($, warmth, x => ({ ...x, keepWarmUntil: 0 }))
    return
  }
  const ttl = ttlNow()
  // Nothing to keep warm yet (or any more): wait for the next turn, which arms again.
  if (!w.lastRequestAt || w.isCompacted || isCold(w.lastRequestAt, w.isCompacted, ttl, now)) {
    pending = $.clock.after(w.keepWarmUntil - now, () => void armKeepWarm($))
    return
  }
  const delay = Math.min(w.keepWarmUntil - now, pingDelay(w.lastRequestAt, ttl, now))
  pending = $.clock.after(delay, () => void ping($))
}

async function ping($: EngineInterface) {
  pending = null
  if (inFlight) return
  const w = await read($, warmth)
  const now = await $.clock.now()
  const ttl = ttlNow()
  if (!w.keepWarmUntil || now >= w.keepWarmUntil || !w.lastRequestAt || w.isCompacted || isCold(w.lastRequestAt, false, ttl, now)) {
    return armKeepWarm($)
  }
  // A request since the timer was set moved the cache clock: schedule from it instead.
  if (pingDelay(w.lastRequestAt, ttl, now) > 1000) return armKeepWarm($)
  const gen = generation
  const sentFor = w.lastRequestAt
  inFlight = true
  const reply = await $.model.fork({ prompt: PING_PROMPT }).catch((err: unknown) => ({ isAnswered: false as const, reason: 'error' as const, err }))
  inFlight = false
  const at = await $.clock.now()
  if (gen !== generation || (await read($, warmth)).lastRequestAt !== sentFor) return armKeepWarm($)
  if (!reply.isAnswered) {
    if (reply.reason === 'nothing-to-fork') return
    if (reply.reason === 'api-error' && (reply.status === null || reply.status === 429 || reply.status >= 500) && retries < MAX_RETRIES) {
      retries++
      pending = $.clock.after(MINUTE, () => void ping($))
      return
    }
    return stopKeepWarm($, reply.reason === 'error' ? `the ping failed (${errText(reply.err)})` : `the ping came back with ${reply.reason}`)
  }
  retries = 0
  const isWarm = isWarmPing(reply.usage)
  await update($, warmth, x => ({
    ...x,
    lastPing: { at, read: reply.usage.cache_read_input_tokens, isWarm },
    lastRequestAt: isWarm ? at : x.lastRequestAt,
  }))
  if (!isWarm) return stopKeepWarm($, 'the cache had already expired when it pinged')
  await armKeepWarm($)
}

// ── The redraw timer ────────────────────────────────────────────────────────

let ticker: Timer | null = null
let tickEvery = 0

/** Every 5s while a turn runs (its timer shows), every 30s while the cache countdown shows, otherwise never. */
export async function pace($: EngineInterface) {
  const t = await read($, turn)
  const w = await read($, warmth)
  const now = await $.clock.now()
  const isCounting = (w.lastRequestAt > 0 && !w.isCompacted && now - w.lastRequestAt < ttlNow()) || w.keepWarmUntil > now
  const want = t.isWorking ? 5_000 : isCounting ? 30_000 : 0
  if (want === tickEvery) return
  ticker?.cancel()
  ticker = null
  tickEvery = want
  if (want) ticker = $.clock.every(want, () => void onTick($))
}

async function onTick($: EngineInterface) {
  await update($, tick, n => n + 1)
  await pace($)
}

/** A /clear, a resume or compaction replaced what an in-flight ping was sent for. */
export function outdatePing() {
  generation++
}
