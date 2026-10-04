#!/usr/bin/env node
// Turns a terminal capture with ANSI colours (`tmux capture-pane -e -p`) into
// an SVG screenshot with window chrome, so the gallery shows real output.
//
//   node scripts/ansi-to-svg.mjs capture.ansi out.svg [--title claude] [--crop-top N] [--rows N]

import { readFileSync, writeFileSync } from 'node:fs'

const [input, output, ...flags] = process.argv.slice(2)
if (!input || !output) {
  console.error('usage: ansi-to-svg.mjs <capture.ansi> <out.svg> [--title t] [--crop-top n] [--rows n]')
  process.exit(2)
}
const flag = (name, fallback) => {
  const at = flags.indexOf(`--${name}`)
  return at >= 0 ? flags[at + 1] : fallback
}

const FONT = 14
const CELL = 8.43
const LINE = 19
const PAD = 18
const BAR = 34
const BG = '#14100e'
const FG = '#e6ddd5'

// xterm-ish palette tuned for a dark background
const BASE = ['#2b2b2b', '#ff6b6b', '#7ee787', '#e3b341', '#79c0ff', '#d2a8ff', '#76e3ea', '#c9d1d9',
  '#6e7681', '#ff8b8b', '#a5f0b0', '#f2cc60', '#a5d6ff', '#e2c5ff', '#b3f0ff', '#ffffff']

function xterm256(n) {
  if (n < 16) return BASE[n]
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return `rgb(${v},${v},${v})`
  }
  const i = n - 16
  const steps = [0, 95, 135, 175, 215, 255]
  return `rgb(${steps[Math.floor(i / 36)]},${steps[Math.floor(i / 6) % 6]},${steps[i % 6]})`
}

// Cells a code point takes: 2 for wide (CJK, most emoji), 0 for combining marks.
function widthOf(cp) {
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x300 && cp <= 0x36f)) return 0
  if ((cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf && [0x2614, 0x2615, 0x2648, 0x2705, 0x270a, 0x270b, 0x2728, 0x274c, 0x2753, 0x2757, 0x2795, 0x27b0].includes(cp)) ||
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x20000 && cp <= 0x3fffd) || [0x231a, 0x231b, 0x23f0, 0x23f3, 0x25fd, 0x25fe, 0x2b50, 0x2b55, 0x26a1, 0x26aa, 0x26ab, 0x26bd, 0x26be, 0x26c4, 0x26c5, 0x26d4, 0x26ea, 0x26f2, 0x26f3, 0x26f5, 0x26fa, 0x26fd].includes(cp)) return 2
  return 1
}

