import { describe, expect, test } from 'claude-code/testing'

import {
  HOUR, MINUTE, FIVE_HOURS,
  actNeeded, barCells, cacheTtl, cacheView, chatView, fmtDuration, fmtTokens, guardDecision, holdLimit, isCold, isWarmPing,
  paceView, pingDelay, pushRecent, rankCommands, rasterRow, readSettings, runs, score, shortModel, sparkline,
  startFreshReason, toUsage, togglePin, turnsLeft, turnsWords,
} from '../hooks/model'

const NOW = Date.parse('2026-10-17T12:00:00Z')

describe('settings', () => {
  test('the compact point comes from userConfig, then autoCompactWindow, then 400k', () => {
    expect(readSettings({ compactAt: 250_000 }, 300_000).compactAt).toBe(250_000)
    expect(readSettings({ compactAt: 0 }, 300_000).compactAt).toBe(300_000)
    expect(readSettings({}, undefined).compactAt).toBe(400_000)
  })

  test('unknown option values fall back to the defaults', () => {
    const s = readSettings({ density: 'loud', cacheLife: 'forever', guardTokens: -5 }, undefined)
    expect(s.density).toBe('standard')
    expect(s.cacheLife).toBe('auto')
    expect(s.guardTokens).toBe(0)
    expect(s.keepWarmMs).toBe(3 * HOUR)
  })

  test('cache life is 1 hour on a plan and 5 minutes on an API key, unless set', () => {
    expect(cacheTtl(readSettings({}, undefined), true)).toBe(HOUR)
    expect(cacheTtl(readSettings({}, undefined), false)).toBe(5 * MINUTE)
    expect(cacheTtl(readSettings({ cacheLife: '1h' }, undefined), false)).toBe(HOUR)
  })

  test('usage figures: limits by kind, plan detected from them', () => {
    const u = toUsage({
      context: { tokens: 152_000, window: 1_000_000 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 22, resetsAt: '2026-10-17T15:00:00Z' }],
      cost: { usd: 4.12 },
    })
    expect(u).toEqual({
      tokens: 152_000, window: 1_000_000, costUsd: 4.12, isPlan: true, week: null,
      five: { percentUsed: 22, resetsAt: Date.parse('2026-10-17T15:00:00Z') },
    })
    expect(toUsage({ context: { window: 200_000 }, rateLimits: [] }).isPlan).toBe(false)
  })
})

