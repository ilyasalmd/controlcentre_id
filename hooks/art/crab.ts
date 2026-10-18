// The agent crabs: a pixel crab per subagent. Its colour and hat say the model, glowing pips say the effort,
// a bubble says the tool it is using, and the way it moves says whether it is working, done or stuck.

import { esc, n2 } from './glass'

export type CrabState = 'running' | 'done' | 'failed' | 'idle'

export type Breed = { family: string; body: string; shade: string; hat: string }

/** Each model family is its own crab: Opus in Claude coral with a mortarboard, Sonnet in blue with a quill, etc. */
export const BREEDS: Record<string, Breed> = {
  opus: { family: 'Opus', body: '#D97757', shade: '#B85C3E', hat: 'cap' },
  sonnet: { family: 'Sonnet', body: '#6FA3E0', shade: '#4E80BD', hat: 'quill' },
  haiku: { family: 'Haiku', body: '#7CC49A', shade: '#57A076', hat: 'leaf' },
  fable: { family: 'Fable', body: '#B08CF0', shade: '#8B68CF', hat: 'wizard' },
  mythos: { family: 'Mythos', body: '#E3B75C', shade: '#BF9238', hat: 'halo' },
  other: { family: 'Agent', body: '#E8DFD0', shade: '#C4B8A6', hat: 'none' },
}

export function breedOf(model: string): Breed {
  const m = /(opus|sonnet|haiku|fable|mythos)/i.exec(model)
  return BREEDS[m?.[1]?.toLowerCase() ?? 'other'] ?? BREEDS.other!
}

/** Effort as a level from 1 to 5, or 0 when unknown. */
export function effortLevel(effort: string | number | undefined | null): number {
  if (effort === undefined || effort === null || effort === '') return 0
  if (typeof effort === 'number') return effort >= 32_000 ? 5 : effort >= 16_000 ? 4 : effort >= 8_000 ? 3 : effort >= 2_000 ? 2 : 1
  return ({ low: 1, medium: 2, high: 3, xhigh: 4, max: 5 } as Record<string, number>)[effort.toLowerCase()] ?? 0
}

export const EFFORT_WORD = ['', 'low', 'medium', 'high', 'extra high', 'max'] as const

// The sprite on a 14 × 9 grid of `p`-pixel squares: body, claws, eyes, two leg frames.
const BODY: [number, number, number, number][] = [[2, 0, 10, 6], [0, 2, 2, 2], [12, 2, 2, 2]]
const LEGS_A: [number, number][] = [[3, 6], [5, 6], [8, 6], [10, 6], [3, 7], [10, 7]]
const LEGS_B: [number, number][] = [[3, 6], [5, 6], [8, 6], [10, 6], [5, 7], [8, 7]]

const rects = (cells: [number, number][] | [number, number, number, number][], p: number) =>
  cells.map(c => `<rect x="${c[0] * p}" y="${c[1] * p}" width="${(c[2] ?? 1) * p}" height="${(c[3] ?? 1) * p}"/>`).join('')

