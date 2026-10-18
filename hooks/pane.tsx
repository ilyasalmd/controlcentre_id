// The Control Center pane: Session, Limits, Activity, Actions and the Launcher, top to bottom.

import type { Elements, RenderSurface } from 'claude-code'

import type { AgentCard, Launcher, Sample } from '../types'
import {
  barCells, fmtDuration, fmtTokens, fmtUsd, rankCommands, rasterRow, runs, shortModel, sparkline, turnsLeft, turnsWords,
} from './model'
import type { Cmd, PaceView } from './model'
import { drawGlassTiles } from './glass'
import type { Actions, PadMaker, View } from './view'
import { ACCENT, GLYPH, MUTED, TONE, spinner } from './theme'

type Els = Elements[RenderSurface]

export type PaneData = {
  /** The press pad for glass tiles, where the surface has one. */
  pad?: PadMaker
  bodyColumns: number
  isTerminal: boolean
  turnTokens: readonly number[]
  samples: readonly Sample[]
  commands: readonly Cmd[]
  query: string
  launcher: Launcher
  open: string | null
}

const toned = (tone: 'fine' | 'watch' | 'act') => (tone === 'fine' ? undefined : TONE[tone])

export function drawPane(act: Actions, els: Els, d: PaneData, v: View) {
  const { Box, Text, Button } = els
  const cols = Math.max(24, d.bodyColumns)
  const barWidth = Math.max(10, Math.min(40, cols - 14))

  const heading = (text: string) => (
    <Text bold color="text">
      {text}
    </Text>
  )

  const bar = (frac: number, cells: number, color: string, notch?: number) => (
    <Text>
      {runs(barCells(frac, cells, notch)).map(r =>
        r.kind === 'fill' ? (
          <Text color={color}>{GLYPH.fill.repeat(r.length)}</Text>
        ) : r.kind === 'notch' ? (
          <Text color="text">{GLYPH.notch.repeat(r.length)}</Text>
        ) : (
          <Text color={MUTED} dimColor>
            {GLYPH.empty.repeat(r.length)}
          </Text>
        ),
      )}
    </Text>
  )

  // ── 1. Session ──
  const { chat, cache, usage, settings, warmth } = v
  const cacheLine =
    cache.kind === 'warm'
      ? { text: `warm · ${fmtDuration(cache.leftMs)} left`, color: toned(cache.tone) }
      : cache.kind === 'cold'
        ? { text: `cold for ${fmtDuration(v.now - warmth.lastRequestAt - v.ttl)}. The next message re-reads the whole chat.`, color: toned(cache.tone) }
        : { text: 'starts with the next reply', color: MUTED }
  const keepLine = v.isKeepingWarm
    ? `${GLYPH.warm} Keep-warm on for ${fmtDuration(warmth.keepWarmUntil - v.now)}${warmth.lastPing ? `, last ping read ${fmtTokens(warmth.lastPing.read)}` : ''}`
    : warmth.stopped
      ? `Keep-warm stopped: ${warmth.stopped}.`
      : null

  const session = (
    <Box key="session" flexDirection="column">
      {heading('Session')}
      <Box flexDirection="row" gap={1}>
        {bar(chat.windowFrac, barWidth, toned(chat.tone) ?? ACCENT, chat.notchFrac)}
        <Text color={toned(chat.tone)}>{`${chat.pct}%`}</Text>
      </Box>
      <Text dimColor>
        {`${fmtTokens(usage.tokens)} of ${fmtTokens(settings.compactAt)} compact point · ${fmtTokens(usage.window)} window · ${GLYPH.notch} marks auto-compact`}
      </Text>
      <Text dimColor>{turnsWords(turnsLeft(d.turnTokens, usage.tokens, settings.compactAt))}</Text>
      <Text>
        <Text dimColor>{'Cache  '}</Text>
        <Text color={cacheLine.color}>{cacheLine.text}</Text>
      </Text>
      {keepLine ? <Text color={v.isKeepingWarm ? ACCENT : MUTED}>{keepLine}</Text> : null}
      {usage.costUsd !== null && usage.costUsd > 0 ? (
        <Text dimColor>{`Worth ${fmtUsd(usage.costUsd)} at API prices${usage.isPlan ? ' · not a bill on your plan' : ''}`}</Text>
      ) : null}
    </Box>
  )

  // ── 2. Limits ──
  const limit = (key: string, label: string, p: PaceView) => (
    <Box key={key} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{label.padEnd(7)}</Text>
        {bar(p.pct / 100, barWidth, toned(p.tone) ?? ACCENT)}
        <Text color={toned(p.tone)}>{`${p.pct}%`}</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        <Text>{' '.repeat(7)}</Text>
        <Text color={MUTED} dimColor>
          {GLYPH.elapsed.repeat(Math.round(p.elapsedFrac * barWidth)).padEnd(barWidth)}
        </Text>
        <Text dimColor>{`${Math.round(p.elapsedFrac * 100)}% of time`}</Text>
      </Box>
      <Text color={toned(p.tone)} dimColor={p.tone === 'fine'}>
        {`${' '.repeat(8)}${p.words}`}
      </Text>
    </Box>
  )
  const trend = d.samples.filter(s => s.five !== null).map(s => s.five as number)
  const spark = sparkline(trend, Math.min(48, cols - 10))
  const limits =
    v.five || v.week ? (
      <Box key="limits" flexDirection="column">
        {heading('Limits')}
        {v.five ? limit('five', '5-hour', v.five) : null}
        {v.week ? limit('week', 'Week', v.week) : null}
        {spark.length >= 2 ? (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>{'Trend  '}</Text>
            {'Raster' in els ? <els.Raster key="trend" columns={[...spark].length} rows={1} cells={rasterRow(spark)} /> : <Text color={ACCENT}>{spark}</Text>}
            <Text dimColor>5-hour use this session</Text>
          </Box>
        ) : null}
        <Text dimColor>The thin line under each bar is time passed. Use ahead of time means you are spending fast.</Text>
      </Box>
    ) : (
      <Box key="limits" flexDirection="column">
        {heading('Limits')}
        <Text dimColor>No plan limits reported yet. They appear after the first reply on a subscription.</Text>
      </Box>
    )

  // ── 3. Activity ──
  const t = v.turn
  const running = v.agents.filter(a => a.status === 'running')
  const cards = [...running, ...v.agents.filter(a => a.status !== 'running').reverse()].slice(0, 6)
  const card = (a: AgentCard, n: number) => {
    const isOpen = d.open === a.id
    const age = a.status === 'running' ? fmtDuration(v.now - a.startedAt) : `done ${fmtDuration(v.now - (a.endedAt ?? v.now))} ago`
    const mark = a.status === 'running' ? spinner(v.now) : a.status === 'done' ? '✓' : '✕'
    const markColor = a.status === 'running' ? ACCENT : a.status === 'done' ? TONE.fine : TONE.act
    return (
      <Box key={`agent-${a.id}`} flexDirection="column">
        <Button key={`agent-row-${a.id}`} plain onPress={() => void act.toggleExpanded(a.id)}>
          <Text dimColor>{`${n}  `}</Text>
          <Text color={markColor}>{mark}</Text>
          {` ${a.type}  `}
          <Text dimColor>{`${shortModel(a.model)} · ${age}`}</Text>
        </Button>
        {isOpen ? (
          <Box flexDirection="column" paddingLeft={5}>
            <Text>{a.description || 'No description.'}</Text>
            <Text dimColor>{`${a.steps} model request${a.steps === 1 ? '' : 's'} · ${fmtTokens(a.tokens)} tokens · ${shortModel(a.model)}`}</Text>
          </Box>
        ) : null}
      </Box>
    )
  }
  const activity = (
    <Box key="activity" flexDirection="column">
      {heading('Activity')}
      {t.isWorking ? (
        <Text>
          <Text color={ACCENT}>{spinner(v.now)}</Text>
          {` Working ${t.startedAt ? fmtDuration(v.now - t.startedAt) : ''}`}
          <Text dimColor>{` · ${t.tools} tool call${t.tools === 1 ? '' : 's'} · ${running.length} agent${running.length === 1 ? '' : 's'} running`}</Text>
        </Text>
      ) : (
        <Text dimColor>{t.lastSeconds !== null ? `Idle. The last turn took ${fmtDuration(t.lastSeconds * 1000)} and ${t.tools} tool calls.` : 'Idle.'}</Text>
      )}
      {cards.length ? cards.map((a, i) => card(a, i + 1)) : <Text dimColor>No subagents yet this session.</Text>}
    </Box>
  )

  // ── 4. Actions ──
  const actions = (
    <Box key="actions" flexDirection="column">
      {heading('Actions')}
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button key="shrink" label={usage.tokens > 0 ? `Shrink chat (${fmtTokens(usage.tokens)})` : 'Shrink chat'} hotkey="s" variant={v.act?.kind === 'full' || v.act?.kind === 'cold' ? 'primary' : undefined} onPress={() => void act.shrink()} />
        <Button key="quick" label="Quick handoff" hotkey="h" variant={v.freshReason ? 'primary' : undefined} onPress={() => void act.handoff('quick')} />
        <Button key="full" label="Full handoff" hotkey="f" onPress={() => void act.handoff('full')} />
        <Button key="warm" label={v.isKeepingWarm ? 'Keep warm: on' : 'Keep warm: off'} hotkey="w" onPress={() => void act.setKeepWarm(!v.isKeepingWarm)} />
      </Box>
      {v.freshReason ? <Text color={TONE.watch}>{v.freshReason}</Text> : null}
      <Text dimColor>Quick writes a note to paste into a fresh chat. Full also checks git and writes HANDOFF.md.</Text>
    </Box>
  )

  // ── 5. Launcher ──
  const ranked = rankCommands(d.commands, d.query, d.launcher)
  const groupTitle = { pinned: 'Pinned', recent: 'Recent', match: 'Matches' } as const
  const rows: unknown[] = []
  let lastGroup = ''
  ranked.forEach((c, i) => {
    const group = d.query ? 'match' : c.group
    if (group !== lastGroup) {
      rows.push(<Text dimColor>{groupTitle[group]}</Text>)
      lastGroup = group
    }
    const isPinned = d.launcher.pinned.includes(c.name)
    const room = Math.max(0, cols - c.name.length - 12)
    rows.push(
      <Box key={`cmd-${c.name}`} flexDirection="row">
        <Box flexGrow={1} flexShrink={1}>
          <Button key={`run-${c.name}`} plain hotkey={i < 9 ? String(i + 1) : undefined} onPress={() => void act.launch(c.name)}>
            {`/${c.name}  `}
            <Text dimColor>{c.description.length > room ? `${c.description.slice(0, Math.max(0, room - 1))}…` : c.description}</Text>
          </Button>
        </Box>
        <Button key={`pin-${c.name}`} plain dimColor={!isPinned} label={isPinned ? '★' : '☆'} onPress={() => void act.pin(c.name)} />
      </Box>,
    )
  })
  const Input = 'Input' in els ? els.Input : null
  const launcherSection = (
    <Box key="launcher" flexDirection="column">
      {heading('Launcher')}
      {Input ? (
        <Input
          key="filter"
          label="Find"
          placeholder={`search ${d.commands.length} skills and commands`}
          value={d.query}
          onInput={(x: string) => void act.setFilter(x)}
          onSubmit={(x: string) => void act.setFilter(x)}
        />
      ) : null}
      {rows.length ? (rows as never[]) : <Text dimColor>Type to search. Press ☆ on a result to pin it here.</Text>}
    </Box>
  )

  const noticeLine = v.notice ? (
    <Text>
      <Text color={TONE[v.notice.tone]}>{'› '}</Text>
      {v.notice.text}
    </Text>
  ) : null

  // The desktop draws Svg: the Liquid Glass Control Center alone, an always-on display; /cockpit opens and
  // closes it. Notices reach it as toasts; warnings show in the tiles themselves.
  if (!d.isTerminal && 'Svg' in els) return drawGlassTiles(act, els, v, d.turnTokens, d.bodyColumns, d.pad)

  return (
    <Box flexDirection="column" gap={1}>
      {v.notice ? (
        <Text>
          <Text color={TONE[v.notice.tone]}>{'› '}</Text>
          {v.notice.text}
        </Text>
      ) : null}
      {session}
      {limits}
      {activity}
      {actions}
      {launcherSection}
    </Box>
  )
}
