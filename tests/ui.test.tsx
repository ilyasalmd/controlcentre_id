import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'cockpit'
const SURFACES = ['terminal', 'desktop'] as const
const NOW = Date.parse('2026-10-17T12:00:00Z')
const HOUR = 3_600_000

const bandProps = (bodyColumns: number, isWorking = false) => ({
  hasSurvey: false, isWorking, maxRows: 6, bodyColumns, scroll: { offset: 0, bodyRows: 6 }, view: {},
})
const paneProps = { title: 'Control Center', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as const

const REPLY_USAGE = { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 2_000 }

const usageAt = (tokens: number) => ({
  startedAt: NOW - HOUR,
  context: { tokens, window: 1_000_000, percent: Math.round(tokens / 10_000) },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 22, resetsAt: new Date(NOW + 3 * HOUR).toISOString() },
    { kind: 'seven_day', percentUsed: 41, resetsAt: new Date(NOW + 72 * HOUR).toISOString() },
  ],
  cost: { usd: 4.12 },
})

/** The world beneath Cockpit: a clock, a store, the session's figures and the engine's answers. */
function world(on: On, tokens: { now: number }) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.usage', () => ({ value: usageAt(tokens.now) }) as never)
  on('settings.read', () => ({ value: { autoCompactWindow: 400_000 } }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }) as never)
  on('command.list', () => ({
    value: [
      { name: 'review', description: 'Review the diff', source: 'builtin' },
      { name: 'graphify', description: 'Turn anything into a knowledge graph', source: 'skill' },
      { name: 'compact', description: 'Shrink the chat', source: 'builtin' },
    ],
  }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.start', () => ({ cwd: '/repo' }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-1' }))
  return clock
}

async function start($: Engine, tokens: number) {
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.session.measure({ ...usageAt(tokens), changed: ['context', 'rateLimits', 'cost'] } as never)
  await $.turn.start({ text: 'hello', turnId: 't1' } as never)
  await $.turn.complete({ answer: 'done', text: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: REPLY_USAGE } as never)
}

/** Every leaf Text in drawing order, so nested runs are counted once. */
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string; children: unknown[] }[]> }) =>
  (await ui.findAll({ type: 'Text' }))
    .filter(t => t.children.every(c => typeof c === 'string'))
    .map(t => t.text)
    .join('')

