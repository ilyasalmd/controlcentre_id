// Liquid Glass, drawn in SVG. Each tile is its own document: a lit backdrop of the tile's own colours, refracted
// through a frosted pane with a bright rim and a top sheen. The desktop draws it in a script-less sandboxed frame,
// so all motion is SMIL or CSS, and colours follow the system light or dark scheme by media query.

import type { Look } from '../../types'

/** Design tokens shared by every tile. */
export const INK = {
  coral: '#D97757',
  coralHot: '#FF6A3D',
  amber: '#FFB547',
  red: '#FF5A4E',
  mint: '#7FD1A8',
  ice: '#8CCBFF',
  cream: '#F4EFE6',
} as const

export const FONT = `ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, system-ui, sans-serif`

export type Glow = { color: string; x: number; y: number; r: number; opacity?: number }

/** Escapes text for SVG. */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Rounds to two decimals so the markup stays short. */
export const n2 = (x: number) => Math.round(x * 100) / 100

/** Cuts a label to a length, with an ellipsis. */
export const clip = (s: string, max: number) => ([...s].length > max ? `${[...s].slice(0, max - 1).join('')}…` : s)

// ── The look: the glass's colour and opacity, as Apple lets you tint Control Center and pick clear or tinted ──

export const DEFAULT_LOOK: Look = { color: null, opacity: 58 }

/** Apple's system colours, by the names `/cockpit color` takes; a #rrggbb works too. */
export const GLASS_COLORS: Record<string, string> = {
  coral: '#D97757', red: '#FF453A', orange: '#FF9F0A', yellow: '#FFD60A', green: '#30D158', mint: '#63E6E2',
  teal: '#40C8E0', blue: '#0A84FF', indigo: '#5E5CE6', purple: '#BF5AF2', pink: '#FF375F', brown: '#AC8E68', graphite: '#8E8E93',
}

/** A colour name, a #rrggbb, or none/clear for neutral; undefined when it is neither. */
export function parseColor(word: string): string | null | undefined {
  const w = word.trim().toLowerCase()
  if (w === 'none' || w === 'neutral' || w === 'default') return null
  if (GLASS_COLORS[w]) return GLASS_COLORS[w]
  if (/^#[0-9a-f]{6}$/.test(w)) return w.toUpperCase()
  return undefined
}

/** A percentage 0 to 100 (a trailing % allowed), or clear (20) and tinted (80) as Apple names them. */
export function parseOpacity(word: string): number | undefined {
  const w = word.trim().toLowerCase()
  if (w === 'clear') return 20
  if (w === 'tinted') return 80
  if (w === 'default') return DEFAULT_LOOK.opacity
  const n = Number(w.replace(/%$/, ''))
  return Number.isFinite(n) && w !== '' ? Math.min(100, Math.max(0, Math.round(n))) : undefined
}

let look: Look = DEFAULT_LOOK

/** Sets the look every tile drawn after it wears, until the next call. */
export function setLook(next: Look) {
  look = next
}

const rgba = (hex: string, a: number) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},${n2(a)})`
}

/** The frost for each scheme: the colour mixed into the smoke (dark) or milk (light), at the look's opacity. */
function frost() {
  const a = Math.min(100, Math.max(0, look.opacity)) / 100
  const dark = look.color ? mix('#100F13', look.color, 0.34) : '#100F13'
  const light = look.color ? mix('#FFFFFF', look.color, 0.24) : '#FFFFFF'
  return { dark: rgba(dark, a), light: rgba(light, a * 0.83) }
}

const style = () => {
  const f = frost()
  return `