function hat(kind: string, p: number, b: Breed): string {
  const W = 14 * p
  switch (kind) {
    case 'cap':
      return `<g><path d="M${W / 2 - 4.5 * p} ${-1.2 * p}L${W / 2} ${-2.6 * p}L${W / 2 + 4.5 * p} ${-1.2 * p}L${W / 2} ${0.2 * p}Z" fill="#26211F"/><rect x="${W / 2 - 2.2 * p}" y="${-1.1 * p}" width="${4.4 * p}" height="${1.2 * p}" fill="#26211F"/><path d="M${W / 2 + 3.6 * p} ${-1.4 * p}v${2.6 * p}" stroke="${b.body}" stroke-width="${p * 0.55}" stroke-linecap="round"/></g>`
    case 'quill':
      return `<path d="M${W / 2 + 2 * p} ${0.2 * p}C${W / 2 + 2.4 * p} ${-2.4 * p} ${W / 2 + 4.6 * p} ${-4 * p} ${W / 2 + 6 * p} ${-4.4 * p}C${W / 2 + 5.4 * p} ${-2.6 * p} ${W / 2 + 4 * p} ${-0.8 * p} ${W / 2 + 2 * p} ${0.2 * p}Z" fill="#F4EFE6" stroke="#9CB8DA" stroke-width="${p * 0.25}"/>`
    case 'leaf':
      return `<g><path d="M${W / 2} ${0.2 * p}v${-1.6 * p}" stroke="#4E8F64" stroke-width="${p * 0.45}"/><path d="M${W / 2} ${-1.4 * p}C${W / 2 - 2.6 * p} ${-1.6 * p} ${W / 2 - 3 * p} ${-3.6 * p} ${W / 2 - 2.4 * p} ${-3.8 * p}C${W / 2 - 0.6 * p} ${-3.6 * p} ${W / 2} ${-2.6 * p} ${W / 2} ${-1.4 * p}Z" fill="#9BE0A8"/></g>`
    case 'wizard':
      return `<g><path d="M${W / 2 - 3.6 * p} ${0.3 * p}L${W / 2 + 0.6 * p} ${-5 * p}L${W / 2 + 3.6 * p} ${0.3 * p}Z" fill="#4B3A8C"/><circle cx="${W / 2 + 0.4 * p}" cy="${-2.2 * p}" r="${p * 0.5}" fill="#FFE27A"/></g>`
    case 'halo':
      return `<ellipse cx="${W / 2}" cy="${-1.6 * p}" rx="${3.4 * p}" ry="${0.9 * p}" fill="none" stroke="#FFE27A" stroke-width="${p * 0.55}"/>`
    default:
      return ''
  }
}

/** A small vector icon for the tool the agent is using. */
export function toolIcon(tool: string, s: number, color: string): string {
  const k = tool.toLowerCase()
  const sw = `stroke="${color}" stroke-width="${n2(s * 0.12)}" fill="none" stroke-linecap="round" stroke-linejoin="round"`
  if (/grep|glob|search|find/.test(k)) return `<g ${sw}><circle cx="${s * 0.42}" cy="${s * 0.42}" r="${s * 0.26}"/><path d="M${s * 0.62} ${s * 0.62}L${s * 0.86} ${s * 0.86}"/></g>`
  if (/read|notebook/.test(k)) return `<g ${sw}><path d="M${s * 0.22} ${s * 0.12}h${s * 0.4}l${s * 0.18} ${s * 0.18}v${s * 0.58}h${-s * 0.58}Z"/><path d="M${s * 0.34} ${s * 0.48}h${s * 0.32}M${s * 0.34} ${s * 0.66}h${s * 0.24}"/></g>`
  if (/edit|write|update/.test(k)) return `<g ${sw}><path d="M${s * 0.2} ${s * 0.8}l${s * 0.06} ${-s * 0.2}l${s * 0.46} ${-s * 0.46}l${s * 0.14} ${s * 0.14}l${-s * 0.46} ${s * 0.46}Z"/></g>`
  if (/bash|shell|terminal|exec/.test(k)) return `<g ${sw}><path d="M${s * 0.18} ${s * 0.3}l${s * 0.22} ${s * 0.2}l${-s * 0.22} ${s * 0.2}M${s * 0.5} ${s * 0.74}h${s * 0.3}"/></g>`
  if (/web|fetch|browser|http/.test(k)) return `<g ${sw}><circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.34}"/><path d="M${s * 0.16} ${s / 2}h${s * 0.68}M${s / 2} ${s * 0.16}c${-s * 0.18} ${s * 0.2} ${-s * 0.18} ${s * 0.48} 0 ${s * 0.68}c${s * 0.18} ${-s * 0.2} ${s * 0.18} ${-s * 0.48} 0 ${-s * 0.68}"/></g>`
  if (/agent|task/.test(k)) return `<g ${sw}><circle cx="${s * 0.36}" cy="${s * 0.4}" r="${s * 0.14}"/><circle cx="${s * 0.66}" cy="${s * 0.4}" r="${s * 0.14}"/><path d="M${s * 0.2} ${s * 0.8}c${s * 0.06} ${-s * 0.18} ${s * 0.26} ${-s * 0.18} ${s * 0.32} 0M${s * 0.5} ${s * 0.8}c${s * 0.06} ${-s * 0.18} ${s * 0.26} ${-s * 0.18} ${s * 0.32} 0"/></g>`
  // Thinking: three dots that breathe.
  return [0.28, 0.5, 0.72]
    .map((x, i) => `<circle cx="${s * x}" cy="${s / 2}" r="${s * 0.08}" fill="${color}"><animate attributeName="opacity" values=".25;1;.25" dur="1.2s" begin="${i * 0.2}s" repeatCount="indefinite"/></circle>`)
    .join('')
}

