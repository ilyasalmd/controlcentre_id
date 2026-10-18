import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { breedOf, effortLevel } from '../hooks/art/crab'
import { agentsTile, cacheTile, HEAT } from '../hooks/art/tiles'
import { DEFAULT_LOOK, parseColor, parseOpacity, phased, ramp } from '../hooks/art/glass'
import { doingOf } from '../hooks/model'

const PLUGIN = 'cockpit'
const NOW = Date.parse('2026-10-17T12:00:00Z')
const HOUR = 3_600_000

const bandProps = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
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

/** The mocked clock of the test running now, which a tap moves past the pad's settle time. */
let worldClock: { advance: (ms: number) => Promise<void> } | undefined

function world(on: On, tokens: number, opened: string[] = [], stored: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  worldClock = clock
  const open = new Set<string>()
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: 'Control Center', isShown: true, isFocused: false, isPlaced: true })) }) as never)
  on('ui.close', (_$, e) => {
    open.delete(e.id)
    return { value: undefined } as never
  })
  mock.store(on, stored)
  on('session.usage', () => ({ value: usageAt(tokens) }) as never)
  on('settings.read', () => ({ value: { autoCompactWindow: 400_000 } }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }) as never)
  on('command.list', () => ({ value: [{ name: 'review', description: 'Review the diff', source: 'builtin' }] }) as never)
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    open.add(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('session.start', () => ({ cwd: '/repo' }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'agent-1' }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  // What the engine draws where Cockpit hands a site on: nothing of Cockpit's.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { clock, open }
}

async function start($: Engine, tokens: number) {
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
  await $.session.measure({ ...usageAt(tokens), changed: ['context', 'rateLimits', 'cost'] } as never)
  await $.turn.start({ text: 'hello', turnId: 't1' } as never)
  await $.turn.complete({ answer: 'done', text: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: REPLY_USAGE } as never)
}

type Node = { props: Record<string, unknown> }
const svgs = async (ui: { findAll: (q: { type: string }) => Promise<Node[]> }) =>
  (await ui.findAll({ type: 'Svg' })).map(n => ({ alt: String(n.props.alt), source: String(n.props.source), isInteractive: n.props.isInteractive }))

/** A left click on the pad over a glass tile, as the desktop hands it to the pad's Client. */
const tap = async (ui: { pointer: (e: { type: 'down'; x: number; y: number; button: 'left'; in: string }) => Promise<void> }, key: string) => {
  await ui.pointer({ type: 'down', x: 2, y: 1, button: 'left', in: `pad-${key}` })
  await worldClock?.advance(500)
}

test('desktop band: always empty; the Control Center is the display and /cockpit toggles it', async ($, on) => {
  const { open } = world(on, 152_000)
  await start($, 152_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: bandProps as never })
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  await ui.unmount()
  open.delete('cockpit')
  const closed = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: bandProps as never })
  expect(await closed.findAll({ type: 'Button' })).toEqual([])
  await closed.unmount()
})

test('desktop: a cold cache on a big chat shows in the tiles, with no text lines, and the guard holds one send', async ($, on) => {
  const { clock } = world(on, 212_000)
  await start($, 212_000)
  await clock.advance(2 * HOUR)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: paneProps as never })
  const alts = (await svgs(ui)).map(t => t.alt)
  expect(alts).toContain('Cache cold: 1h')
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('').replace(/\u2800/g, '')
  expect(lines).toBe('')
  const context = (await svgs(ui)).find(t => t.alt.startsWith('Context'))!.source
  // Context is display only now; Compact is its own round button, lit and pulsing while the chat is big.
  expect(context).not.toContain('points="4 14 10 14 10 20"')
  const compact = (await svgs(ui)).find(t => t.alt === 'Compact')!.source
  expect(compact).toContain('points="4 14 10 14 10 20"')
  expect(compact).toContain('stroke-opacity')
  expect(await ui.find({ key: 'pad-shrink' })).toBeDefined()
  const held = await $.prompt.submit({ text: 'carry on', origin: { kind: 'composer' }, wait: false } as never)
  expect(held).toMatchObject({ drop: expect.stringContaining('Cockpit held this message') })
  const sent = await $.prompt.submit({ text: 'carry on', origin: { kind: 'composer' }, wait: false } as never)
  expect(sent).toMatchObject({ text: 'carry on' })
  await ui.unmount()
})

