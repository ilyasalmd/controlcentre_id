// Cockpit v2: the state contract. Every value the band and the pane draw from.

export type Tone = 'fine' | 'watch' | 'act'

export type Limit = { percentUsed: number; resetsAt: number | null }

/** The figures `session.measure` pushes, kept so drawings redraw only when they move. */
export type Usage = {
  tokens: number
  window: number
  five: Limit | null
  week: Limit | null
  costUsd: number | null
  isPlan: boolean
}

export type TurnInfo = { startedAt: number; tools: number; isWorking: boolean; lastSeconds: number | null }

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentCard = {
  id: string
  type: string
  description: string
  model: string
  status: AgentStatus
  startedAt: number
  endedAt: number | null
  steps: number
  tokens: number
  /** The effort its requests run at (`high`, or a token budget), once its first request is seen. */
  effort?: string | number | null
  /** The tool it called last, and that call in plain words. */
  tool?: string
  doing?: string
}

/** The prompt cache as Cockpit tracks it, plus the keep-warm window. */
export type Warmth = {
  lastRequestAt: number
  isCompacted: boolean
  keepWarmUntil: number
  lastPing: { at: number; read: number; isWarm: boolean } | null
  stopped: string | null
  ackedAt: number
}

/**
 * A compaction under way or just finished, so the Context glass can drain: from `fromPct` toward empty while it
 * runs, then settle from `doneLevel` to the new reading. Times are clock times, so a frame that reloads picks up
 * the drain where it was.
 */
export type Squeeze = { startedAt: number; fromPct: number; doneAt: number | null; doneLevel: number | null }

export type Notice = { text: string; tone: Tone; at: number }
/** The glass's look: `color` tints the frost (null: neutral smoke); `opacity` is how much frost covers the lights, 0 clear to 100. */
export type Look = { color: string | null; opacity: number }
/** The Control Center action pressed last: its tile lights while `isBusy`, and a repeat press is ignored. */
export type Pressed = { key: string; at: number; isBusy: boolean }

/** One reading for the sparkline. */
export type Sample = { at: number; five: number | null; tokens: number }

export type Launcher = { pinned: string[]; recent: string[] }

declare module 'claude-code' {
  interface PluginState {
    cockpit: {
      usage: Usage
      turn: TurnInfo
      agents: AgentCard[]
      warmth: Warmth
      notice: Notice | null
      samples: Sample[]
      turnTokens: number[]
      filter: string
      expanded: string | null
      launcher: Launcher
      tick: number
      pressed: Pressed | null
      look: Look
      customizing: boolean
      squeeze: Squeeze | null
    }
  }
}
