// The Liquid Glass Control Center, for surfaces that draw `Svg` (the desktop app). The terminal keeps the text pane.
// A sandboxed SVG takes no presses, so each pressable tile has a pad laid over it: a Client that draws nothing
// and posts on a press (./pad.tsx), so no hover band shows. A surface without Client gets a small Button instead.

import type { Elements, EngineInterface } from 'claude-code'

import type { AgentCard } from '../types'
import type { AgentArt, CacheArt, ContextArt, GaugeArt, RoundArt, TankArt } from './art/tiles'
import { GLASS_COLORS, phased, setLook } from './art/glass'
import { FULL, GAP, agentsTile, appearanceTile, cacheTile, contextTile, gaugeTile, opacityTile, roundTile, swatchTile, tankTile } from './art/tiles'
import { MINUTE, fmtDuration, fmtTokens, turnsLeft, turnsWords } from './model'
import type { PaceView } from './model'
import { DRAIN_MS, SETTLE_MS, changeLook, drainLevel, handoff, pressOnce, setKeepWarm, shrink, toggleCustomize } from './state'
import type { View } from './state'

// ── From Cockpit's snapshot to the tiles' figures ───────────────────────────

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function contextArt(v: View, turnTokens: readonly number[]): ContextArt {
  return {
    pct: v.chat.pct,
    tokens: fmtTokens(v.usage.tokens),
    compactAt: fmtTokens(v.settings.compactAt),
    forecast: turnsWords(turnsLeft(turnTokens, v.usage.tokens, v.settings.compactAt)),
    tone: v.chat.tone,
    isWorking: v.turn.isWorking,
    ...squeezeArt(v),
  }
}

/** While compacting the glass drains toward empty; once done it settles on the new level, then stands still. */
function squeezeArt(v: View): Pick<ContextArt, 'drain' | 'isCompacting'> {
  const s = v.squeeze
  if (!s) return {}
  if (s.doneAt === null) {
    return { isCompacting: true, drain: { fromPct: s.fromPct, toPct: drainLevel(s.fromPct, DRAIN_MS), durS: DRAIN_MS / 1000, sinceS: (v.now - s.startedAt) / 1000 } }
  }
  const since = v.now - s.doneAt
  if (since >= SETTLE_MS || s.doneLevel === null) return {}
  return { drain: { fromPct: s.doneLevel, toPct: v.chat.pct, durS: SETTLE_MS / 1000, sinceS: since / 1000 } }
}

export function fiveArt(p: PaceView | null): GaugeArt {
  if (!p) return { label: '5-hour', left: null, status: '', detail: 'Figures come with the first reply', tone: 'fine' }
  const refill = `refills in ${fmtDuration(p.resetsInMs)}`
  const leftAtRefill = p.projected === null || p.runsOutInMs !== null ? null : Math.max(0, 100 - p.projected)
  if (leftAtRefill !== null) {
    return { label: '5-hour', left: Math.max(0, 100 - p.pct), status: `≈${leftAtRefill}% left at refill`, detail: `in ${fmtDuration(p.resetsInMs)}`, tone: p.tone, leftAtRefill }
  }
  const status = p.pct >= 100 ? 'Empty' : p.runsOutInMs ? `Empty in ${fmtDuration(p.runsOutInMs)}` : cap(p.short)
  return { label: '5-hour', left: Math.max(0, 100 - p.pct), status, detail: refill, tone: p.tone }
}

export function weekArt(p: PaceView | null): TankArt {
  if (!p) return { label: 'Week', left: null, caption: 'no figures', tone: 'fine' }
  return { label: 'Week', left: Math.max(0, 100 - p.pct), caption: `left · ${fmtDuration(p.resetsInMs).split(' ')[0]}`, tone: p.tone }
}

const coldFor = (ms: number) => (ms < MINUTE ? '<1m' : fmtDuration(Math.floor(ms / MINUTE) * MINUTE))