/**
 * One crab, drawn with its feet at (0, 0) of its own group: about 14p wide and 9p tall, the hat and bubble above.
 * `phase` staggers the animation so a row of crabs does not move in lockstep.
 */
export function crab(o: { model: string; state: CrabState; tool?: string; p?: number; phase?: number }): string {
  const p = o.p ?? 3
  const b = breedOf(o.model)
  const W = 14 * p
  const H = 9 * p
  const ph = n2(o.phase ?? 0)
  const isRun = o.state === 'running'
  const legs = isRun
    ? `<g fill="${b.shade}">${rects(LEGS_A, p)}<animate attributeName="opacity" values="1;0" dur=".36s" begin="${ph}s" calcMode="discrete" repeatCount="indefinite"/></g><g fill="${b.shade}" opacity="0">${rects(LEGS_B, p)}<animate attributeName="opacity" values="0;1" dur=".36s" begin="${ph}s" calcMode="discrete" repeatCount="indefinite"/></g>`
    : o.state === 'idle'
      ? ''
      : `<g fill="${b.shade}">${rects(LEGS_A.slice(0, 4), p)}</g>`
  const eyeColor = '#1E1A19'
  const eyes =
    o.state === 'done'
      ? `<path d="M${3.6 * p} ${2.4 * p}l${0.7 * p} ${-0.8 * p}l${0.7 * p} ${0.8 * p}M${8.6 * p} ${2.4 * p}l${0.7 * p} ${-0.8 * p}l${0.7 * p} ${0.8 * p}" stroke="${eyeColor}" stroke-width="${p * 0.5}" fill="none" stroke-linecap="round"/>`
      : o.state === 'failed'
        ? `<path d="M${3.7 * p} ${1.2 * p}l${1.2 * p} ${1.2 * p}M${4.9 * p} ${1.2 * p}l${-1.2 * p} ${1.2 * p}M${8.7 * p} ${1.2 * p}l${1.2 * p} ${1.2 * p}M${9.9 * p} ${1.2 * p}l${-1.2 * p} ${1.2 * p}" stroke="${eyeColor}" stroke-width="${p * 0.45}" stroke-linecap="round"/>`
        : o.state === 'idle'
          ? `<path d="M${3.6 * p} ${2 * p}h${1.4 * p}M${8.6 * p} ${2 * p}h${1.4 * p}" stroke="${eyeColor}" stroke-width="${p * 0.45}" stroke-linecap="round"/>`
          : `<g fill="${eyeColor}">${[4, 9]
              .map(
                x =>
                  `<rect x="${x * p}" y="${p}" width="${p}" height="${n2(1.6 * p)}"><animate attributeName="height" values="${n2(1.6 * p)};${n2(0.25 * p)};${n2(1.6 * p)};${n2(1.6 * p)}" dur="3.6s" keyTimes="0;.03;.06;1" begin="${n2(1 + (o.phase ?? 0) * 7)}s" repeatCount="indefinite"/></rect>`,
              )
              .join('')}</g>`
  const claws = isRun
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${-p * 0.8};0 0" dur=".72s" begin="${ph}s" repeatCount="indefinite"/>`
    : ''
  const body = `<g fill="${b.body}"><rect x="${2 * p}" y="0" width="${10 * p}" height="${6 * p}" rx="${p * 0.35}"/></g><g fill="${b.body}">${rects([BODY[1]!, BODY[2]!], p)}${claws}</g><rect x="${2 * p}" y="0" width="${10 * p}" height="${p * 0.9}" fill="#fff" opacity=".18"/>`
  const bob = isRun
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${-p * 0.6};0 0" dur=".36s" begin="${ph}s" repeatCount="indefinite" additive="sum"/>`
    : ''
  const sit = o.state === 'idle' ? `translate(0 ${p * 2})` : o.state === 'done' ? `translate(0 ${p})` : ''
  const shadow = `<ellipse cx="${W / 2}" cy="${H + p * 0.4}" rx="${W * 0.42}" ry="${p * 0.7}" fill="#000" opacity=".28"/>`
  const sprite = `<g transform="${sit}"><g>${legs}${body}${eyes}${hat(b.hat, p, b)}${bob}</g></g>`
  const zzz =
    o.state === 'idle'
      ? `<text class="t d" x="${W - p}" y="${-p}" font-size="${p * 3}" font-weight="600">z<animate attributeName="opacity" values="0;1;0" dur="2.4s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;${p * 1.5} ${-p * 3}" dur="2.4s" repeatCount="indefinite"/></text>`
      : ''
  return `<g transform="translate(${-W / 2} ${-H})">${shadow}${sprite}${zzz}${badge(o.state, o.tool, W, p)}</g>`
}