const escapeXml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const raw = readFileSync(input, 'utf8').replace(/\r/g, '')
let lines = raw.split('\n')
while (lines.length > 0 && lines.at(-1).replace(/\x1b\[[0-9;]*m/g, '').trim() === '') lines.pop()
const cropTop = Number(flag('crop-top', 0))
lines = lines.slice(cropTop)
const maxRows = Number(flag('rows', lines.length))
lines = lines.slice(0, maxRows)

const runs = [] // { row, col, text, style }
const rects = [] // { row, col, cells, color }
let columns = 0

for (let row = 0; row < lines.length; row++) {
  let style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false }
  let col = 0
  let run = null
  const flush = () => {
    if (run && run.text !== '') runs.push(run)
    run = null
  }
  const parts = lines[row].split(/(\x1b\[[0-9;:]*m)/)
  for (const part of parts) {
    const sgr = part.match(/^\x1b\[([0-9;:]*)m$/)
    if (sgr) {
      flush()
      const codes = sgr[1] === '' ? [0] : sgr[1].split(/[;:]/).map(Number)
      style = { ...style }
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i]
        if (c === 0) style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false }
        else if (c === 1) style.bold = true
        else if (c === 2) style.dim = true
        else if (c === 3) style.italic = true
        else if (c === 4) style.underline = true
        else if (c === 7) style.inverse = true
        else if (c === 22) { style.bold = false; style.dim = false }
        else if (c === 23) style.italic = false
        else if (c === 24) style.underline = false
        else if (c === 27) style.inverse = false
        else if (c >= 30 && c <= 37) style.fg = BASE[c - 30]
        else if (c >= 90 && c <= 97) style.fg = BASE[c - 90 + 8]
        else if (c === 39) style.fg = null
        else if (c >= 40 && c <= 47) style.bg = BASE[c - 40]
        else if (c >= 100 && c <= 107) style.bg = BASE[c - 100 + 8]
        else if (c === 49) style.bg = null
        else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
          style[c === 38 ? 'fg' : 'bg'] = xterm256(codes[i + 2])
          i += 2
        } else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
          style[c === 38 ? 'fg' : 'bg'] = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`
          i += 4
        }
      }
      continue
    }
    for (const ch of part.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')) {
      const w = widthOf(ch.codePointAt(0))
      const fg = style.inverse ? (style.bg ?? BG) : (style.fg ?? FG)
      const bg = style.inverse ? (style.fg ?? FG) : style.bg
      if (bg && w > 0) rects.push({ row, col, cells: w, color: bg })
      if (ch === ' ' && !run) {
        col += 1
        continue
      }
      const key = JSON.stringify([fg, style.bold, style.dim, style.italic, style.underline])
      if (!run || run.key !== key || w === 2 || run.hasWide) {
        flush()
        run = { row, col, text: '', key, fg, style: { ...style }, hasWide: w === 2 }
      }
      run.text += ch
      col += w
    }
    columns = Math.max(columns, col)
  }
  flush()
}

columns = Number(flag('columns', Math.max(columns, 60)))
const width = Math.ceil(PAD * 2 + columns * CELL)
const height = Math.ceil(BAR + PAD + lines.length * LINE + PAD / 2)
const title = escapeXml(flag('title', 'claude'))

const body = []
for (const r of rects) {
  body.push(`<rect x="${(PAD + r.col * CELL).toFixed(1)}" y="${(BAR + PAD / 2 + r.row * LINE).toFixed(1)}" width="${(r.cells * CELL + 0.5).toFixed(1)}" height="${LINE}" fill="${r.color}"/>`)
}
for (const r of runs) {
  const attrs = [
    `x="${(PAD + r.col * CELL).toFixed(1)}"`,
    `y="${(BAR + PAD / 2 + r.row * LINE + LINE * 0.74).toFixed(1)}"`,
    `fill="${r.fg}"`,
  ]
  if (r.style.bold) attrs.push('font-weight="700"')
  if (r.style.dim) attrs.push('fill-opacity="0.6"')
  if (r.style.italic) attrs.push('font-style="italic"')
  if (r.style.underline) attrs.push('text-decoration="underline"')
  const cells = [...r.text].reduce((n, ch) => n + widthOf(ch.codePointAt(0)), 0)
  if (!r.hasWide) attrs.push(`textLength="${(cells * CELL).toFixed(1)}" lengthAdjust="spacingAndGlyphs"`)
  body.push(`<text ${attrs.join(' ')}>${escapeXml(r.text)}</text>`)
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title} terminal screenshot">
<rect width="${width}" height="${height}" rx="10" fill="${BG}"/>
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="none" stroke="#3a2f29"/>
<circle cx="20" cy="17" r="6" fill="#ff5f57"/><circle cx="40" cy="17" r="6" fill="#febc2e"/><circle cx="60" cy="17" r="6" fill="#28c840"/>
<text x="${width / 2}" y="22" fill="#6f625a" font-size="13" text-anchor="middle" font-family="ui-sans-serif, -apple-system, Helvetica, Arial, sans-serif">${title}</text>
<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace" font-size="${FONT}" xml:space="preserve">
${body.join('\n')}
</g>
</svg>
`
writeFileSync(output, svg)
console.log(`wrote ${output} (${columns}x${lines.length} cells, ${runs.length} runs)`)
