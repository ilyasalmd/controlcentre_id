// The band above the prompt: one calm line of three facts, a second line only when it is time to act.

import type { Elements, RenderSurface } from 'claude-code'

import { barCells, fmtDuration, fmtTokens, runs, turnsLeft, turnsWords } from './model'
import { PANE_TITLE } from './view'
import type { Actions, View } from './view'
import { ACCENT, GLYPH, MUTED, TONE, spinner, tierOf } from './theme'

type Els = Elements[RenderSurface]
type Part = { text: string; color?: string; dim?: boolean }
type Seg = { id: string; parts: Part[]; card: string[] }
type Btn = { key: string; label: string; hotkey: string; isPrimary?: boolean; onPress: () => void }
type Layout = { segs: Seg[]; sep: string; buttons: Btn[] }

const width = (parts: Part[]) => parts.reduce((n, p) => n + [...p.text].length, 0)
const btnWidth = (b: Btn) => [...b.label].length + 4
const toned = (tone: 'fine' | 'watch' | 'act') => (tone === 'fine' ? undefined : TONE[tone])

// ── Segments ────────────────────────────────────────────────────────────────

function chatSeg(v: View, level: number, turnTokens: readonly number[]): Seg {
  const { chat, usage, settings } = v
  const value: Part = { text: `${chat.pct}%`, color: toned(chat.tone) }
  const parts: Part[] = level === 0 ? [value] : [{ text: 'Chat ', dim: true }, value]
  if (level >= 2) {
    const bar = runs(barCells(chat.windowFrac, 12, chat.notchFrac)).map(r => ({
      text: (r.kind === 'fill' ? GLYPH.fill : r.kind === 'notch' ? GLYPH.notch : GLYPH.empty).repeat(r.length),
      color: r.kind === 'fill' ? (toned(chat.tone) ?? ACCENT) : r.kind === 'notch' ? 'text' : MUTED,
      dim: r.kind === 'empty',
    }))
    parts.splice(1, 0, ...bar, { text: ' ' })
    parts.push({ text: ` of ${fmtTokens(settings.compactAt)}`, dim: true })
  }
  return {
    id: 'chat',
    parts,
    card: [
      `Chat  ${fmtTokens(usage.tokens)} of ${fmtTokens(settings.compactAt)} compact point · ${fmtTokens(usage.window)} window`,
      turnsWords(turnsLeft(turnTokens, usage.tokens, settings.compactAt)),
    ],
  }
}

function cacheSeg(v: View, level: number): Seg {
  const { cache, warmth, ttl, usage } = v
  const life = ttl >= 3_600_000 ? '1-hour cache' : `${fmtDuration(ttl)} cache`
  const label: Part[] = level === 0 ? [] : [{ text: 'Cache ', dim: true }]
  const warmMark: Part[] = v.isKeepingWarm ? [{ text: ` ${GLYPH.warm}`, color: ACCENT }] : []
  const keep = v.isKeepingWarm ? `Keep-warm is on for ${fmtDuration(warmth.keepWarmUntil - v.now)} more.` : 'Keep-warm is off.'
  if (cache.kind === 'warm') {
    return {
      id: 'cache',
      parts: [...label, { text: 'warm ', color: toned(cache.tone) }, { text: fmtDuration(cache.leftMs) }, ...warmMark],
      card: [`Cache  warm for ${fmtDuration(cache.leftMs)} more (${life}). Replying now is cheap.`, keep],
    }
  }
  if (cache.kind === 'cold') {
    return {
      id: 'cache',
      parts: [...label, { text: 'cold', color: toned(cache.tone) }, ...warmMark],
      card: [
        `Cache  cold for ${fmtDuration(v.now - warmth.lastRequestAt - ttl)}. The next message re-reads ${fmtTokens(usage.tokens)} tokens.`,
        keep,
      ],
    }
  }
  return {
    id: 'cache',
    parts: [...(level === 0 ? [{ text: 'cache ', dim: true }] : label), { text: '–', dim: true }, ...warmMark],
    card: [`Cache  starts with the next reply (${life}).`, keep],
  }
}