test('desktop Control Center: a reading with no limit figures, such as after a compact, keeps the gauges where they were', async ($, on) => {
  world(on, 152_000)
  await start($, 152_000)
  await $.session.measure({ context: { tokens: 40_000, window: 1_000_000 }, rateLimits: [], changed: ['context'] } as never)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: paneProps as never })
  const alts = (await svgs(ui)).map(t => t.alt)
  expect(alts).toContain('5-hour limit 78% left: ≈45% left at refill, in 3h')
  expect(alts.some(a => a.startsWith('Weekly limit 59% left'))).toBe(true)
  await ui.unmount()
})

test('desktop Control Center: compacting drains the Context glass from where it stands, then settles on the new size', async ($, on) => {
  const { clock } = world(on, 152_000)
  let during = ''
  on('session.compact', async () => {
    await clock.advance(10_000)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: paneProps as never })
    during = (await svgs(ui)).find(t => t.alt.startsWith('Context'))!.source
    await ui.unmount()
    return { messages: [{ role: 'user', text: 'Summary of the chat so far', toolUses: [], toolResults: [] }], tokensAfter: 20_000 } as never
  })
  await start($, 152_000)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hello', toolUses: [], toolResults: [] }] } as never)
  // Ten seconds into the drain: the frame starts the fall that far in, so a reload shows the same level.
  expect(during).toContain('Compacting')
  expect(during).toContain('begin="-10s"')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: paneProps as never })
  const settling = (await svgs(ui)).find(t => t.alt.startsWith('Context'))!.source
  expect(settling).toContain('fill="freeze"')
  expect(settling).not.toContain('Compacting')
  await ui.unmount()
  await clock.advance(5_000)
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: paneProps as never })
  const tiles = await svgs(after)
  expect(tiles.map(t => t.alt)).toContain('Cache compacted: —')
  const context = tiles.find(t => t.alt.startsWith('Context'))!
  expect(context.alt).toStartWith('Context 5% of the way to auto-compact, 20k of 400k')
  expect(context.source).not.toContain('fill="freeze"')
  await after.unmount()
})

