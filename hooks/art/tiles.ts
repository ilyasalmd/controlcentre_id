// The Control Center tiles, each a Liquid Glass SVG document drawn from plain figures.
// Grid: a 76-pixel unit with 10-pixel gaps, so a 2×2 tile is 162 square and the full width is 334.

import { crab, crabTitle, breedOf, effortLevel, pips, starburst } from './crab'
import type { CrabState } from './crab'
import { INK, clip, esc, mix, n2, ramp, tile } from './glass'

export const U = 76
export const GAP = 10
export const SPAN2 = U * 2 + GAP
export const FULL = U * 4 + GAP * 3

export type Tone = 'fine' | 'watch' | 'act'
const TONE_INK: Record<Tone, string> = { fine: INK.coral, watch: INK.amber, act: INK.red }

// ── Icons: Lucide (lucide.dev, ISC licence), drawn on its 24-unit grid with round 2-unit strokes ──

const LUCIDE = {
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  minimize: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  fuel: '<line x1="3" x2="15" y1="22" y2="22"/><line x1="4" x2="14" y1="9" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
  palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
} as const

/** A Lucide icon centred on (cx, cy), `size` pixels across; a spinning one turns about its centre. */
function icon(name: keyof typeof LUCIDE, cx: number, cy: number, size: number, color: string, isSpinning = false): string {
  const spin = isSpinning ? '<animateTransform attributeName="transform" type="rotate" values="0 12 12;360 12 12" dur="1s" repeatCount="indefinite"/>' : ''
  return `<g transform="translate(${n2(cx - size / 2)} ${n2(cy - size / 2)}) scale(${n2(size / 24)})"><g fill="none" stroke="${color}" color="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${LUCIDE[name]}${spin}</g></g>`
}

// ── Context: a glass of liquid, filled toward the auto-compact line ─────────

/** A drain under way: the liquid falls from `fromPct` to `toPct` over `durS`, of which `sinceS` has passed already. */
export type Drain = { fromPct: number; toPct: number; durS: number; sinceS: number }

export type ContextArt = {
  pct: number
  tokens: string
  compactAt: string
  forecast: string
  tone: Tone
  isWorking: boolean
  /** Set while compacting and for a moment after: the glass drains, starting where the clock says it has got to. */
  drain?: Drain
  isCompacting?: boolean
}