.t{font-family:${FONT};fill:var(--fg);letter-spacing:-.01em}
.d{fill:var(--dim)}
.f{fill:var(--faint)}
.tile{transition:transform .35s cubic-bezier(.2,.8,.2,1)}
.tile:hover{transform:scale(1.015)}
.tile:hover .sheen{opacity:1}
.sheen{opacity:.75;transition:opacity .35s}
svg{--fg:#FFFFFF;--dim:rgba(255,255,255,.64);--faint:rgba(255,255,255,.34);--tint:${f.dark};--track:rgba(255,255,255,.13);--rimA:rgba(255,255,255,.85);--rimB:rgba(255,255,255,.06);--edge:rgba(0,0,0,.5);--inner:rgba(255,255,255,.10)}
@media (prefers-color-scheme: light){svg{--fg:#17161A;--dim:rgba(23,22,26,.62);--faint:rgba(23,22,26,.36);--tint:${f.light};--track:rgba(23,22,26,.10);--rimA:rgba(255,255,255,.95);--rimB:rgba(255,255,255,.3);--edge:rgba(0,0,0,.14);--inner:rgba(255,255,255,.5)}}
`
}

/** One glass tile document. `body` is drawn inside the pane, above the frost and below the sheen. */
export function tile(o: {
  w: number
  h: number
  r?: number
  glows: Glow[]
  body: string
  title: string
  extraDefs?: string
  isCircle?: boolean
  drift?: boolean
}): string {
  const { w, h, glows, body, title } = o
  const pad = 6
  const W = w + pad * 2
  const H = h + pad * 2
  const r = o.isCircle ? Math.min(w, h) / 2 : (o.r ?? 26)
  const shape = `<rect x="${pad}" y="${pad}" width="${w}" height="${h}" rx="${r}" ry="${r}"/>`
  const drift = o.drift ?? true
  const lights = glows
    .map((g, i) => {
      const dx = n2(w * 0.08 * (i % 2 ? -1 : 1))
      const dy = n2(h * 0.06 * (i % 2 ? 1 : -1))
      const anim = drift
        ? `<animateTransform attributeName="transform" type="translate" values="0 0;${dx} ${dy};0 0" dur="${9 + i * 3}s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/>`
        : ''
      return `<circle cx="${n2(pad + g.x * w)}" cy="${n2(pad + g.y * h)}" r="${n2(g.r * Math.max(w, h))}" fill="${g.color}" opacity="${g.opacity ?? 0.9}">${anim}</circle>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><title>${esc(title)}</title><style>${style()}</style><defs>
<clipPath id="c">${shape}</clipPath>
<filter id="lens" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.011 0.017" numOctaves="2" seed="4" result="n"/><feGaussianBlur in="SourceGraphic" stdDeviation="${n2(Math.min(w, h) * 0.13)}" result="b"/><feDisplacementMap in="b" in2="n" scale="${n2(Math.min(w, h) * 0.32)}" xChannelSelector="R" yChannelSelector="G"/></filter>
<filter id="edgeLens" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="1" seed="9" result="n"/><feGaussianBlur in="SourceGraphic" stdDeviation="${n2(Math.min(w, h) * 0.05)}" result="b"/><feDisplacementMap in="b" in2="n" scale="${n2(Math.min(w, h) * 0.18)}" xChannelSelector="R" yChannelSelector="G" result="d"/><feColorMatrix in="d" type="saturate" values="1.7" result="s"/><feComponentTransfer in="s"><feFuncR type="linear" slope="1.35"/><feFuncG type="linear" slope="1.35"/><feFuncB type="linear" slope="1.35"/></feComponentTransfer></filter>
<filter id="soft"><feGaussianBlur stdDeviation="${n2(Math.max(2, Math.min(w, h) * 0.035))}"/></filter>
<mask id="band" maskUnits="userSpaceOnUse"><g filter="url(#soft)" fill="none" stroke="#fff" stroke-width="${n2(Math.max(5, Math.min(w, h) * 0.13))}">${shape}</g></mask>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".07"/></linearGradient>
<filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="3.5" flood-color="#000" flood-opacity=".28"/></filter>
<linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--rimA)"/><stop offset=".38" stop-color="var(--rimB)"/><stop offset=".62" stop-color="var(--rimB)"/><stop offset="1" stop-color="var(--rimA)" stop-opacity=".55"/></linearGradient>
<radialGradient id="sheenG" cx=".28" cy="-.05" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".30"/><stop offset=".55" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
${o.extraDefs ?? ''}</defs>
<g class="tile" style="transform-origin:${W / 2}px ${H / 2}px">
<g filter="url(#shadow)" fill="var(--tint)">${shape}</g>
<g clip-path="url(#c)"><g filter="url(#lens)">${lights}</g><g fill="var(--tint)">${shape}</g>
<g mask="url(#band)" opacity=".9"><g filter="url(#edgeLens)">${lights}</g></g><g fill="url(#floor)">${shape}</g>
<g transform="translate(${pad} ${pad})">${body}</g>
<g class="sheen" fill="url(#sheenG)">${shape}</g></g>
<g fill="none" stroke="url(#rim)" stroke-width="1.3">${shape}</g>
<g fill="none" stroke="var(--inner)" stroke-width="1" clip-path="url(#c)" transform="translate(0 1.4)">${shape}</g>
<g fill="none" stroke="var(--edge)" stroke-width=".6" transform="translate(0 .6)" opacity=".7">${shape}</g>
</g></svg>`
}

/** A hex colour mixed toward another, `t` from 0 to 1. */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  const k = Math.min(1, Math.max(0, t))
  return `#${x.map((v, i) => Math.round(v + ((y[i] ?? v) - v) * k).toString(16).padStart(2, '0')).join('')}`
}

/** The colour of a value along stops `[[at, hex], ...]`, sorted by `at`. */
export function ramp(stops: readonly (readonly [number, string])[], t: number): string {
  const first = stops[0]
  if (!first) return '#ffffff'
  if (t <= first[0]) return first[1]
  for (let i = 1; i < stops.length; i++) {
    const lo = stops[i - 1]
    const hi = stops[i]
    if (lo && hi && t <= hi[0]) return mix(lo[1], hi[1], (t - lo[0]) / (hi[0] - lo[0]))
  }
  return stops[stops.length - 1]?.[1] ?? first[1]
}

/**
 * Every looping animation set to where the clock says it is: a `begin` of minus its place in the loop. A frame the
 * desktop reloads (a new picture, or the pane's layout changing) then carries on mid-loop instead of jumping back.
 */
export function phased(source: string, nowS: number): string {
  return source.replace(/<animate(?:Transform)?\b[^>]*repeatCount="indefinite"[^>]*>/g, tag => {
    const dur = /\bdur="([\d.]+)s"/.exec(tag)
    const begin = /\bbegin="(-?[\d.]+)s"/.exec(tag)
    if (!dur || Number(dur[1]) <= 0 || (/\bbegin="/.test(tag) && !begin)) return tag
    const d = Number(dur[1])
    const at = (((nowS - Number(begin?.[1] ?? 0)) % d) + d) % d
    const b = `begin="${-Math.round(at * 1000) / 1000}s"`
    return begin ? tag.replace(begin[0], b) : tag.replace(/\bdur="/, `${b} dur="`)
  })
}