test('desktop Control Center: glass tiles for context, limits, cache, handoff, keep-warm and agents, and round icon buttons', async ($, on) => {
  world(on, 152_000)
  await start($, 152_000)
  await $.agent.spawn({ tool_use_id: 'tu1', prompt: 'look', description: 'Find the auth code', subagentType: 'Explore', provider: { kind: 'model' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/hooks/model.ts', agentId: 'agent-1' } as never)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: paneProps as never })
  const tiles = await svgs(ui)
  const alts = tiles.map(t => t.alt)
  expect(alts).toContain('Context 38% of the way to auto-compact, 152k of 400k. A forecast appears after a few turns.')
  expect(alts).toContain('5-hour limit 78% left: ≈45% left at refill, in 3h')
  expect(alts.some(a => a.startsWith('Weekly limit 59% left, refills in '))).toBe(true)
  expect(alts).toContain('Cache warm: 1h')
  expect(alts).toContain('Agents: 1 working')
  const agents = tiles.find(t => t.alt.startsWith('Agents'))!.source
  expect(agents).toContain('Find the auth code')
  expect(agents).toContain('0 tokens')
  expect(tiles.length).toBe(9)
  expect(alts).toEqual(expect.arrayContaining(['Compact', 'Handoff', 'Keep-warm is off']))
  for (const t of tiles) expect(t.source.length).toBeLessThan(131_072)
  // The crab for a Sonnet agent wears Sonnet blue, and its bubble names what it is doing.
  const stage = tiles.find(t => t.alt.startsWith('Agents'))!.source
  expect(stage).toContain(breedOf('claude-sonnet-5-5').body)
  expect(stage).toContain('Reading model.ts')
  expect(await ui.find({ key: 'quick' })).toBeUndefined()
  // No words, hotkeys or hover bands on the glass: every press is a pad, a Client that draws nothing, laid over
  // a round button; the display tiles take none, and no Button is drawn.
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  expect((await ui.findAll({ type: 'Client' })).length).toBe(4)
  for (const key of ['shrink', 'handoff', 'warm', 'look']) expect(await ui.find({ key: `pad-${key}` })).toBeDefined()
  expect(await ui.find({ key: 'toggle' })).toBeUndefined()
  const words = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('').replace(/\u2800/g, '')
  expect(words).toBe('')
  await tap(ui, 'warm')
  const after = (await svgs(ui)).map(t => t.alt)
  expect(after).toContain('Keep-warm is on')
  await ui.unmount()
})

test('a double click on Keep warm acts once', async ($, on) => {
  world(on, 152_000)
  await start($, 152_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: paneProps as never })
  await tap(ui, 'warm')
  await tap(ui, 'warm')
  expect((await svgs(ui)).map(t => t.alt)).toContain('Keep-warm is on')
  await ui.unmount()
})

test('/cockpit color and opacity tint the glass, and the look is kept for later chats', async ($, on) => {
  world(on, 152_000)
  await start($, 152_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: paneProps as never })
  const before = (await svgs(ui))[0]!.source
  expect(before).toContain('--tint:rgba(16,15,19,0.58)')
  const said = await $.command.run({ command: 'cockpit', args: 'color blue', origin: { kind: 'composer' } } as never)
  expect(JSON.stringify(said)).toContain('tinted blue')
  await $.command.run({ command: 'cockpit', args: 'opacity clear', origin: { kind: 'composer' } } as never)
  const after = (await svgs(ui))[0]!.source
  expect(after).not.toContain('--tint:rgba(16,15,19,')
  expect(after).toMatch(/--tint:rgba\(\d+,\d+,\d+,0\.2\)/)
  const help = await $.command.run({ command: 'cockpit', args: 'color sparkly', origin: { kind: 'composer' } } as never)
  expect(JSON.stringify(help)).toContain('graphite')
  await ui.unmount()
})

test('a look chosen in an earlier chat is worn from the start', async ($, on) => {
  world(on, 152_000, [], { look: { color: '#30D158', opacity: 80 } })
  await start($, 152_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: paneProps as never })
  expect((await svgs(ui))[0]!.source).toMatch(/--tint:rgba\(\d+,\d+,\d+,0\.8\)/)
  await ui.unmount()
})

test('the Customize button opens an Appearance panel whose swatches and steps change the glass', async ($, on) => {
  world(on, 152_000)
  await start($, 152_000)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'cockpit', props: paneProps as never })
  expect((await svgs(ui)).map(t => t.alt)).not.toContain('Appearance')
  await tap(ui, 'look')
  const alts = (await svgs(ui)).map(t => t.alt)
  expect(alts).toContain('Appearance')
  expect(alts.filter(a => a.startsWith('Glass colour')).length).toBe(14)
  expect(alts.filter(a => a.startsWith('Glass opacity')).length).toBe(6)
  await tap(ui, 'color-purple')
  await tap(ui, 'opacity-80')
  expect((await svgs(ui))[0]!.source).toMatch(/--tint:rgba\(\d+,\d+,\d+,0\.8\)/)
  expect((await svgs(ui))[0]!.source).not.toContain('--tint:rgba(16,15,19,')
  await tap(ui, 'look')
  expect((await svgs(ui)).map(t => t.alt)).not.toContain('Appearance')
  await ui.unmount()
})