export function contextTile(a: ContextArt): string {
  const w = SPAN2
  const h = SPAN2
  const top = 34
  const bottom = h - 8
  const surfaceAt = (pct: number) => n2(bottom - (bottom - top) * Math.min(1, Math.max(0, pct / 100)))
  const level = Math.min(1, Math.max(0, (a.drain ? a.drain.fromPct : a.pct) / 100))
  const surface = surfaceAt(a.drain ? a.drain.fromPct : a.pct)
  // A negative begin starts the fall part-way through, so a frame that reloads mid-drain shows the same level.
  const fall = a.drain
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${n2(surfaceAt(a.drain.toPct) - surface)}" dur="${n2(a.drain.durS)}s" begin="${n2(-a.drain.sinceS)}s" fill="freeze"/>`
    : ''
  const ink = TONE_INK[a.tone]
  const deep = mix(ink, '#1A0604', 0.38)
  const wave = (amp: number, len: number, y: number) => {
    let d = `M${-len} ${y}`
    for (let x = -len; x < w + len; x += len) d += ` q${len / 4} ${-amp} ${len / 2} 0 t${len / 2} 0`
    return `${d} V${h + 4} H${-len} Z`
  }
  const bubbles = a.isWorking
    ? [0.22, 0.48, 0.71, 0.36]
        .map(
          (x, i) =>
            `<circle cx="${n2(w * x)}" cy="${bottom}" r="${2 + (i % 2)}" fill="#fff" opacity="0"><animate attributeName="cy" values="${bottom};${surface + 6}" dur="${2.2 + i * 0.5}s" begin="${i * 0.7}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;.55;0" dur="${2.2 + i * 0.5}s" begin="${i * 0.7}s" repeatCount="indefinite"/></circle>`,
        )
        .join('')
    : ''
  const liquid = level > 0
    ? `<g>${fall}<path d="${wave(3.2, 54, surface + 2)}" fill="${deep}" opacity=".85"><animateTransform attributeName="transform" type="translate" values="0 0;54 0" dur="5.5s" repeatCount="indefinite"/></path><path d="${wave(4, 72, surface)}" fill="url(#liq)"><animateTransform attributeName="transform" type="translate" values="0 0;-72 0" dur="3.8s" repeatCount="indefinite"/></path>${bubbles}</g>`
    : ''
  const body = `${liquid}
<path d="M10 ${top}H${w - 10}" stroke="var(--fg)" stroke-opacity=".55" stroke-width="1" stroke-dasharray="2 4"/>
<text class="t d" x="${w - 12}" y="${top - 5}" font-size="9" text-anchor="end" font-weight="600">AUTO-COMPACT</text>
<text class="t" x="14" y="24" font-size="13" font-weight="650">Context</text>
${a.isCompacting
    ? `<text class="t" x="14" y="${h / 2 + 8}" font-size="20" font-weight="700">Compacting<animate attributeName="opacity" values="1;.55;1" dur="1.8s" repeatCount="indefinite"/></text>
<text class="t d" x="14" y="${h / 2 + 26}" font-size="11" font-weight="600">was ${esc(a.tokens)}</text>`
    : `<text class="t" x="14" y="${h / 2 + 13}" font-size="44" font-weight="700" style="paint-order:stroke;stroke:rgba(0,0,0,.12);stroke-width:2">${a.pct}<tspan font-size="22" dx="1">%</tspan></text>
<text class="t d" x="14" y="${h / 2 + 31}" font-size="11" font-weight="600">${esc(a.tokens)} of ${esc(a.compactAt)}</text>`}`
  return tile({
    w, h, body,
    title: `Context ${a.pct}% of the way to auto-compact: ${a.tokens} of ${a.compactAt}. ${a.forecast}`,
    glows: [{ color: ink, x: 0.3, y: 0.85, r: 0.55, opacity: 0.7 }, { color: '#5B6CFF', x: 0.95, y: 0.1, r: 0.4, opacity: 0.35 }],
    extraDefs: `<linearGradient id="liq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(ink, '#ffffff', 0.25)}" stop-opacity=".95"/><stop offset="1" stop-color="${deep}" stop-opacity=".95"/></linearGradient>`,
  })
}

// ── 5-hour limit: a fuel gauge, the needle falling from F to E as the window is used ────────

/** `leftAtRefill`: the fuel forecast to be left when the window refills, at the pace so far; marked on the dial. */
export type GaugeArt = { label: string; left: number | null; status: string; detail: string; tone: Tone; leftAtRefill?: number | null }

/** A point on a dial: `deg` counted anticlockwise from three o'clock, as on paper. */
const onDial = (cx: number, cy: number, r: number, deg: number) => {
  const t = (deg * Math.PI) / 180
  return `${n2(cx + Math.cos(t) * r)} ${n2(cy - Math.sin(t) * r)}`
}

/** The arc of a dial from one angle clockwise to a lower one. */
const dialArc = (cx: number, cy: number, r: number, from: number, to: number) =>
  `M${onDial(cx, cy, r, from)}A${r} ${r} 0 ${from - to > 180 ? 1 : 0} 1 ${onDial(cx, cy, r, to)}`