/** The bubble over a crab: the tool while working, a tick when done, an exclamation when it failed. */
function badge(state: CrabState, tool: string | undefined, W: number, p: number): string {
  const r = p * 2.6
  const cx = W + p * 0.6
  const cy = -p * 2.4
  if (state === 'running') {
    const s = r * 1.3
    return `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255,255,255,.92)"/><circle cx="${cx - r * 0.9}" cy="${cy + r * 0.95}" r="${p * 0.55}" fill="rgba(255,255,255,.8)"/><g transform="translate(${cx - s / 2} ${cy - s / 2})">${toolIcon(tool ?? '', s, '#2A2522')}</g><animateTransform attributeName="transform" type="translate" values="0 0;0 ${-p * 0.7};0 0" dur="2.2s" repeatCount="indefinite"/></g>`
  }
  if (state === 'done') {
    return `<g><circle cx="${cx}" cy="${cy}" r="${r * 0.8}" fill="#34C77B"/><path d="M${cx - r * 0.38} ${cy}l${r * 0.26} ${r * 0.28}l${r * 0.5} ${-r * 0.52}" stroke="#fff" stroke-width="${p * 0.6}" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`
  }
  if (state === 'failed') {
    return `<g><circle cx="${cx}" cy="${cy}" r="${r * 0.8}" fill="#FF5A4E"/><path d="M${cx} ${cy - r * 0.42}v${r * 0.46}" stroke="#fff" stroke-width="${p * 0.65}" stroke-linecap="round"/><circle cx="${cx}" cy="${cy + r * 0.4}" r="${p * 0.38}" fill="#fff"/></g>`
  }
  return ''
}

/** Effort pips: `level` lit of five, the lit ones glowing in the crab's colour. */
export function pips(level: number, color: string, x: number, y: number, size = 4): string {
  return [0, 1, 2, 3, 4]
    .map(i => {
      const lit = i < level
      return `<rect x="${n2(x + i * size * 1.6)}" y="${n2(y - (i + 1) * size * 0.35)}" width="${size}" height="${n2(size * 0.35 * (i + 1) + size * 0.6)}" rx="${n2(size * 0.4)}" fill="${lit ? color : 'var(--track)'}"${lit && level === 5 ? ` opacity=".95"><animate attributeName="opacity" values=".55;1;.55" dur="1.6s" begin="${i * 0.12}s" repeatCount="indefinite"/></rect>` : '/>'}`
    })
    .join('')
}

/** The Claude starburst: rounded rays of uneven length, turning while anything works. */
export function starburst(cx: number, cy: number, r: number, color: string, isSpinning: boolean): string {
  const rays = [1, 0.78, 0.94, 0.7, 0.98, 0.82, 0.9, 0.74, 1, 0.8, 0.92, 0.72]
  const lines = rays
    .map((k, i) => {
      const a = (i / rays.length) * Math.PI * 2 + 0.13
      const r0 = r * 0.18
      const r1 = r * k
      return `<path d="M${n2(cx + Math.cos(a) * r0)} ${n2(cy + Math.sin(a) * r0)}L${n2(cx + Math.cos(a) * r1)} ${n2(cy + Math.sin(a) * r1)}"/>`
    })
    .join('')
  const spin = isSpinning ? `<animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="6s" repeatCount="indefinite"/>` : ''
  return `<g stroke="${color}" stroke-width="${n2(r * 0.22)}" stroke-linecap="round">${lines}${spin}</g>`
}

export const crabTitle = (type: string, model: string, effort: number, doing: string) =>
  esc(`${type} · ${breedOf(model).family}${effort ? ` · ${EFFORT_WORD[effort]} effort` : ''}${doing ? ` · ${doing}` : ''}`)
