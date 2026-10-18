// Cockpit's pure maths: settings, formatting, chat fill, cache warmth, limit pace, forecasts,
// the launcher's ranking and the cold-send guard. No `$` here, so every rule is unit-tested.

import type { Launcher, Limit, Tone, Usage } from '../types'
import { SPARK } from './theme'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const FIVE_HOURS = 5 * HOUR
export const WEEK = 7 * 24 * HOUR
export const DEFAULT_COMPACT_AT = 400_000

// ── Settings ────────────────────────────────────────────────────────────────

export type Settings = {
  compactAt: number
  cacheLife: 'auto' | '1h' | '5m'
  density: 'calm' | 'standard' | 'full'
  keepWarm: boolean
  keepWarmMs: number
  guardTokens: number
  openAtStart: boolean
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

/** The plugin's `userConfig` values, with the person's `autoCompactWindow` as the compact point when unset. */
export function readSettings(options: Readonly<Record<string, unknown>>, autoCompactWindow: unknown): Settings {
  const configured = num(options.compactAt, 0)
  const fromSettings = num(autoCompactWindow, 0)
  return {
    compactAt: configured > 0 ? configured : fromSettings > 0 ? fromSettings : DEFAULT_COMPACT_AT,
    cacheLife: pick(options.cacheLife, ['auto', '1h', '5m'] as const, 'auto'),
    density: pick(options.density, ['calm', 'standard', 'full'] as const, 'standard'),
    keepWarm: options.keepWarm === true,
    keepWarmMs: Math.max(0.25, num(options.keepWarmHours, 3)) * HOUR,
    guardTokens: Math.max(0, num(options.guardTokens, 100_000)),
    openAtStart: options.openAtStart !== false,
  }
}

/** How long the prompt cache lives: 1 hour on a subscription, 5 minutes on an API key. */
export function cacheTtl(settings: Settings, isPlan: boolean): number {
  if (settings.cacheLife === '1h') return HOUR
  if (settings.cacheLife === '5m') return 5 * MINUTE
  return isPlan ? HOUR : 5 * MINUTE
}

/** The engine's usage figures as Cockpit keeps them. */
export function toUsage(u: {
  context: { tokens?: number; window: number }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}): Usage {
  const limit = (kind: string): Limit | null => {
    const r = u.rateLimits.find(x => x.kind === kind)
    if (!r) return null
    const at = r.resetsAt ? Date.parse(r.resetsAt) : NaN
    return { percentUsed: r.percentUsed, resetsAt: Number.isFinite(at) ? at : null }
  }
  const five = limit('five_hour')
  const week = limit('seven_day')
  return {
    tokens: u.context.tokens ?? 0,
    window: u.context.window,
    five,
    week,
    costUsd: u.cost ? u.cost.usd : null,
    isPlan: five !== null || week !== null,
  }
}

/**
 * A limit only climbs within its window. A reading with no figure (some carry none, such as the one after a
 * compact) keeps the last one, and a lower figure for the same window keeps the higher; only a window that has
 * reset, its old reset time passed or a new one given, may start lower.
 */
export function holdLimit(prev: Limit | null, next: Limit | null, now: number): Limit | null {
  if (!prev) return next
  const hasReset = prev.resetsAt !== null && now >= prev.resetsAt
  if (!next) return hasReset ? null : prev
  const isNewWindow = hasReset || (prev.resetsAt !== null && next.resetsAt !== null && Math.abs(next.resetsAt - prev.resetsAt) > 30 * MINUTE)
  if (isNewWindow || next.percentUsed >= prev.percentUsed) return next
  return { ...next, percentUsed: prev.percentUsed }
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.max(0, Math.round(n)))
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`
  return h % 24 === 0 ? `${Math.floor(h / 24)}d` : `${Math.floor(h / 24)}d ${h % 24}h`
}

export function fmtUsd(usd: number): string {
  return `$${usd >= 100 ? usd.toFixed(0) : usd.toFixed(2)}`
}

/** `claude-sonnet-5-5-20261001` reads as `Sonnet 5.5`. */
export function shortModel(model: string): string {
  const m = /(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(model)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return model || 'model'
  const name = family.charAt(0).toUpperCase() + family.slice(1).toLowerCase()
  return minor ? `${name} ${major}.${minor}` : `${name} ${major}`
}

// ── Chat fill ───────────────────────────────────────────────────────────────

export type ChatView = { pct: number; notchFrac: number; windowFrac: number; tone: Tone }

/** Fill measured against the compact point; the bar spans the window with a notch where compaction starts. */
export function chatView(tokens: number, compactAt: number, window: number): ChatView {
  const pct = Math.round((tokens / Math.max(1, compactAt)) * 100)
  const span = Math.max(window, compactAt, 1)
  return {
    pct,
    notchFrac: Math.min(1, compactAt / span),
    windowFrac: Math.min(1, tokens / span),
    tone: pct >= 85 ? 'act' : pct >= 60 ? 'watch' : 'fine',
  }
}

export type Cell = 'fill' | 'empty' | 'notch'

/** A bar of `cells` cells filled to `frac`, with a notch marking `notchFrac` when given. */
export function barCells(frac: number, cells: number, notchFrac?: number): Cell[] {
  const filled = Math.round(Math.min(1, Math.max(0, frac)) * cells)
  const notch = notchFrac === undefined || notchFrac >= 1 ? -1 : Math.min(cells - 1, Math.round(notchFrac * cells))
  return Array.from({ length: cells }, (_, i): Cell => (i === notch ? 'notch' : i < filled ? 'fill' : 'empty'))
}

/** Consecutive cells of one kind, so a bar draws as a few runs of text. */
export function runs(cells: Cell[]): { kind: Cell; length: number }[] {
  const out: { kind: Cell; length: number }[] = []
  for (const c of cells) {
    const last = out[out.length - 1]
    if (last && last.kind === c) last.length++
    else out.push({ kind: c, length: 1 })
  }
  return out
}

/** Turns left before auto-compact, from how much each recent turn grew the chat. */
export function turnsLeft(turnTokens: readonly number[], tokens: number, compactAt: number): number | null {
  if (tokens >= compactAt) return 0
  const growth: number[] = []
  turnTokens.forEach((t, i) => {
    const d = i > 0 ? t - (turnTokens[i - 1] ?? t) : 0
    if (d > 0) growth.push(d)
  })
  if (growth.length < 2) return null
  const recent = growth.slice(-8)
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length
  return avg > 0 ? Math.floor((compactAt - tokens) / avg) : null
}

export function turnsWords(n: number | null): string {
  if (n === null) return 'A forecast appears after a few turns.'
  if (n === 0) return 'Auto-compact is due on the next turn.'
  if (n > 50) return 'Plenty of room: 50+ turns before auto-compact.'
  return `About ${n} turn${n === 1 ? '' : 's'} before auto-compact.`
}

// ── Cache warmth ────────────────────────────────────────────────────────────

export type CacheView = { kind: 'none' | 'warm' | 'cold'; leftMs: number; tone: Tone }

export function cacheView(
  lastRequestAt: number,
  isCompacted: boolean,
  ttl: number,
  now: number,
  tokens: number,
  guardTokens: number,
): CacheView {
  if (!lastRequestAt || isCompacted) return { kind: 'none', leftMs: 0, tone: 'fine' }
  const leftMs = lastRequestAt + ttl - now
  if (leftMs > 0) return { kind: 'warm', leftMs, tone: leftMs < Math.min(10 * MINUTE, ttl * 0.2) ? 'watch' : 'fine' }
  const big = guardTokens > 0 ? guardTokens : 100_000
  return { kind: 'cold', leftMs: 0, tone: tokens >= big ? 'act' : tokens >= 20_000 ? 'watch' : 'fine' }
}

export function isCold(lastRequestAt: number, isCompacted: boolean, ttl: number, now: number): boolean {
  return lastRequestAt > 0 && !isCompacted && now - lastRequestAt >= ttl
}

// ── Limit pace ──────────────────────────────────────────────────────────────

export type PaceView = {
  pct: number
  elapsedFrac: number
  resetsInMs: number
  projected: number | null
  runsOutInMs: number | null
  tone: Tone
  short: string
  words: string
}

/** Where a rate-limit window is heading at the current pace, in a word and in a sentence. */
export function paceView(limit: Limit | null, windowMs: number, now: number): PaceView | null {
  if (!limit) return null
  const pct = Math.round(limit.percentUsed)
  const resetsInMs = Math.max(0, limit.resetsAt === null ? windowMs : limit.resetsAt - now)
  const elapsedFrac = Math.min(1, Math.max(0, 1 - resetsInMs / windowMs))
  const resets = `the reset in ${fmtDuration(resetsInMs)}`
  if (pct >= 100) {
    return { pct, elapsedFrac, resetsInMs, projected: null, runsOutInMs: 0, tone: 'act', short: 'used up', words: `Used up. It comes back at ${resets}.` }
  }
  if (elapsedFrac < 0.05 || limit.percentUsed < 1) {
    return { pct, elapsedFrac, resetsInMs, projected: null, runsOutInMs: null, tone: 'fine', short: 'fresh', words: 'Fresh window, plenty of room.' }
  }
  const projected = Math.round(limit.percentUsed / elapsedFrac)
  const perMs = limit.percentUsed / (elapsedFrac * windowMs)
  const runsOutInMs = (100 - limit.percentUsed) / perMs
  if (projected >= 100 && runsOutInMs < resetsInMs) {
    return {
      pct, elapsedFrac, resetsInMs, projected, runsOutInMs,
      tone: pct >= 40 ? 'act' : 'watch',
      short: 'burning fast',
      words: `At this pace it runs out in ${fmtDuration(runsOutInMs)}, ${fmtDuration(resetsInMs - runsOutInMs)} before ${resets}.`,
    }
  }
  const tone: Tone = pct >= 90 ? 'act' : projected >= 80 ? 'watch' : 'fine'
  const words = projected >= 80 ? `Tight: about ${projected}% used by ${resets}.` : `Lasts until ${resets}, about ${projected}% used by then.`
  return { pct, elapsedFrac, resetsInMs, projected, runsOutInMs: null, tone, short: projected >= 80 ? 'tight' : 'on pace', words }
}

// ── When to act ─────────────────────────────────────────────────────────────

export type Act = { kind: 'cold' | 'limit' | 'full'; text: string; short: string }

/** The one reason, if any, the band grows a second line. */
export function actNeeded(chat: ChatView, cache: CacheView, five: PaceView | null, tokens: number): Act | null {
  if (cache.kind === 'cold' && cache.tone === 'act') {
    return {
      kind: 'cold',
      text: `Cache went cold and this chat is ${fmtTokens(tokens)}. Your next message re-reads all of it.`,
      short: `Cache cold · next message re-reads ${fmtTokens(tokens)}`,
    }
  }
  if (five && five.tone === 'act') {
    const short = five.runsOutInMs ? `5h limit runs out in ${fmtDuration(five.runsOutInMs)}` : `5h limit ${five.short}`
    return { kind: 'limit', text: `5-hour limit: ${five.words}`, short }
  }
  if (chat.pct >= 90) {
    return { kind: 'full', text: `This chat is ${chat.pct}% of the way to auto-compact. Shrink it now, on your terms.`, short: `Chat ${chat.pct}% to auto-compact` }
  }
  return null
}

/** Why a fresh chat clearly pays off now, or null when it does not. */
export function startFreshReason(chat: ChatView, cache: CacheView): string | null {
  if (cache.kind === 'cold' && cache.tone === 'act') return 'The cache is cold, so a fresh chat costs less than re-reading this one.'
  if (chat.pct >= 60) return 'This chat is big. A fresh one starts small and answers faster.'
  return null
}

// ── Cold-send guard and keep-warm ───────────────────────────────────────────

/** Prompts no person sent: refusing one would lose it, so they are only warned about. */
const UNATTENDED = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'coordinator', 'observer', 'observer-activity'])

export type GuardInput = {
  isCold: boolean
  tokens: number
  guardTokens: number
  originKind: string
  text: string
  ackedAt: number
  lastRequestAt: number
}

export function guardDecision(g: GuardInput): 'pass' | 'warn' | 'drop' {
  if (g.guardTokens <= 0 || g.originKind === 'plugin' || g.text.trimStart().startsWith('/')) return 'pass'
  if (!g.isCold || g.tokens < g.guardTokens) return 'pass'
  if (UNATTENDED.has(g.originKind)) return 'warn'
  return g.ackedAt === g.lastRequestAt ? 'pass' : 'drop'
}

/** When the next keep-warm ping is due: a safe margin before the cache would go cold. */
export function pingDelay(lastRequestAt: number, ttl: number, now: number): number {
  const margin = Math.min(10 * MINUTE, ttl * 0.2)
  return Math.max(1000, lastRequestAt + ttl - margin - now)
}

/** A warm ping reads the cached prefix and writes only its own short message. */
export function isWarmPing(u: { cache_read_input_tokens: number; cache_creation_input_tokens: number }): boolean {
  return u.cache_read_input_tokens > 0 && u.cache_creation_input_tokens < 0.1 * u.cache_read_input_tokens
}

// ── Sparkline ───────────────────────────────────────────────────────────────

/** Percent readings as block glyphs, newest at the right. */
export function sparkline(values: readonly number[], width: number): string {
  return values
    .slice(-width)
    .map(v => SPARK[Math.min(SPARK.length - 1, Math.max(0, Math.round((v / 100) * (SPARK.length - 1))))])
    .join('')
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    out += B64.charAt(a >> 2) + B64.charAt(((a & 3) << 4) | (b >> 4))
    out += i + 1 < bytes.length ? B64.charAt(((b & 15) << 2) | (c >> 6)) : '='
    out += i + 2 < bytes.length ? B64.charAt(c & 63) : '='
  }
  return out
}

/** One row of `Raster` cells for `text`, each glyph in the terminal's default colours. */
export function rasterRow(text: string): string {
  const glyphs = [...text]
  const words = new Uint32Array(glyphs.length * 3)
  glyphs.forEach((g, i) => {
    words[i * 3] = g.codePointAt(0) ?? 0x20
    words[i * 3 + 1] = 0x01000000
    words[i * 3 + 2] = 0x01000000
  })
  return base64(new Uint8Array(words.buffer))
}

// ── Launcher ────────────────────────────────────────────────────────────────

export type Cmd = { name: string; description: string }
export type Ranked = Cmd & { group: 'pinned' | 'recent' | 'match' }

/** How well a command matches what was typed: name prefix, then name, then letters in order, then description. */
export function score(query: string, cmd: Cmd): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const name = cmd.name.toLowerCase()
  if (name.startsWith(q)) return 100 - Math.min(50, name.length)
  if (name.includes(q)) return 60
  let at = 0
  for (const ch of name) if (ch === q[at]) at++
  if (at === q.length) return 30
  return cmd.description.toLowerCase().includes(q) ? 10 : 0
}

/** Pinned, then recent, then the rest when nothing is typed; the best matches when something is. */
export function rankCommands(commands: readonly Cmd[], query: string, launcher: Launcher, limit = 12): Ranked[] {
  const byName = new Map(commands.map(c => [c.name, c]))
  if (query.trim()) {
    return commands
      .map(c => ({ c, s: score(query, c) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name))
      .slice(0, limit)
      .map(({ c }) => ({ ...c, group: launcher.pinned.includes(c.name) ? 'pinned' : launcher.recent.includes(c.name) ? 'recent' : 'match' }))
  }
  const seen = new Set<string>()
  const out: Ranked[] = []
  const take = (name: string, group: Ranked['group']) => {
    const c = byName.get(name)
    if (!c || seen.has(name) || out.length >= limit) return
    seen.add(name)
    out.push({ ...c, group })
  }
  launcher.pinned.forEach(n => take(n, 'pinned'))
  launcher.recent.slice(0, 5).forEach(n => take(n, 'recent'))
  return out
}

export function pushRecent(recent: readonly string[], name: string, max = 8): string[] {
  return [name, ...recent.filter(n => n !== name)].slice(0, max)
}

export function togglePin(pinned: readonly string[], name: string): string[] {
  return pinned.includes(name) ? pinned.filter(n => n !== name) : [...pinned, name].slice(0, 9)
}

// ── What an agent is doing ──────────────────────────────────────────────────

const base = (path: unknown) => (typeof path === 'string' ? path.split('/').filter(Boolean).pop() ?? path : '')
const quoted = (x: unknown, max = 18) => {
  const s = typeof x === 'string' ? x.trim() : ''
  return s.length > max ? `"${s.slice(0, max - 1)}…"` : `"${s}"`
}

/** A tool call in a few plain words: `Reading model.ts`, `Searching "agent.spawn"`, `Running npm test`. */
export function doingOf(tool: string, input: Readonly<Record<string, unknown>>): string {
  switch (tool) {
    case 'Read':
      return `Reading ${base(input.file_path) || 'a file'}`
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Editing ${base(input.file_path ?? input.notebook_path) || 'a file'}`
    case 'Write':
      return `Writing ${base(input.file_path) || 'a file'}`
    case 'Grep':
      return `Searching ${quoted(input.pattern)}`
    case 'Glob':
      return `Finding ${typeof input.pattern === 'string' ? input.pattern : 'files'}`
    case 'Bash': {
      if (typeof input.description === 'string' && input.description) return input.description
      const cmd = typeof input.command === 'string' ? input.command.trim().split(/\s+/).slice(0, 2).join(' ') : ''
      return cmd ? `Running ${cmd}` : 'Running a command'
    }
    case 'WebFetch': {
      const m = typeof input.url === 'string' ? /^https?:\/\/([^/]+)/.exec(input.url) : null
      return `Reading ${m?.[1] ?? 'a web page'}`
    }
    case 'WebSearch':
      return `Searching the web`
    case 'Agent':
    case 'Task':
      return 'Delegating'
    default: {
      const mcp = /^mcp__[^_]+(?:_[^_]+)*__(.+)$/.exec(tool)
      return `Using ${(mcp?.[1] ?? tool).replace(/_/g, ' ')}`
    }
  }
}