/** The needle is drawn where the reading is, never swept in from E, so a redraw shows the same gauge. */
export function gaugeTile(a: GaugeArt): string {
  const w = SPAN2
  const h = SPAN2
  const cx = w / 2
  const cy = 100
  const r = 54
  const E = 200
  const F = -20
  const sweep = E - F
  const left = a.left === null ? 0 : Math.min(1, Math.max(0, a.left / 100))
  const at = E - sweep * left
  const ink = TONE_INK[a.tone]
  const lo = mix(ink, '#FFD27A', 0.35)
  const ticks = Array.from({ length: 9 }, (_, i) => {
    const deg = E - (sweep * i) / 8
    const isMajor = i % 2 === 0
    return `<path d="M${onDial(cx, cy, r - 13, deg)}L${onDial(cx, cy, r - (isMajor ? 21 : 17), deg)}" stroke="var(--fg)" stroke-opacity="${isMajor ? 0.55 : 0.3}" stroke-width="${isMajor ? 1.6 : 1}" stroke-linecap="round"/>`
  }).join('')
  const reserve = `<path d="${dialArc(cx, cy, r, E, E - sweep * 0.15)}" fill="none" stroke="${INK.red}" stroke-opacity=".35" stroke-width="9" stroke-linecap="round"/>`
  const fuel = a.left === null || left <= 0
    ? ''
    : `<path d="${dialArc(cx, cy, r, E, at)}" fill="none" stroke="url(#fuelG)" stroke-width="9" stroke-linecap="round"/>`
  // The forecast: the fuel still to burn before the refill shaded on the arc, and a tick where the needle will stop.
  const willBurn = a.left !== null && a.leftAtRefill != null && a.leftAtRefill < a.left
  const stopAt = E - sweep * Math.max(0, (a.leftAtRefill ?? 0) / 100)
  const forecast = willBurn
    ? `<path d="${dialArc(cx, cy, r, stopAt, at)}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="9" stroke-dasharray="1.5 2.5"/><path d="M${onDial(cx, cy, r - 7, stopAt)}L${onDial(cx, cy, r + 7, stopAt)}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`
    : ''
  const tip = onDial(cx, cy, r - 6, at)
  const base1 = onDial(cx, cy, 3.2, at + 90)
  const base2 = onDial(cx, cy, 3.2, at - 90)
  const tail = onDial(cx, cy, 10, at + 180)
  const needle = `<g opacity="${a.left === null ? 0.35 : 1}"><g><path d="M${tip}L${base1}L${tail}L${base2}Z" fill="${a.left === null ? 'var(--fg)' : '#fff'}" stroke="rgba(0,0,0,.28)" stroke-width=".8" stroke-linejoin="round"/><animateTransform attributeName="transform" type="rotate" values="0 ${cx} ${cy};-.8 ${cx} ${cy};.5 ${cx} ${cy};0 ${cx} ${cy}" dur="3.2s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/></g><circle cx="${cx}" cy="${cy}" r="5.5" fill="${ink}" stroke="#fff" stroke-opacity=".8" stroke-width="1.4"/></g>`
  const mark = (deg: number, text: string, color: string) => {
    const [x, y] = onDial(cx, cy, r - 30, deg).split(' ')
    return `<text class="t" x="${x}" y="${n2(Number(y) + 4)}" font-size="11" font-weight="750" text-anchor="middle" fill="${color}">${text}</text>`
  }
  const body = `<path d="${dialArc(cx, cy, r, E, F)}" fill="none" stroke="var(--track)" stroke-width="9" stroke-linecap="round"/>${reserve}${fuel}${forecast}${ticks}
${mark(E - 6, 'E', INK.red)}${mark(F + 6, 'F', 'var(--fg)')}${icon('fuel', cx, cy - 22, 15, a.left !== null && left < 0.15 ? INK.red : 'var(--fg)')}${needle}
<text class="t" x="14" y="24" font-size="13" font-weight="650">${esc(a.label)}</text>
<text class="t" x="${cx}" y="${h - 22}" font-size="21" font-weight="700" text-anchor="middle">${a.left === null ? '—' : `${a.left}<tspan font-size="12">% left</tspan>`}</text>
<text class="t d" x="${cx}" y="${h - 8}" font-size="9.5" font-weight="550" text-anchor="middle">${esc(clip(a.status ? `${a.status} · ${a.detail}` : a.detail, 32))}</text>`
  return tile({
    w, h, body,
    title: `${a.label} limit: ${a.left === null ? 'no figures yet' : `${a.left}% left`}. ${a.status}. ${a.detail}`,
    glows: [{ color: ink, x: 0.5, y: 0.55, r: 0.45, opacity: 0.5 }, { color: '#7A5CFF', x: 0.05, y: 1, r: 0.35, opacity: 0.3 }],
    extraDefs: `<linearGradient id="fuelG" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${ink}"/><stop offset="1" stop-color="${lo}"/></linearGradient>`,
  })
}

// ── Cache heat sensor: a thermometer that cools as the cache ages ───────────

export type CacheArt = { kind: 'none' | 'warm' | 'cold'; leftFrac: number; value: string; caption: string; isKeptWarm: boolean; tone: Tone }

/** Heat from fresh (1) to about to expire (0). */
export const HEAT = [[0, '#9DB4C8'], [0.2, '#F7D488'], [0.55, '#FFA14A'], [1, '#FF5636']] as const