test('look words: Apple colour names, hex, none; opacity as a percentage or clear and tinted', () => {
  expect(parseColor('Blue')).toBe('#0A84FF')
  expect(parseColor('#aabbcc')).toBe('#AABBCC')
  expect(parseColor('none')).toBeNull()
  expect(parseColor('sparkly')).toBeUndefined()
  expect([parseOpacity('40%'), parseOpacity('140'), parseOpacity('clear'), parseOpacity('tinted'), parseOpacity('default'), parseOpacity('x')]).toEqual([40, 100, 20, 80, DEFAULT_LOOK.opacity, undefined])
})

test('the Control Center opens by itself when a chat starts, unless turned off', async ($, on) => {
  const opened: string[] = []
  world(on, 152_000, opened)
  await start($, 152_000)
  expect(opened).toContain('cockpit')
})

test('openAtStart off keeps the Control Center closed', { options: { openAtStart: false } }, async ($, on) => {
  const opened: string[] = []
  world(on, 152_000, opened)
  await start($, 152_000)
  expect(opened).not.toContain('cockpit')
})

test('agent activity reads as plain words', () => {
  expect(doingOf('Read', { file_path: '/a/b/state.ts' })).toBe('Reading state.ts')
  expect(doingOf('Grep', { pattern: 'agent.spawn' })).toBe('Searching "agent.spawn"')
  expect(doingOf('Bash', { command: 'npm test -- --watch' })).toBe('Running npm test')
  expect(doingOf('Bash', { command: 'ls', description: 'List files' })).toBe('List files')
  expect(doingOf('WebFetch', { url: 'https://example.com/x' })).toBe('Reading example.com')
  expect(doingOf('mcp__github__create_issue', {})).toBe('Using create issue')
})

test('crabs: breed by model family, effort as five levels', () => {
  expect(breedOf('claude-opus-5-5').hat).toBe('cap')
  expect(breedOf('claude-haiku-5-5').family).toBe('Haiku')
  expect(breedOf('some-other-model').family).toBe('Agent')
  expect([undefined, 'low', 'medium', 'high', 'xhigh', 'max', 40_000].map(e => effortLevel(e))).toEqual([0, 1, 2, 3, 4, 5, 5])
})

test('cache heat runs hot when fresh and cools toward expiry; cold turns to ice', () => {
  expect(ramp(HEAT, 1)).toBe('#ff5636')
  expect(ramp(HEAT, 0).toLowerCase()).toBe('#9db4c8')
  const cold = cacheTile({ kind: 'cold', leftFrac: 0, value: '12m', caption: 'cold', isKeptWarm: false, tone: 'act' })
  expect(cold).toContain('#8CCBFF')
  expect(agentsTile([], 'Idle')).toContain('No agents working')
})

test('looping animations start where the clock says, so a reloaded frame carries on mid-loop', () => {
  const svg = '<animate values="0;1" dur="4s" repeatCount="indefinite"/><animate dur="2s" begin="0.5s" repeatCount="indefinite"/><animateTransform dur="40s" begin="-3s" fill="freeze"/>'
  const out = phased(svg, 1001)
  expect(out).toContain('begin="-1s" dur="4s"')
  expect(out).toContain('dur="2s" begin="-0.5s"')
  expect(out).toContain('dur="40s" begin="-3s" fill="freeze"')
  expect(phased(svg, 1001)).toBe(out)
})

test('desktop footer: a button after the mode labels opens the Control Center, and turns into an × that closes it', async ($, on) => {
  const { open } = world(on, 152_000)
  await start($, 152_000)
  open.delete('cockpit')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'SessionMode', props: { modes: ['focus'] } as never })
  const glyph = async () => (await ui.findAll({ type: 'Text' })).map(n => n.text)
  expect(JSON.stringify(await glyph())).toContain('focus')
  expect(JSON.stringify(await glyph())).toContain('⚌')
  expect(await svgs(ui)).toEqual([])
  await ui.press({ key: 'launch' })
  expect(open.has('cockpit')).toBe(true)
  expect(JSON.stringify(await glyph())).toContain('✕')
  await ui.press({ key: 'launch' })
  expect(open.has('cockpit')).toBe(false)
  expect(JSON.stringify(await glyph())).toContain('⚌')
  await ui.unmount()
})
