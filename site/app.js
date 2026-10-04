// The page: loads data.json, draws our mods and the browser, keeps the
// search in the URL hash. Every third-party string goes in as text, never HTML.

import { KINDS, PAGE_SIZE, UI_LABELS, compactNumber, formatHash, installCommand, parseHash, prepare, query, safeUrl, segments, uiLabels } from './logic.js'

const $ = selector => document.querySelector(selector)

/** Builds an element; strings and numbers become text nodes. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') node.className = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

/** Text with `code` spans, built from text nodes so nothing is parsed as HTML. */
function rich(text) {
  return segments(text).map(part => (part.isCode ? el('code', {}, part.text) : document.createTextNode(part.text)))
}

async function copy(text, button) {
  let isCopied = false
  try {
    await navigator.clipboard.writeText(text)
    isCopied = true
  } catch {
    const area = el('textarea', { class: 'sr-only', 'aria-hidden': 'true' })
    area.value = text
    document.body.append(area)
    area.select()
    isCopied = document.execCommand('copy')
    area.remove()
  }
  const label = button.textContent
  button.textContent = isCopied ? 'Copied ✓' : 'Press ⌘C'
  button.classList.toggle('done', isCopied)
  setTimeout(() => {
    button.textContent = label
    button.classList.remove('done')
  }, 1500)
}

function copyButton(text, label) {
  return el('button', { type: 'button', class: 'copy', 'aria-label': label, onclick: event => copy(text, event.currentTarget) }, 'Copy')
}

function link(href, text, attrs = {}) {
  const url = safeUrl(href)
  return url ? el('a', { href: url, rel: 'noopener', ...attrs }, text) : el('span', attrs, text)
}

const UI_ICONS = { P: '▣', B: '▭', S: '▁', R: '✦' }

function uiPills(bits) {
  const labels = uiLabels(bits)
  if (labels.length === 0) return null
  const pills = [...bits].filter(bit => UI_ICONS[bit]).map(bit => el('span', { class: 'ui-pill', role: 'img', 'aria-label': UI_LABELS[bit] }, UI_ICONS[bit]))
  return el('span', { class: 'ui', title: labels.join(', ') }, ...pills)
}

function card(item, categories) {
  const category = categories.get(item.c)
  const glyph = item.e ?? category?.emoji ?? '◇'
  const install = installCommand(item)
  const meta = [
    item.s ? el('span', { class: 'stars', title: `${item.s} stars` }, `★ ${compactNumber(item.s)}`) : null,
    item.a ? link(item.a === 'awesome-claude-mods' ? 'https://github.com/Singh-AP/awesome-claude-mods' : `https://github.com/${item.a}`, item.a, { class: 'author' }) : null,
    item.l ? el('span', { class: 'license' }, item.l) : null,
    uiPills(item.ui),
  ].filter(Boolean)
  return el(
    'article',
    { class: `card kind-${item.k}` },
    el(
      'header',
      {},
      el('span', { class: item.e ? 'glyph' : 'glyph faint', 'aria-hidden': 'true' }, glyph),
      el('h3', {}, link(item.u, item.n)),
      el('span', { class: `badge badge-${item.k}` }, KINDS[item.k]),
    ),
    el('p', { class: 'desc' }, ...rich(item.d ?? '')),
    el('div', { class: 'meta' }, ...meta, category ? el('span', { class: 'cat' }, `${category.emoji} ${category.title}`) : null),
    install ? el('div', { class: 'install small' }, el('code', {}, install), copyButton(install, `Copy the install command for ${item.n}`)) : null,
  )
}

function builtCard(item) {
  const install = installCommand(item)
  return el(
    'article',
    { class: item.x ? 'built-card shot' : 'built-card' },
    item.x ? link(item.u, el('img', { src: item.x, alt: `${item.n} in a real Claude Code session`, loading: 'lazy' }), { class: 'thumb', tabindex: '-1', 'aria-hidden': 'true' }) : null,
    el('h3', {}, el('span', { class: 'emoji', 'aria-hidden': 'true' }, item.e ?? '◇'), link(item.u, item.n)),
    el('p', { class: 'desc' }, ...rich(item.d ?? '')),
    el('div', { class: 'install small' }, el('code', {}, install), copyButton(install, `Copy the install command for ${item.n}`)),
  )
}