export function cacheTile(a: CacheArt): string {
  const w = U
  const h = SPAN2
  const tx = w / 2
  const tTop = 30
  const tBot = h - 50
  const tw = 16
  const isWarm = a.kind === 'warm'
  const frac = isWarm ? Math.max(0.04, a.leftFrac) : 0
  const color = isWarm ? ramp(HEAT, a.leftFrac) : a.kind === 'cold' ? INK.ice : '#8A8790'
  const fillTop = n2(tBot - (tBot - tTop) * frac)
  const shimmer = isWarm
    ? [-5, 0, 5]
        .map(
          (dx, i) =>
            `<path d="M${tx + dx} ${fillTop - 2}q3 -5 0 -10q-3 -5 0 -10" stroke="${color}" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0"><animate attributeName="opacity" values="0;.7;0" dur="2.4s" begin="${i * 0.6}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 4;0 -8" dur="2.4s" begin="${i * 0.6}s" repeatCount="indefinite"/></path>`,
        )
        .join('')
    : ''
  const frost = a.kind === 'cold'
    ? `<g stroke="${INK.ice}" stroke-width="1.4" stroke-linecap="round" transform="translate(${tx} ${(tTop + tBot) / 2})">${[0, 60, 120].map(d => `<path d="M0 -9V9M-3 -6l3 3 3 -3M-3 6l3 -3 3 3" transform="rotate(${d})"/>`).join('')}<animateTransform attributeName="transform" type="rotate" values="0;30;0" dur="8s" repeatCount="indefinite" additive="sum"/></g>`
    : ''
  const flame = a.isKeptWarm
    ? `<g transform="translate(${w - 20} 10)"><path d="M6 0c1 4 5 5 5 9.5a5 5 0 0 1-10 0c0-2.5 1.6-3.6 2.3-5.6c.8 1.4 1.7 1.8 2.2 2.4C6 4.4 5.6 2 6 0Z" fill="${INK.coralHot}"><animate attributeName="opacity" values=".75;1;.75" dur="1.4s" repeatCount="indefinite"/></path><title>Keep-warm is on</title></g>`
    : ''
  const body = `<text class="t" x="12" y="22" font-size="12" font-weight="650">Cache</text>${flame}
<rect x="${tx - tw / 2}" y="${tTop}" width="${tw}" height="${tBot - tTop}" rx="${tw / 2}" fill="var(--track)"/>
${isWarm ? `<rect x="${tx - tw / 2}" y="${fillTop}" width="${tw}" height="${n2(tBot - fillTop)}" rx="${tw / 2}" fill="url(#heatG)"/><rect x="${tx - tw / 2 + 3}" y="${fillTop + 3}" width="3" height="${n2(Math.max(0, tBot - fillTop - 10))}" rx="1.5" fill="#fff" opacity=".35"/>` : ''}
<circle cx="${tx}" cy="${tBot + 4}" r="${tw * 0.72}" fill="${a.kind === 'none' ? 'var(--track)' : color}"/>${isWarm ? `<circle cx="${tx}" cy="${tBot + 4}" r="${tw * 0.72 + 5}" fill="${color}" opacity=".25"><animate attributeName="r" values="${tw * 0.72 + 2};${tw * 0.72 + 7};${tw * 0.72 + 2}" dur="2s" repeatCount="indefinite"/></circle>` : ''}
${shimmer}${frost}
<text class="t" x="${tx}" y="${h - 18}" font-size="17" font-weight="700" text-anchor="middle">${esc(a.value)}</text>
<text class="t d" x="${tx}" y="${h - 6}" font-size="9" font-weight="600" text-anchor="middle">${esc(a.caption.toUpperCase())}</text>`
  return tile({
    w, h, body, r: 24,
    title: `Cache ${a.caption}: ${a.value}.${a.isKeptWarm ? ' Keep-warm is on.' : ''}`,
    glows: [{ color, x: 0.5, y: 0.75, r: 0.55, opacity: isWarm ? 0.8 : 0.45 }, { color: isWarm ? '#FF2E63' : '#3A7BFF', x: 0.5, y: 0.1, r: 0.35, opacity: 0.25 }],
    extraDefs: `<linearGradient id="heatG" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${mix(color, '#ffffff', 0.15)}"/><stop offset="1" stop-color="${color}"/></linearGradient>`,
  })
}

// ── Weekly limit: a fuel tank ───────────────────────────────────────────────

export type TankArt = { label: string; left: number | null; caption: string; tone: Tone }