function limitSeg(v: View, level: number): Seg | null {
  const { five, week } = v
  if (!five && !week) return null
  const parts: Part[] = []
  const card: string[] = []
  if (five) {
    parts.push({ text: '5h ', dim: true }, { text: `${five.pct}%`, color: toned(five.tone) })
    if (level >= 1) parts.push({ text: ` ${five.short}`, color: toned(five.tone), dim: five.tone === 'fine' })
    card.push(`5-hour  ${five.pct}% used. ${five.words}`)
  }
  if (week && (level >= 2 || !five)) {
    if (parts.length) parts.push({ text: GLYPH.sepTight, dim: true })
    parts.push({ text: 'Week ', dim: true }, { text: `${week.pct}%`, color: toned(week.tone) })
  }
  if (week) card.push(`Week  ${week.pct}% used. ${week.words}`)
  return { id: 'limits', parts, card }
}

function workingSeg(v: View, level: number): Seg {
  const t = v.turn
  const elapsed = t.startedAt > 0 ? fmtDuration(v.now - t.startedAt) : '0s'
  const running = v.agents.filter(a => a.status === 'running').length
  const frame = spinner(v.now)
  const parts: Part[] = [{ text: frame, color: ACCENT }, { text: level === 0 ? ` ${elapsed}` : ` Working ${elapsed}` }]
  parts.push({ text: ` · ${t.tools} tool${t.tools === 1 ? '' : 's'}`, dim: true })
  if (running > 0 && level >= 1) parts.push({ text: ` · ${running} agent${running === 1 ? '' : 's'}`, dim: true })
  return {
    id: 'limits',
    parts,
    card: [`Turn  running for ${elapsed} · ${t.tools} tool calls · ${running} agent${running === 1 ? '' : 's'} running`, 'Details live in the Control Center.'],
  }
}

// ── Layouts, richest first ──────────────────────────────────────────────────

function layouts(act: Actions, v: View, isWorking: boolean, turnTokens: readonly number[], hasAct: boolean, isTerminal: boolean): Layout[] {
  const open = () => void act.openPane()
  const fresh: Btn = { key: 'handoff', label: 'Start fresh', hotkey: 'h', isPrimary: true, onPress: () => void act.handoff('quick') }
  const quiet: Btn = { key: 'handoff', label: 'Handoff', hotkey: 'h', onPress: () => void act.handoff('full') }
  const shrinkBtn: Btn = { key: 'shrink', label: 'Compact', hotkey: 's', onPress: () => void act.shrink() }
  const warmBtn: Btn = {
    key: 'warm',
    label: v.isKeepingWarm ? `Warm ${GLYPH.warm}` : 'Keep warm',
    hotkey: 'w',
    onPress: () => void act.setKeepWarm(!v.isKeepingWarm),
  }
  const launcher = (label: string): Btn => ({ key: 'open', label, hotkey: 'k', onPress: open })
  // The app has room for words; the terminal keeps the glyph until it is wide.
  const roomy = isTerminal ? GLYPH.launcher : PANE_TITLE
  const handoffBtn = v.freshReason ? fresh : quiet
  // On the act line the same actions sit beside the reason, so line one keeps only the launcher.
  const actions = (list: Btn[]) => (hasAct ? [] : list)

  const segsAt = (level: number) =>
    [chatSeg(v, level, turnTokens), cacheSeg(v, level), isWorking ? workingSeg(v, level) : limitSeg(v, level)].filter(
      (s): s is Seg => s !== null,
    )

  return [
    { segs: segsAt(2), sep: GLYPH.sep, buttons: [...actions([shrinkBtn, handoffBtn, warmBtn]), launcher(`${GLYPH.launcher} ${PANE_TITLE}`)] },
    { segs: segsAt(1), sep: GLYPH.sepTight, buttons: [...actions([shrinkBtn, handoffBtn]), launcher(roomy)] },
    { segs: segsAt(1), sep: GLYPH.sepTight, buttons: [...actions(v.freshReason ? [fresh] : []), launcher(roomy)] },
    { segs: segsAt(0), sep: GLYPH.sepTight, buttons: [...actions(v.freshReason ? [fresh] : []), launcher(GLYPH.launcher)] },
    { segs: segsAt(0), sep: GLYPH.sepTight, buttons: [launcher(GLYPH.launcher)] },
  ]
}

const START = { compact: 3, regular: 1, wide: 0 } as const

function choose(all: Layout[], columns: number, density: string): Layout {
  const lineWidth = (l: Layout) =>
    2 + l.segs.reduce((n, s) => n + width(s.parts), 0) + [...l.sep].length * (l.segs.length - 1) + 1 +
    l.buttons.reduce((n, b) => n + btnWidth(b) + 1, 0)
  const from = START[tierOf(columns, density)]
  return all.slice(from).find(l => lineWidth(l) <= columns) ?? (all[all.length - 1] as Layout)
}

