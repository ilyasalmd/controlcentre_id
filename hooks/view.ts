// What the drawings share with the hooks: the snapshot they read, the pane's name, the drain's timing, and the
// actions a press can take. No engine calls here: every call on `$` lives in register.tsx, beside the hooks.

import type { RenderChildren } from 'claude-code'

import type { AgentCard, Look, Notice, Pressed, Squeeze, Tone, TurnInfo, Usage, Warmth } from '../types'
import type { Act, CacheView, ChatView, PaceView, Settings } from './model'

export const PANE = 'cockpit'
export const PANE_TITLE = 'Control Center'
/** How every open asks for the pane: inline above the prompt it wants room for all five sections. */
export const PANE_OPEN = { id: PANE, title: PANE_TITLE, rows: 34 } as const

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

/** How long the Context glass takes to drain while compacting, and to settle on the new level afterwards. */
export const DRAIN_MS = 40_000
export const SETTLE_MS = 1_200
/** What the drain leaves while the compaction is still running: a thin pool, not an empty glass. */
export const DRAIN_FLOOR = 3

/** Where a drain that began at `fromPct` stands `ms` in: a steady fall to the floor. */
export const drainLevel = (fromPct: number, ms: number) =>
  fromPct - (fromPct - Math.min(fromPct, DRAIN_FLOOR)) * Math.min(1, Math.max(0, ms / DRAIN_MS))

/** What the band's and the pane's presses do; register.tsx makes one set per drawing. */
export type Actions = {
  openPane: () => Promise<unknown>
  shrink: () => Promise<unknown>
  handoff: (kind: 'quick' | 'full') => Promise<unknown>
  setKeepWarm: (isOn: boolean) => Promise<unknown>
  sendAnyway: () => Promise<unknown>
  toggleExpanded: (id: string) => Promise<unknown>
  launch: (name: string) => Promise<unknown>
  pin: (name: string) => Promise<unknown>
  setFilter: (text: string) => Promise<unknown>
  changeLook: (change: Partial<Look>) => Promise<unknown>
  toggleCustomize: () => Promise<unknown>
  pressOnce: (key: string, work: () => Promise<unknown>) => Promise<unknown>
}

/** Draws the invisible press pad over a glass tile, on a surface that has one (./pad.tsx). */
export type PadMaker = (key: string, width: number, height: number) => RenderChildren