/** The week as a fuel tank: the liquid is what is left, with F, half and E marked up its side. */
export function tankTile(a: TankArt): string {
  const w = U
  const h = SPAN2
  const frac = a.left === null ? 0 : Math.min(1, Math.max(0, a.left / 100))
  // Liquid, as in the Context glass: a thin layer still shows as a pool with a moving surface, never a sliver.
  const surface = n2(frac > 0 ? Math.min(h - 12, h - h * frac) : h + 6)
  const ink = a.tone === 'fine' ? '#8E9BFF' : TONE_INK[a.tone]
  const deep = mix(ink, '#0B0A1A', 0.45)
  const wave = (amp: number, len: number, y: number) => {
    let d = `M${-len} ${y}`
    for (let x = -len; x < w + len; x += len) d += ` q${len / 4} ${-amp} ${len / 2} 0 t${len / 2} 0`
    return `${d} V${h + 4} H${-len} Z`
  }
  const liquid = frac > 0
    ? `<path d="${wave(2.2, 38, surface + 2)}" fill="${deep}" opacity=".7"><animateTransform attributeName="transform" type="translate" values="0 0;38 0" dur="6s" repeatCount="indefinite"/></path><path d="${wave(2.6, 48, surface)}" fill="url(#wk)"><animateTransform attributeName="transform" type="translate" values="0 0;-48 0" dur="4.4s" repeatCount="indefinite"/></path>`
    : ''
  const scale = [['F', 0.12], ['½', 0.5], ['E', 0.88]] as const
  const marks = scale
    .map(([t, y]) => `<path d="M${w - 12} ${n2(h * y)}h6" stroke="var(--fg)" stroke-opacity=".5" stroke-width="1.4" stroke-linecap="round"/><text class="t d" x="${w - 15}" y="${n2(h * y + 3.5)}" font-size="9" font-weight="750" text-anchor="end"${t === 'E' ? ` fill="${INK.red}" fill-opacity=".85"` : ''}>${t}</text>`)
    .join('')
  const body = `${liquid}${marks}
<text class="t" x="12" y="22" font-size="12" font-weight="650">${esc(a.label)}</text>
<text class="t" x="12" y="${h - 26}" font-size="21" font-weight="700">${a.left === null ? '—' : `${a.left}<tspan font-size="12">%</tspan>`}</text>
<text class="t d" x="12" y="${h - 11}" font-size="9" font-weight="650">${esc(clip(a.caption, 12).toUpperCase())}</text>`
  return tile({
    w, h, body, r: 24,
    title: `${a.label} limit: ${a.left === null ? 'no figures yet' : `${a.left}% left`}, ${a.caption}.`,
    glows: [{ color: '#6E7BFF', x: 0.5, y: 0.2, r: 0.5, opacity: 0.4 }, { color: ink, x: 0.5, y: 0.95, r: 0.45, opacity: 0.45 }],
    extraDefs: `<linearGradient id="wk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(ink, '#ffffff', 0.3)}" stop-opacity=".78"/><stop offset="1" stop-color="${deep}" stop-opacity=".7"/></linearGradient>`,
  })
}

// ── Round buttons: iPhone Control Center circles, the icon alone ──────────

export type RoundKind = 'compact' | 'handoff' | 'warm' | 'look'
export type RoundArt = { kind: RoundKind; isOn?: boolean; isBusy?: boolean; isSuggested?: boolean; title: string }

const ROUND_ICON: Record<RoundKind, keyof typeof LUCIDE> = { compact: 'minimize', handoff: 'send', warm: 'flame', look: 'palette' }
const ROUND_INK: Record<RoundKind, string> = { compact: INK.coral, handoff: INK.coral, warm: INK.coralHot, look: INK.coral }