// ── Drawing ─────────────────────────────────────────────────────────────────

export type BandProps = { bodyColumns: number; isWorking: boolean; isTerminal: boolean }

export function drawBand(actions: Actions, els: Els, p: BandProps, v: View, turnTokens: readonly number[]) {
  const { Box, Text, Button } = els
  const columns = Math.max(20, p.bodyColumns)
  const isWorking = p.isWorking || v.turn.isWorking
  const act = v.act
  const layout = choose(layouts(actions, v, isWorking, turnTokens, act !== null, p.isTerminal), columns, v.settings.density)

  const button = (b: Btn) => (
    <Button
      key={b.key}
      label={b.label}
      hotkey={b.hotkey}
      variant={b.isPrimary ? 'primary' : undefined}
      dimColor={b.isPrimary ? undefined : true}
      onPress={b.onPress}
    />
  )

  // Each segment is a hover scope with a card that opens over the rows above it.
  let offset = 2
  const segments = layout.segs.map((s, i) => {
    const at = offset
    offset += width(s.parts) + (i < layout.segs.length - 1 ? [...layout.sep].length : 0)
    const cardWidth = Math.min(columns, Math.max(...s.card.map(l => [...l].length)) + 4)
    const inner = cardWidth - 4
    return (
      <Box key={`seg-${s.id}`} flexShrink={0}>
        <Text hover={{ underline: true }}>
          {s.parts.map(part => (
            <Text color={part.color} dimColor={part.dim}>
              {part.text}
            </Text>
          ))}
          {i < layout.segs.length - 1 ? <Text dimColor>{layout.sep}</Text> : null}
        </Text>
        <Box
          position="absolute"
          top={-(s.card.length + 2)}
          left={Math.min(0, columns - at - cardWidth)}
          width={cardWidth}
          display="none"
          hover={{ display: 'flex' }}
          flexDirection="column"
          borderStyle="round"
          borderColor={MUTED}
          paddingX={1}
        >
          {s.card.map(line => (
            <Text wrap="truncate">{line.padEnd(inner)}</Text>
          ))}
        </Box>
      </Box>
    )
  })

  const actButtons: Btn[] =
    act === null
      ? []
      : act.kind === 'cold'
        ? [
            { key: 'act-shrink', label: 'Compact first', hotkey: 's', isPrimary: true, onPress: () => void actions.shrink() },
            { key: 'act-fresh', label: 'Start fresh', hotkey: 'h', onPress: () => void actions.handoff('quick') },
            { key: 'act-send', label: 'Send anyway', hotkey: 'a', onPress: () => void actions.sendAnyway() },
          ]
        : act.kind === 'full'
          ? [
              { key: 'act-shrink', label: 'Compact now', hotkey: 's', isPrimary: true, onPress: () => void actions.shrink() },
              { key: 'act-fresh', label: 'Start fresh', hotkey: 'h', onPress: () => void actions.handoff('quick') },
            ]
          : [{ key: 'act-details', label: 'Details', hotkey: 'd', onPress: () => void actions.openPane() }]

  const actRoom = columns - actButtons.reduce((n, b) => n + btnWidth(b) + 1, 0) - 3
  const actFits = act !== null && [...act.text].length <= actRoom

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={TONE[v.tone]}>{`${GLYPH.dot} `}</Text>
        {segments}
        <Box flexGrow={1} />
        <Box flexDirection="row" flexShrink={0} gap={1}>
          {layout.buttons.map(button)}
        </Box>
      </Box>
      {act ? (
        <Box flexDirection="row">
          <Box flexShrink={1} flexGrow={1}>
            <Text color={TONE.watch} wrap="truncate">{`${GLYPH.act} ${actFits ? act.text : act.short}`}</Text>
          </Box>
          <Box flexDirection="row" flexShrink={0} gap={1}>
            {actButtons.map(button)}
          </Box>
        </Box>
      ) : null}
      {v.notice ? (
        <Text wrap="truncate">
          <Text color={TONE[v.notice.tone]}>{'› '}</Text>
          <Text dimColor>{v.notice.text}</Text>
        </Text>
      ) : null}
    </Box>
  )
}