export function cacheArt(v: View): CacheArt {
  const { cache, warmth, ttl, now } = v
  // Whole minutes, so the thermometer's picture changes once a minute and its frame is not reloaded on every tick.
  const leftMin = Math.ceil(cache.leftMs / MINUTE)
  if (cache.kind === 'warm') return { kind: 'warm', leftFrac: (leftMin * MINUTE) / ttl, value: fmtDuration(leftMin * MINUTE), caption: 'warm', isKeptWarm: v.isKeepingWarm, tone: cache.tone }
  if (cache.kind === 'cold') return { kind: 'cold', leftFrac: 0, value: coldFor(now - warmth.lastRequestAt - ttl), caption: 'cold', isKeptWarm: v.isKeepingWarm, tone: cache.tone }
  return { kind: 'none', leftFrac: 0, value: '—', caption: warmth.isCompacted ? 'compacted' : 'idle', isKeptWarm: v.isKeepingWarm, tone: 'fine' }
}

/** Whole minutes only, so a working agent's card changes once a minute rather than on every tick. */
const minutes = (ms: number) => (ms < 60_000 ? '<1m' : fmtDuration(Math.floor(ms / 60_000) * 60_000))

export function agentArt(a: AgentCard, now: number): AgentArt {
  const took = minutes((a.endedAt ?? now) - a.startedAt)
  const state = a.status === 'running' ? 'running' : a.status === 'done' ? 'done' : 'failed'
  const doing = state === 'running' ? (a.doing ?? 'Starting') : state === 'done' ? `Done in ${took}` : 'Stopped'
  const stats = `${fmtTokens(a.tokens)} tokens · ${a.steps} step${a.steps === 1 ? '' : 's'}`
  return { id: a.id, type: a.type || 'agent', model: a.model, effort: a.effort ?? null, state, tool: a.tool, doing, elapsed: took, task: a.description, stats }
}

/** The agents at work, oldest first; a finished one leaves the stage. */
export function crew(v: View): AgentArt[] {
  return v.agents.filter(a => a.status === 'running').map(a => agentArt(a, v.now))
}

export function crewSummary(v: View): string {
  const running = v.agents.filter(a => a.status === 'running').length
  const done = v.agents.length - running
  if (!v.agents.length) return 'Idle'
  return [running ? `${running} working` : '', done ? `${done} done` : ''].filter(Boolean).join(' · ')
}

// ── Drawing ─────────────────────────────────────────────────────────────────

/** What the glass drawings need of a surface: the elements every Svg surface carries. */
type SvgEls = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Svg'> & Partial<Pick<Elements['desktop'], 'Client'>>

const size = (source: string) => {
  const m = /width="([\d.]+)" height="([\d.]+)"/.exec(source)
  return { width: Number(m?.[1] ?? 0) || undefined, height: Number(m?.[2] ?? 0) || undefined }
}

/**
 * Each frame's picture and the moment its loops were set. An unchanged picture in an unchanged layout keeps its
 * source, so the frame isn't reloaded; a changed one, or any frame after the layout changed, is set afresh.
 */
const frames = new Map<string, { art: string; source: string }>()
let drawNow = 0
let isNewLayout = false
let lastLayout = ''

/** One glass tile: its own sandboxed, animated SVG at its own pixel size. */
export function glassEl(Svg: SvgEls['Svg'], art: string, alt: string, key?: string) {
  let source = art
  if (key) {
    const was = frames.get(key)
    source = was && was.art === art && !isNewLayout ? was.source : phased(art, drawNow / 1000)
    frames.set(key, { art, source })
  }
  return <Svg key={key} source={source} alt={alt} isInteractive {...size(art)} />
}

/** U+2800, a blank that is not whitespace: it keeps its width, so a run of them is a clickable span. */
const BLANK = '\u2800'
const CLEAR = { color: 'transparent', backgroundColor: 'transparent', inverse: false } as const

/** Where a fallback Button sits: over a round button's icon; over a swatch's disc. */
const ON_ICON = { left: 3, top: 2 }
const ON_SWATCH = { left: 1, top: 1 }

/** A pad's reach in cells (about 8 px wide, 17 px tall): a round button (76 px); a swatch (42 px). */
const ROUND_PAD = { width: 9, height: 4 }
const SWATCH_PAD = { width: 5, height: 2 }

type Hit = { key: string; onPress: () => void; pad?: { width: number; height: number }; at?: { left: number; top: number }; cells?: number }

/** What each pad on show does, by its key; refilled on every draw, answered at `ui.message`. */
export const presses = new Map<string, () => void>()

/**
 * A pressable tile: the glass with a pad over all of it. The pad is a Client drawing nothing, so the desktop
 * draws no hover; the tile's `alt` names it. Without Client, a plain Button of transparent blanks over the icon.
 */