/** On or busy: a white disc with the icon in colour, as iOS draws a switched-on control; suggested: a coral pulse. */
export function roundTile(a: RoundArt): string {
  const s = U
  const c = s / 2
  const ink = ROUND_INK[a.kind]
  const lit = a.isOn === true || a.isBusy === true
  const disc = lit
    ? `<circle cx="${c}" cy="${c}" r="${c}" fill="#fff" opacity=".94"/>`
    : ''
  const pulse = a.isSuggested && !lit
    ? `<circle cx="${c}" cy="${c}" r="${c - 3}" fill="none" stroke="${INK.coral}" stroke-width="2.5"><animate attributeName="stroke-opacity" values=".15;.95;.15" dur="1.8s" repeatCount="indefinite"/></circle>`
    : ''
  const glyph = a.isBusy ? icon('loader', c, c, 26, ink, true) : icon(ROUND_ICON[a.kind], c, c, 26, lit ? ink : 'var(--fg)')
  return tile({
    w: s, h: s, isCircle: true, drift: false, title: a.title,
    body: `${disc}${pulse}${glyph}`,
    glows: [{ color: lit ? ink : '#8E8AA0', x: 0.5, y: 0.6, r: 0.6, opacity: lit ? 0.8 : 0.45 }, { color: '#5B6CFF', x: 0.8, y: 0.1, r: 0.35, opacity: 0.25 }],
  })
}

// ── Appearance: the panel the Customize button opens, its colour swatches and opacity steps ──

/** The glass panel the swatches sit on, as wide as the grid. */
export function appearanceTile(): string {
  return tile({
    w: FULL, h: 164, r: 26, title: 'Appearance', drift: false,
    body: `<text class="t" x="14" y="22" font-size="12" font-weight="650">Appearance</text>`,
    glows: [{ color: '#BF5AF2', x: 0.15, y: 0.4, r: 0.35, opacity: 0.35 }, { color: '#0A84FF', x: 0.6, y: 0.8, r: 0.35, opacity: 0.3 }, { color: INK.coral, x: 0.95, y: 0.2, r: 0.3, opacity: 0.35 }],
  })
}

/** A swatch's drawn size: a 30-pixel disc with 6 pixels round it for the selection ring. */
export const SWATCH = 42

const swatchDoc = (body: string, title: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SWATCH} ${SWATCH}" width="${SWATCH}" height="${SWATCH}"><title>${esc(title)}</title>${body}</svg>`

const ring = (isSelected: boolean) =>
  isSelected ? `<circle cx="21" cy="21" r="19" fill="none" stroke="#fff" stroke-width="2"/>` : ''

/** One colour: a glossy disc, or for none the neutral smoke struck through; ringed when chosen. */
export function swatchTile(o: { color: string | null; name: string; isSelected: boolean }): string {
  const disc = o.color
    ? `<defs><radialGradient id="g" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="${mix(o.color, '#ffffff', 0.35)}"/><stop offset="1" stop-color="${o.color}"/></radialGradient></defs><circle cx="21" cy="21" r="15" fill="url(#g)"/>`
    : `<circle cx="21" cy="21" r="15" fill="#3A3940" stroke="rgba(255,255,255,.35)"/><path d="M11 31L31 11" stroke="rgba(255,255,255,.7)" stroke-width="1.6" stroke-linecap="round"/>`
  return swatchDoc(`${ring(o.isSelected)}${disc}<ellipse cx="17" cy="14" rx="7" ry="4" fill="#fff" opacity=".22"/>`, o.name)
}

/** One opacity step: coloured light behind a frost of that strength, its percentage on top; ringed when chosen. */
export function opacityTile(o: { opacity: number; color: string | null; isSelected: boolean }): string {
  const frost = o.color ? mix('#100F13', o.color, 0.34) : '#100F13'
  const body = `${ring(o.isSelected)}<clipPath id="c"><circle cx="21" cy="21" r="15"/></clipPath><g clip-path="url(#c)"><circle cx="14" cy="15" r="11" fill="${INK.coral}"/><circle cx="29" cy="28" r="11" fill="#5B6CFF"/><circle cx="21" cy="21" r="15" fill="${frost}" fill-opacity="${n2(o.opacity / 100)}"/></g><circle cx="21" cy="21" r="15" fill="none" stroke="rgba(255,255,255,.35)"/><text x="21" y="25" font-family="ui-rounded, -apple-system, sans-serif" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">${o.opacity}</text>`
  return swatchDoc(body, `${o.opacity}% opacity`)
}

// ── Agents: the crab stage ──────────────────────────────────────────────────

export type AgentArt = {
  id: string; type: string; model: string; effort?: string | number | null; state: CrabState; tool?: string; doing: string; elapsed: string
  /** What it was asked to do, and its spend so far ("12 steps · 48k tokens"). */
  task?: string; stats?: string
}