describe('formatting', () => {
  test('tokens', () => {
    expect([fmtTokens(850), fmtTokens(152_400), fmtTokens(1_000_000), fmtTokens(1_260_000)]).toEqual(['850', '152k', '1M', '1.3M'])
  })

  test('durations', () => {
    expect([fmtDuration(45_000), fmtDuration(41 * MINUTE), fmtDuration(2 * HOUR), fmtDuration(3 * HOUR + 10 * MINUTE), fmtDuration(50 * HOUR), fmtDuration(72 * HOUR)])
      .toEqual(['45s', '41m', '2h', '3h 10m', '2d 2h', '3d'])
  })

  test('model names read as people say them', () => {
    expect(shortModel('claude-sonnet-5-5-20261001')).toBe('Sonnet 5.5')
    expect(shortModel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(shortModel('claude-haiku-4-20250101')).toBe('Haiku 4')
    expect(shortModel('gpt-x')).toBe('gpt-x')
  })
})

describe('chat fill and the threshold notch', () => {
  test('percent is of the compact point; the notch sits where compaction starts', () => {
    const c = chatView(152_000, 400_000, 1_000_000)
    expect(c.pct).toBe(38)
    expect(c.notchFrac).toBe(0.4)
    expect(c.tone).toBe('fine')
    expect(chatView(260_000, 400_000, 1_000_000).tone).toBe('watch')
    expect(chatView(350_000, 400_000, 1_000_000).tone).toBe('act')
  })

  test('the bar fills, then shows the notch at its place', () => {
    const cells = barCells(0.2, 10, 0.4)
    expect(cells).toEqual(['fill', 'fill', 'empty', 'empty', 'notch', 'empty', 'empty', 'empty', 'empty', 'empty'])
    expect(runs(cells).map(r => `${r.kind}:${r.length}`)).toEqual(['fill:2', 'empty:2', 'notch:1', 'empty:5'])
    expect(barCells(1, 4).every(c => c === 'fill')).toBe(true)
  })

  test('turns left comes from recent growth per turn, in words', () => {
    expect(turnsLeft([100_000], 100_000, 400_000)).toBe(null)
    expect(turnsLeft([100_000, 110_000, 130_000], 130_000, 400_000)).toBe(18)
    expect(turnsLeft([100_000], 400_000, 400_000)).toBe(0)
    expect(turnsWords(6)).toBe('About 6 turns before auto-compact.')
    expect(turnsWords(1)).toBe('About 1 turn before auto-compact.')
    expect(turnsWords(99)).toBe('Plenty of room: 50+ turns before auto-compact.')
  })
})

describe('cache warmth', () => {
  test('none before the first reply, warm with time left, cold after the cache life', () => {
    expect(cacheView(0, false, HOUR, NOW, 50_000, 100_000).kind).toBe('none')
    const warm = cacheView(NOW - 19 * MINUTE, false, HOUR, NOW, 50_000, 100_000)
    expect(warm).toEqual({ kind: 'warm', leftMs: 41 * MINUTE, tone: 'fine' })
    expect(cacheView(NOW - 55 * MINUTE, false, HOUR, NOW, 50_000, 100_000).tone).toBe('watch')
    expect(cacheView(NOW - 2 * HOUR, false, HOUR, NOW, 212_000, 100_000)).toEqual({ kind: 'cold', leftMs: 0, tone: 'act' })
    expect(cacheView(NOW - 2 * HOUR, false, HOUR, NOW, 5_000, 100_000).tone).toBe('fine')
    expect(cacheView(NOW - 2 * HOUR, true, HOUR, NOW, 212_000, 100_000).kind).toBe('none')
    expect(isCold(NOW - 2 * HOUR, false, HOUR, NOW)).toBe(true)
  })

  test('keep-warm pings 10 minutes before an hour cache would cool, 1 minute before a 5-minute one', () => {
    expect(pingDelay(NOW, HOUR, NOW)).toBe(50 * MINUTE)
    expect(pingDelay(NOW, 5 * MINUTE, NOW)).toBe(4 * MINUTE)
    expect(pingDelay(NOW - 2 * HOUR, HOUR, NOW)).toBe(1000)
  })

  test('a warm ping reads the prefix and writes little', () => {
    expect(isWarmPing({ cache_read_input_tokens: 200_000, cache_creation_input_tokens: 40 })).toBe(true)
    expect(isWarmPing({ cache_read_input_tokens: 0, cache_creation_input_tokens: 200_000 })).toBe(false)
  })
})

describe('limit pace', () => {
  const at = (pct: number, resetsInMs: number) => paceView({ percentUsed: pct, resetsAt: NOW + resetsInMs }, FIVE_HOURS, NOW)

  test('a fresh window says so', () => {
    expect(at(0.5, 4.9 * HOUR)?.short).toBe('fresh')
  })

  test('on pace: lasts until the reset, in words', () => {
    const p = at(22, 3 * HOUR)
    expect(p?.short).toBe('on pace')
    expect(p?.tone).toBe('fine')
    expect(p?.projected).toBe(55)
    expect(p?.words).toBe('Lasts until the reset in 3h, about 55% used by then.')
  })

  test('burning fast: when it runs out, and how long before the reset', () => {
    const p = at(60, 3 * HOUR)
    expect(p?.short).toBe('burning fast')
    expect(p?.tone).toBe('act')
    expect(p?.words).toBe('At this pace it runs out in 1h 20m, 1h 40m before the reset in 3h.')
  })

  test('no reading draws nothing', () => {
    expect(paceView(null, FIVE_HOURS, NOW)).toBe(null)
  })
})

describe('when to act', () => {
  const calm = chatView(152_000, 400_000, 1_000_000)
  const cold = cacheView(NOW - 2 * HOUR, false, HOUR, NOW, 212_000, 100_000)
  const warm = cacheView(NOW - 10 * MINUTE, false, HOUR, NOW, 152_000, 100_000)

  test('a calm session has no second line and no start-fresh nudge', () => {
    expect(actNeeded(calm, warm, null, 152_000)).toBe(null)
    expect(startFreshReason(calm, warm)).toBe(null)
  })

  test('a cold cache on a big chat comes first, with the size in words', () => {
    expect(actNeeded(calm, cold, null, 212_000)?.text).toBe('Cache went cold and this chat is 212k. Your next message re-reads all of it.')
    expect(startFreshReason(calm, cold)).toContain('cache is cold')
  })

  test('a nearly full chat asks to shrink; a big one suggests a fresh start', () => {
    expect(actNeeded(chatView(370_000, 400_000, 1_000_000), warm, null, 370_000)?.kind).toBe('full')
    expect(startFreshReason(chatView(250_000, 400_000, 1_000_000), warm)).toContain('fresh one')
  })
})

describe('cold-send guard', () => {
  const base = { isCold: true, tokens: 212_000, guardTokens: 100_000, originKind: 'composer', text: 'carry on', ackedAt: 0, lastRequestAt: NOW - 2 * HOUR }

  test('holds the first message, lets the acknowledged one through', () => {
    expect(guardDecision(base)).toBe('drop')
    expect(guardDecision({ ...base, ackedAt: base.lastRequestAt })).toBe('pass')
  })

  test('passes warm caches, small chats, commands, plugins; only warns for unattended prompts', () => {
    expect(guardDecision({ ...base, isCold: false })).toBe('pass')
    expect(guardDecision({ ...base, tokens: 50_000 })).toBe('pass')
    expect(guardDecision({ ...base, text: '/compact' })).toBe('pass')
    expect(guardDecision({ ...base, originKind: 'plugin' })).toBe('pass')
    expect(guardDecision({ ...base, guardTokens: 0 })).toBe('pass')
    expect(guardDecision({ ...base, originKind: 'scheduled-trigger' })).toBe('warn')
  })
})

describe('sparkline and raster', () => {
  test('percent readings become block glyphs, newest last', () => {
    expect(sparkline([0, 50, 100], 10)).toBe('▁▅█')
    expect(sparkline([0, 10, 20, 30], 2)).toBe('▂▃')
  })

  test('raster cells pack code point, foreground and background', () => {
    expect(rasterRow('█')).toBe('iCUAAAAAAAEAAAAB')
  })
})

describe('launcher', () => {
  const commands = [
    { name: 'review', description: 'Review the diff' },
    { name: 'compact', description: 'Shrink the chat' },
    { name: 'cockpit', description: 'Open the Control Center' },
    { name: 'graphify', description: 'Turn anything into a knowledge graph' },
  ]

  test('prefix beats substring beats letters in order beats description', () => {
    expect(score('rev', commands[0]!)).toBeGreaterThan(score('vie', commands[0]!))
    expect(score('vie', commands[0]!)).toBeGreaterThan(score('rvw', commands[0]!))
    expect(score('rvw', commands[0]!)).toBeGreaterThan(score('diff', commands[0]!))
    expect(score('zzz', commands[0]!)).toBe(0)
  })

  test('nothing typed: pinned first, then recent', () => {
    const ranked = rankCommands(commands, '', { pinned: ['graphify'], recent: ['compact', 'graphify'] })
    expect(ranked.map(r => `${r.group}:${r.name}`)).toEqual(['pinned:graphify', 'recent:compact'])
  })

  test('typed: best matches, marked with their group', () => {
    const ranked = rankCommands(commands, 'co', { pinned: ['cockpit'], recent: [] })
    expect(ranked.map(r => r.name)).toEqual(['cockpit', 'compact'])
    expect(ranked[0]?.group).toBe('pinned')
  })

  test('recent moves to the front without duplicates; pins toggle', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(togglePin(['a'], 'b')).toEqual(['a', 'b'])
    expect(togglePin(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('limits only climb within their window', () => {
  const at = NOW + 3 * HOUR
  test('a reading with no figure keeps the last one until its window resets', () => {
    expect(holdLimit({ percentUsed: 40, resetsAt: at }, null, NOW)).toEqual({ percentUsed: 40, resetsAt: at })
    expect(holdLimit({ percentUsed: 40, resetsAt: at }, null, at + 1)).toBeNull()
  })
  test('a lower figure for the same window keeps the higher one', () => {
    expect(holdLimit({ percentUsed: 40, resetsAt: at }, { percentUsed: 12, resetsAt: at + MINUTE }, NOW)?.percentUsed).toBe(40)
    expect(holdLimit({ percentUsed: 40, resetsAt: at }, { percentUsed: 44, resetsAt: at }, NOW)?.percentUsed).toBe(44)
  })
  test('a new window may start lower', () => {
    expect(holdLimit({ percentUsed: 90, resetsAt: at }, { percentUsed: 2, resetsAt: at + FIVE_HOURS }, NOW)?.percentUsed).toBe(2)
    expect(holdLimit({ percentUsed: 90, resetsAt: NOW - 1 }, { percentUsed: 2, resetsAt: null }, NOW)?.percentUsed).toBe(2)
  })
})