function pressable(els: SvgEls, tileSvg: string, alt: string, hit: Hit) {
  const { Box, Button, Client, Svg, Text } = els
  const padKey = `pad-${hit.key}`
  const pad = hit.pad ?? ROUND_PAD
  presses.set(padKey, hit.onPress)
  return (
    <Box key={`tile-${hit.key}`} position="relative" flexDirection="column">
      {glassEl(Svg, tileSvg, alt, `svg-${hit.key}`)}
      {Client ? (
        <Box position="absolute" left={0} top={0} width={pad.width} height={pad.height}>
          <Client key={padKey} width={pad.width} height={pad.height} module="./pad.tsx" props={{ rows: pad.height }} />
        </Box>
      ) : (
        <Box position="absolute" {...(hit.at ?? ON_ICON)}>
          <Button key={hit.key} plain hover={CLEAR} onPress={hit.onPress}>
            <Text color="transparent" hover={CLEAR}>{BLANK.repeat(hit.cells ?? 4)}</Text>
          </Button>
        </Box>
      )}
    </Box>
  )
}

/**
 * The footer's mode labels with the Control Center's button after them, at the right of the prompt: control
 * two switches (⚌) while it is closed, a × while it is open, both white. The footer draws text and buttons only, no Svg.
 */
export function drawLaunch(els: Pick<SvgEls, 'Box' | 'Button' | 'Text'>, modes: readonly string[], isOpen: boolean, toggle: () => void) {
  const { Box, Button, Text } = els
  return (
    <Box key="launch-row" flexDirection="row" alignItems="center" gap={1}>
      {modes.length ? <Text dimColor>{modes.join(' & ')}</Text> : null}
      <Button key="launch" plain onPress={toggle}>
        <Text color="#FFFFFF" size="heading" weight="semibold">{isOpen ? '✕' : '⚌'}</Text>
      </Button>
    </Box>
  )
}

const isBusy = (v: View, key: string) => v.pressed?.key === key && v.pressed.isBusy

/** The steps the opacity row offers: Apple's clear and tinted, and between. */
const OPACITY_STEPS = [0, 20, 40, 58, 80, 100]

/** The Appearance panel: every colour, then the opacity steps, each a tap; the chosen ones ringed. */
function drawAppearance($: EngineInterface, els: SvgEls, v: View) {
  const { Box, Svg } = els
  const colors: [string, string | null][] = [['none', null], ...Object.entries(GLASS_COLORS)]
  const swatch = ([name, color]: [string, string | null]) =>
    pressable(els, swatchTile({ color, name, isSelected: v.look.color === color }), `Glass colour ${name}`, {
      key: `color-${name}`, pad: SWATCH_PAD, at: ON_SWATCH, cells: 3, onPress: () => void changeLook($, { color }),
    })
  const step = (opacity: number) =>
    pressable(els, opacityTile({ opacity, color: v.look.color, isSelected: v.look.opacity === opacity }), `Glass opacity ${opacity}%`, {
      key: `opacity-${opacity}`, pad: SWATCH_PAD, at: ON_SWATCH, cells: 3, onPress: () => void changeLook($, { opacity }),
    })
  return (
    <Box key="appearance" position="relative" flexDirection="column">
      {glassEl(Svg, appearanceTile(), 'Appearance', 'svg-appearance')}
      <Box position="absolute" left={1} top={2} flexDirection="column">
        <Box flexDirection="row">{colors.slice(0, 7).map(swatch)}</Box>
        <Box flexDirection="row">{colors.slice(7).map(swatch)}</Box>
        <Box flexDirection="row">{OPACITY_STEPS.map(step)}</Box>
      </Box>
    </Box>
  )
}

/** The agents column's width: beside the grid when the pane has room for it, else below at the grid's width. */
export function agentsWidth(bodyColumns: number): { width: number; isBeside: boolean } {
  const spare = Math.round(bodyColumns * CELL_PX) - FULL - GAP
  return spare >= 240 ? { width: Math.min(spare, 380), isBeside: true } : { width: FULL, isBeside: false }
}

/** About how many CSS pixels a desktop cell is. */
const CELL_PX = 8