async function start() {
  const response = await fetch('data.json')
  const data = await response.json()
  const categoryList = data.categories ?? []
  const categories = new Map(categoryList.map(c => [c.id, c]))
  const items = prepare(data.items ?? [], categoryList, data.vocab ?? [])

  const { stats } = data
  $('#stats').textContent = [
    `${stats.built} built & tested`,
    `${stats.curated} curated`,
    `${Number(stats.indexed).toLocaleString('en-US')} indexed`,
    data.updated ? `updated ${data.updated}` : '',
  ].filter(Boolean).join(' · ')

  const built = items.filter(i => i.k === 'b').sort((a, b) => (a.o ?? 0) - (b.o ?? 0))
  $('#built-shots').replaceChildren(...built.filter(i => i.x).map(builtCard))
  $('#built').replaceChildren(...built.filter(i => !i.x).map(builtCard))

  for (const button of document.querySelectorAll('.copy[data-copy]')) {
    button.addEventListener('click', () => copy(button.dataset.copy, button))
  }

  let state = parseHash(location.hash)
  let shown = PAGE_SIZE
  let last = { items: [], counts: {}, total: 0 }

  const input = $('#q')
  const sort = $('#sort')
  const toggles = [...document.querySelectorAll('.toggle')]

  function drawChips() {
    const chips = [
      el('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.cat === ''), onclick: () => setState({ cat: '' }) }, 'All ', el('span', { class: 'n' }, compactNumber(last.total))),
      ...categoryList
        .filter(c => (last.counts[c.id] ?? 0) > 0 || state.cat === c.id)
        .map(c =>
          el(
            'button',
            { type: 'button', class: 'chip', 'aria-pressed': String(state.cat === c.id), title: c.blurb, onclick: () => setState({ cat: state.cat === c.id ? '' : c.id }) },
            `${c.emoji} ${c.title} `,
            el('span', { class: 'n' }, compactNumber(last.counts[c.id] ?? 0)),
          ),
        ),
    ]
    $('#chips').replaceChildren(...chips)
  }

  function drawResults() {
    const page = last.items.slice(0, shown)
    $('#results').replaceChildren(...page.map(item => card(item, categories)))
    const count = last.items.length
    const where = state.cat ? ` in ${categories.get(state.cat)?.title ?? state.cat}` : ''
    $('#count').textContent = count === 0 ? 'No mods match. Try fewer words, or clear the filters.' : `${count.toLocaleString('en-US')} mod${count === 1 ? '' : 's'}${where}`
    const more = $('#more')
    more.hidden = count <= shown
    more.textContent = `Show more (${(count - shown).toLocaleString('en-US')} left)`
  }

  function run() {
    last = query(items, state)
    drawChips()
    drawResults()
  }

  function syncControls() {
    input.value = state.q
    sort.value = state.sort
    for (const toggle of toggles) toggle.setAttribute('aria-pressed', String(state.flags.includes(toggle.dataset.flag)))
  }

  function setState(change) {
    state = { ...state, ...change }
    shown = PAGE_SIZE
    const hash = formatHash(state)
    history.replaceState(null, '', hash === '' ? location.pathname + location.search : hash)
    syncControls()
    run()
  }

  input.addEventListener('input', () => setState({ q: input.value }))
  sort.addEventListener('change', () => setState({ sort: sort.value }))
  for (const toggle of toggles) {
    toggle.addEventListener('click', () => {
      const flag = toggle.dataset.flag
      const flags = state.flags.includes(flag) ? state.flags.filter(f => f !== flag) : [...state.flags, flag]
      setState({ flags })
    })
  }
  $('#more').addEventListener('click', () => {
    shown += PAGE_SIZE
    drawResults()
  })
  addEventListener('hashchange', () => {
    state = parseHash(location.hash)
    shown = PAGE_SIZE
    syncControls()
    run()
  })
  addEventListener('keydown', event => {
    const isTyping = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement
    if (event.key === '/' && !isTyping) {
      event.preventDefault()
      input.focus()
    } else if (event.key === 'Escape' && event.target === input && input.value !== '') {
      setState({ q: '' })
    }
  })

  syncControls()
  run()
  // A shared search link lands on its results, not the top of the page.
  if (formatHash(state) !== '') $('#browse').scrollIntoView({ behavior: 'instant' })
}

start().catch(error => {
  $('#stats').textContent = 'Could not load the mod list.'
  $('#count').textContent = String(error)
})
