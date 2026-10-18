// Cockpit's design tokens. Only theme keys, so the band and pane follow the person's theme and any skin.

import type { Tone } from '../types'

/** The one three-state colour rule used everywhere: fine, watch, act. */
export const TONE = { fine: 'success', watch: 'warning', act: 'error' } as const satisfies Record<Tone, string>

export const ACCENT = 'claude'
export const MUTED = 'subtle'
export const QUIET = 'inactive'

export const GLYPH = {
  dot: '●',
  sep: '  ·  ',
  sepTight: ' · ',
  fill: '━',
  empty: '─',
  notch: '┃',
  elapsed: '▔',
  act: '▲',
  warm: '↻',
  launcher: '⌘',
} as const

export const SPARK = '▁▂▃▄▅▆▇█'

/** Spinner frames for the working state, one per tick. */
const WORKING = ['◐', '◓', '◑', '◒'] as const

/** The working glyph for this moment: it turns once per 5-second redraw. */
export const spinner = (now: number): string => WORKING[Math.floor(now / 5000) % WORKING.length] ?? WORKING[0]

export type Tier = 'compact' | 'regular' | 'wide'

/** Band layout from the columns it may use: compact under 80, regular to 140, wide above. */
export function tierOf(columns: number, density: string): Tier {
  if (density === 'calm') return 'compact'
  const wideFrom = density === 'full' ? 110 : 140
  return columns < 80 ? 'compact' : columns <= wideFrom ? 'regular' : 'wide'
}

/** The harsher of several tones. */
export function worst(...tones: Tone[]): Tone {
  return tones.includes('act') ? 'act' : tones.includes('watch') ? 'watch' : 'fine'
}