export function drawGlassTiles($: EngineInterface, els: SvgEls, v: View, turnTokens: readonly number[], bodyColumns = 0) {
  const { Box, Svg } = els
  setLook(v.look)
  presses.clear()
  const chatBig = v.chat.pct >= 60 || v.act?.kind === 'full' || v.act?.kind === 'cold'
  const ctx = contextArt(v, turnTokens)
  const five = fiveArt(v.five)
  const week = weekArt(v.week)
  const cache = cacheArt(v)
  const warmLeft = v.warmth.keepWarmUntil - v.now
  const compactArt: RoundArt = {
    kind: 'compact', isBusy: isBusy(v, 'shrink'), isSuggested: chatBig,
    title: isBusy(v, 'shrink') ? 'Compacting…' : 'Compact: summarise this chat to free room',
  }
  const handoffArt: RoundArt = {
    kind: 'handoff', isBusy: isBusy(v, 'handoff'), isSuggested: v.freshReason !== null,
    title: 'Handoff: checks git, writes HANDOFF.md with next steps, and gives you a line to start a fresh chat',
  }
  const warmArt: RoundArt = {
    kind: 'warm', isOn: v.isKeepingWarm,
    title: v.isKeepingWarm
      ? `Keep warm is on for ${fmtDuration(warmLeft)}: a tiny ping before the cache expires keeps this chat cheap to come back to.`
      : 'Keep warm: a tiny ping before the cache expires, so coming back to this chat stays cheap. Each ping is a small request.',
  }
  const lookArt: RoundArt = { kind: 'look', isOn: v.isCustomizing, title: v.isCustomizing ? 'Done customizing' : 'Customize the glass: colour and opacity' }
  const side = agentsWidth(bodyColumns)
  // A change of layout can reload every frame, so each is set to the clock afresh.
  const layout = `${v.isCustomizing}|${bodyColumns}`
  drawNow = v.now
  isNewLayout = layout !== lastLayout
  lastLayout = layout
  return (
    <Box key="glass" flexDirection="row" flexWrap="wrap" alignItems="flex-start">
      <Box key="grid" flexDirection="column" alignItems="flex-start">
        <Box key="row-1" flexDirection="row">
          {glassEl(Svg, contextTile(ctx), `Context ${ctx.pct}% of the way to auto-compact, ${ctx.tokens} of ${ctx.compactAt}. ${ctx.forecast}`, 'svg-context')}
          {glassEl(Svg, gaugeTile(five), `5-hour limit ${five.left === null ? 'unknown' : `${five.left}% left`}: ${five.status ? `${five.status}, ` : ''}${five.detail}`, 'svg-five')}
        </Box>
        <Box key="row-2" flexDirection="row" alignItems="flex-start">
          {glassEl(Svg, cacheTile(cache), `Cache ${cache.caption}: ${cache.value}`, 'svg-cache')}
          {glassEl(Svg, tankTile(week), `Weekly limit ${week.left === null ? 'unknown' : `${week.left}% left`}, refills in ${week.caption.replace('left · ', '')}`, 'svg-week')}
          <Box flexDirection="column">
            <Box flexDirection="row">
              {pressable(els, roundTile(compactArt), compactArt.isBusy ? 'Compacting' : 'Compact', {
                key: 'shrink', onPress: () => void pressOnce($, 'shrink', () => shrink($)),
              })}
              {pressable(els, roundTile(handoffArt), handoffArt.isBusy ? 'Writing the handoff' : 'Handoff', {
                key: 'handoff', onPress: () => void pressOnce($, 'handoff', () => handoff($, 'full')),
              })}
            </Box>
            <Box flexDirection="row">
              {pressable(els, roundTile(warmArt), v.isKeepingWarm ? 'Keep-warm is on' : 'Keep-warm is off', {
                key: 'warm', onPress: () => void pressOnce($, 'warm', () => setKeepWarm($, !v.isKeepingWarm)),
              })}
              {pressable(els, roundTile(lookArt), v.isCustomizing ? 'Done customizing' : 'Customize', {
                key: 'look', onPress: () => void toggleCustomize($),
              })}
            </Box>
          </Box>
        </Box>
        {v.isCustomizing ? drawAppearance($, els, v) : null}
      </Box>
      <Box key="agents" marginLeft={side.isBeside ? 1 : 0}>
        {glassEl(Svg, agentsTile(crew(v), crewSummary(v), side.width), `Agents: ${crewSummary(v)}`, 'svg-agents')}
      </Box>
    </Box>
  )
}