/** The tallest the left-hand grid stands (two 162-pixel rows), so the agents column lines up with it. */
export const GRID_H = SPAN2 * 2
const AGENT_ROW = 84
const MAX_AGENTS = 6

/** The spend line, dropping its later parts ("48k tokens · 12 steps" to "48k tokens") until it fits. */
const fitStats = (stats: string, max: number) => {
  const parts = stats.split(' · ')
  while (parts.length > 1 && parts.join(' · ').length > max) parts.pop()
  return clip(parts.join(' · '), max)
}

/** Characters of 10-pixel text that fit across `px`. */
const fits = (px: number, size = 10) => Math.max(8, Math.floor(px / (size * 0.56)))

/**
 * The agents column: one card per working agent, its crab beside who it is, what it was asked, what it is
 * doing now, and its model, effort and spend. Finished agents leave; the summary counts them.
 */
export function agentsTile(list: readonly AgentArt[], summary: string, w = FULL): string {
  const shown = list.slice(0, MAX_AGENTS)
  const h = Math.max(GRID_H, 44 + Math.max(1, shown.length) * AGENT_ROW + (list.length > shown.length ? 14 : 0))
  const working = list.some(a => a.state === 'running')
  const x0 = 68
  const room = w - x0 - 14
  const cards = shown
    .map((a, i) => {
      const top = 44 + i * AGENT_ROW
      const lvl = effortLevel(a.effort)
      const b = breedOf(a.model)
      const famW = b.family.length * 5.6 + 6
      const rule = i > 0 ? `<path d="M${x0} ${top - 4}H${w - 12}" stroke="var(--track)"/>` : ''
      return `<g>${rule}<title>${crabTitle(a.type, a.model, lvl, a.doing)}</title>
<g transform="translate(36 ${top + 44})">${crab({ model: a.model, state: a.state, tool: a.tool, p: 2.6, phase: i * 0.13 })}</g>
<text class="t" x="${x0}" y="${top + 14}" font-size="12" font-weight="650">${esc(clip(a.type, fits(room - 40, 12)))}</text>
<text class="t d" x="${w - 14}" y="${top + 14}" font-size="10" font-weight="600" text-anchor="end">${esc(a.elapsed)}</text>
<text class="t d" x="${x0}" y="${top + 30}" font-size="10" font-weight="500">${esc(clip(a.task || 'No description', fits(room)))}</text>
<text class="t" x="${x0}" y="${top + 46}" font-size="10" font-weight="600" style="fill:${INK.coral}">${esc(clip(a.doing, fits(room)))}</text>
<text class="t d" x="${x0}" y="${top + 62}" font-size="9.5" font-weight="600">${esc(b.family)}</text>${pips(lvl, b.body, x0 + famW, top + 61, 3.2)}
<text class="t d" x="${w - 14}" y="${top + 62}" font-size="9.5" font-weight="500" text-anchor="end">${esc(fitStats(a.stats ?? '', fits(room - famW - 26, 9.5)))}</text></g>`
    })
    .join('')
  const empty = shown.length === 0
    ? `<g transform="translate(${w / 2} ${h / 2 - 6})">${crab({ model: 'opus', state: 'idle', p: 3.4 })}</g><text class="t d" x="${w / 2}" y="${h / 2 + 26}" font-size="10.5" font-weight="600" text-anchor="middle">No agents working</text>`
    : ''
  const more = list.length > shown.length ? `<text class="t d" x="${w - 14}" y="${h - 10}" font-size="9.5" text-anchor="end">+${list.length - shown.length} more</text>` : ''
  const body = `${starburst(22, 21, 9, INK.coral, working)}
<text class="t" x="38" y="25.5" font-size="13" font-weight="650">Agents</text>
<text class="t d" x="${w - 14}" y="25.5" font-size="10.5" font-weight="600" text-anchor="end">${esc(summary)}</text>
<path d="M12 36H${w - 12}" stroke="var(--track)"/>${cards}${empty}${more}`
  return tile({
    w, h, body,
    title: `Agents: ${summary}`,
    glows: [{ color: INK.coral, x: 0.15, y: 0.9, r: 0.4, opacity: 0.45 }, { color: '#4E7BFF', x: 0.85, y: 0.2, r: 0.4, opacity: 0.35 }, { color: '#9B6BFF', x: 0.55, y: 1.1, r: 0.35, opacity: 0.3 }],
  })
}