for (const surface of SURFACES) {
  test(`${surface}: calm band is one line with the three facts`, async ($, on) => {
    // The desktop draws these facts as Liquid Glass art: glass.test.tsx checks them there.
    if (surface !== 'terminal') return
    world(on, { now: 152_000 })
    await start($, 152_000)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(100) as never })
    const all = await texts(ui)
    expect(all).toContain('Chat 38%')
    expect(all).toContain('Cache warm 1h')
    expect(all).toContain('5h 22% on pace')
    expect(await ui.find({ key: 'shrink' })).toBeDefined()
    expect((await ui.find({ key: 'handoff' }))?.props.label).toBe('Handoff')
    expect((await ui.find({ key: 'open' }))?.props.label).toBe(surface === 'terminal' ? '⌘' : 'Control Center')
    expect(await ui.find({ key: 'act-shrink' })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: the band adapts to narrow and wide widths`, async ($, on) => {
    // The desktop draws these facts as Liquid Glass art: glass.test.tsx checks them there.
    if (surface !== 'terminal') return
    world(on, { now: 152_000 })
    await start($, 152_000)
    const narrow = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(64) as never })
    const small = await texts(narrow)
    for (const fact of ['● 38% · ', 'warm 1h · ', '5h 22%']) expect(small).toContain(fact)
    expect(small).not.toContain('Chat 38%')
    expect(small).not.toContain('on pace')
    expect(await narrow.find({ key: 'shrink' })).toBeUndefined()
    expect((await narrow.find({ key: 'open' }))?.props.label).toBe('⌘')
    await narrow.unmount()

    const wide = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(170) as never })
    expect(await texts(wide)).toContain('of 400k')
    expect(await texts(wide)).toContain('Week 41%')
    expect((await wide.find({ key: 'open' }))?.props.label).toBe('⌘ Control Center')
    expect(await wide.find({ key: 'warm' })).toBeDefined()
    await wide.unmount()
  })

  test(`${surface}: a cold cache on a big chat grows the act line, and the guard holds one send`, async ($, on) => {
    // The band is the terminal's; the desktop's always-open Control Center carries this (glass.test.tsx).
    if (surface !== 'terminal') return
    const tokens = { now: 212_000 }
    const clock = world(on, tokens)
    await start($, 212_000)
    await clock.advance(2 * HOUR)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(110) as never })
    expect(await texts(ui)).toContain('Cache cold · next message re-reads 212k')
    const roomy = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(170) as never })
    expect(await texts(roomy)).toContain('Cache went cold and this chat is 212k. Your next message re-reads all of it.')
    await roomy.unmount()
    expect((await ui.find({ key: 'act-shrink' }))?.props.label).toBe('Compact first')
    expect((await ui.find({ key: 'act-shrink' }))?.props.variant).toBe('primary')
    expect((await ui.find({ key: 'handoff' }))).toBeUndefined()

    const held = await $.prompt.submit({ text: 'carry on', origin: { kind: 'composer' }, wait: false } as never)
    expect(held).toMatchObject({ drop: expect.stringContaining('Cockpit held this message') })
    const sent = await $.prompt.submit({ text: 'carry on', origin: { kind: 'composer' }, wait: false } as never)
    expect(sent).toMatchObject({ text: 'carry on' })
    await ui.unmount()
  })

  test(`${surface}: Send anyway lets the next message through and says so`, async ($, on) => {
    // The band is the terminal's; the desktop's always-open Control Center carries this (glass.test.tsx).
    if (surface !== 'terminal') return
    const clock = world(on, { now: 212_000 })
    await start($, 212_000)
    await clock.advance(2 * HOUR)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(110) as never })
    await ui.press({ key: 'act-send' })
    expect(await texts(ui)).toContain('Your next message goes through')
    const sent = await $.prompt.submit({ text: 'go', origin: { kind: 'composer' }, wait: false } as never)
    expect(sent).toMatchObject({ text: 'go' })
    await ui.unmount()
  })

  test(`${surface}: before any plan reading the cache is still treated as a 1-hour cache`, async ($, on) => {
    // The desktop draws these facts as Liquid Glass art: glass.test.tsx checks them there.
    if (surface !== 'terminal') return
    const clock = world(on, { now: 152_000 })
    await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await $.session.measure({ context: { tokens: 152_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] } as never)
    await $.turn.start({ text: 'hello', turnId: 't1' } as never)
    await $.turn.complete({ answer: 'done', text: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: REPLY_USAGE } as never)
    await clock.advance(23 * 60_000)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(100) as never })
    expect(await texts(ui)).toContain('Cache warm 37m')
    await ui.unmount()
  })

  test(`${surface}: a turn that failed before any reply leaves the cache clock alone`, async ($, on) => {
    // The desktop draws these facts as Liquid Glass art: glass.test.tsx checks them there.
    if (surface !== 'terminal') return
    world(on, { now: 0 })
    await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await $.session.measure({ context: { tokens: 0, window: 1_000_000 }, rateLimits: [], changed: ['context'] } as never)
    await $.turn.start({ text: 'hello', turnId: 't1' } as never)
    await $.turn.complete({ answer: '', text: '', durationMs: 2000, isAborted: false, turnId: 't1', reason: 'error' } as never)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(100) as never })
    expect(await texts(ui)).toContain('Cache –')
    expect(await texts(ui)).not.toContain('Cache warm')
    await ui.unmount()
  })

  test(`${surface}: while working the band shows the turn instead of the limits`, async ($, on) => {
    // The desktop draws these facts as Liquid Glass art: glass.test.tsx checks them there.
    if (surface !== 'terminal') return
    world(on, { now: 152_000 })
    await start($, 152_000)
    await $.turn.start({ text: 'next', turnId: 't2' } as never)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(100, true) as never })
    const all = await texts(ui)
    expect(all).toContain('Working 0s')
    expect(all).toContain('0 tools')
    expect(all).not.toContain('5h 22%')
    await ui.unmount()
  })

  test(`${surface}: a big chat turns Handoff into a highlighted Start fresh`, async ($, on) => {
    // The band is the terminal's; the desktop's always-open Control Center carries this (glass.test.tsx).
    if (surface !== 'terminal') return
    world(on, { now: 260_000 })
    await start($, 260_000)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(110) as never })
    const handoff = await ui.find({ key: 'handoff' })
    expect(handoff?.props.label).toBe('Start fresh')
    expect(handoff?.props.variant).toBe('primary')
    await ui.unmount()
  })

  test(`${surface}: the Control Center has its five sections, agent cards and a launcher that remembers`, async ($, on) => {
    // The desktop draws these facts as Liquid Glass art: glass.test.tsx checks them there.
    if (surface !== 'terminal') return
    world(on, { now: 152_000 })
    await start($, 152_000)
    await $.agent.spawn({ tool_use_id: 'tu1', prompt: 'look', description: 'Find the auth code', subagentType: 'Explore', provider: { kind: 'model' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'cockpit', props: paneProps as never })
    const all = await texts(ui)
    for (const heading of ['Session', 'Limits', 'Activity', 'Actions', 'Launcher']) expect(all).toContain(heading)
    expect(all).toContain('152k of 400k compact point')
    expect(all).toContain('Lasts until the reset in 3h')
    expect(all).toContain('Worth $4.12 at API prices · not a bill on your plan')
    expect(all).toContain('Sonnet 5.5')
    for (const key of ['shrink', 'quick', 'full', 'warm']) expect(await ui.find({ key })).toBeDefined()

    await ui.press({ key: 'agent-row-agent-1' })
    expect(await texts(ui)).toContain('Find the auth code')

    await ui.input({ key: 'filter', text: 'gra' })
    expect(await ui.find({ key: 'run-graphify' })).toBeDefined()
    await ui.press({ key: 'pin-graphify' })
    await ui.input({ key: 'filter', text: '' })
    expect(await texts(ui)).toContain('Pinned')
    expect((await ui.find({ key: 'run-graphify' }))?.props.hotkey).toBe('1')
    await ui.unmount()
  })
}
