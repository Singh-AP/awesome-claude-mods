// node --test scripts/test/

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  buildStats,
  categorize,
  escapeCell,
  escapeUrl,
  extractCalls,
  extractComponents,
  extractEvents,
  findCopies,
  formatStars,
  inspectModule,
  isNew,
  joinPath,
  kindOf,
  modDir,
  modulesOf,
  record,
  seedFirstSeen,
  serializeRecords,
  sortRecords,
  sourceHash,
  tidyDescription,
  uiIcons,
  uiOf,
} from '../lib/mods-index.mjs'

describe('categorize', () => {
  const cases = [
    ['safety', { name: 'blast-radius', description: 'Holds risky shell commands (rm -rf, git reset --hard, force push) with Proceed and Cancel buttons.', events: ['tool.call'] }],
    ['safety', { name: 'secrets-veil', description: 'Masks secret values in tool results before the model reads them.', events: ['session.append'] }],
    ['safety', { name: 'dep-sentinel', description: 'Checks each package the model installs against OSV.dev and stops a missing or look-alike one.' }],
    ['cost', { name: 'token-weather', description: 'A live forecast of the context window, drawn above the prompt.', components: ['AbovePrompt'], events: ['session.measure'] }],
    ['cost', { name: 'context-guard', description: 'Per-session context-window observability.' }],
    ['cost', { name: 'winnow', description: 'A calibrated context sieve: irrelevant blocks are replaced before they enter context.' }],
    ['awareness', { name: 'replay-theater', description: 'Step through the file edits Claude made in the last turn, one diff at a time.', components: ['Pane'] }],
    ['awareness', { name: 'leitstand', description: 'A control room above your prompt: background agents and shells at a glance. Two themes.' }],
    ['productivity', { name: 'next-steps', description: 'After each turn, suggests up to three next prompts above the input.' }],
    ['productivity', { name: 'translate-view', description: 'Translate outgoing prompts and stream reply translations into a side pane.', events: ['session.append'] }],
    ['notifications', { name: 'cuelume', description: 'Two sounds: ready when a long turn ends, attention when a permission prompt waits.', events: ['classic.PermissionRequest'] }],
    ['notifications', { name: 'ding', description: 'Plays a chime.', calls: ['$.audio.play'] }],
    ['fun', { name: 'intermission', description: "Play Doom deathmatch while Claude works, and get handed back when it's done" }],
    ['fun', { name: 'pixelband', description: 'Animated pixel art above your prompt that reacts while Claude works. Zero tokens.' }],
    ['fun', { name: 'reels', description: 'YouTube Shorts in a terminal pane: plays while Claude works, pauses when Claude is done.' }],
    ['ui', { name: 'fm', description: 'The sailboat working animation and conversation-only transcript.', components: ['Spinner', 'AssistantMessage', 'ToolUse'] }],
    ['ui', { name: 'coral-skin', description: 'Coral, ink and cream reskin of Claude Code with risk-coded tool rows.' }],
    ['integrations', { name: 'terminal-browser', description: 'A browser running directly inside claude code.' }],
    ['integrations', { name: 'pulse-cc', description: 'Quotes above the prompt from Yahoo Finance or your watchlists.' }],
    ['integrations', { name: 'space-channel', description: 'Mirrors the session to the SpaceNotes app and delivers phone messages as typed prompts', events: ['tool.check', 'session.append'] }],
    ['other', { name: 'x', description: 'Does a thing.' }],
  ]
  for (const [expected, mod] of cases) {
    test(`${mod.name} → ${expected}`, () => assert.equal(categorize(mod), expected))
  }

  test('weak evidence falls back to what the mod draws', () => {
    assert.equal(categorize({ name: 'q', description: 'Hmm.', components: ['Pane'] }), 'awareness')
    assert.equal(categorize({ name: 'q', description: 'Hmm.', components: ['Spinner'] }), 'ui')
  })

  test('is deterministic and ignores case', () => {
    const mod = { name: 'Snake', description: 'SNAKE IN A PANE' }
    assert.equal(categorize(mod), categorize({ ...mod }))
    assert.equal(categorize(mod), 'fun')
  })
})

describe('extractors', () => {
  const source = `
    import type { Register } from 'claude-code'
    export const register: Register = on => {
      on('session.start', async ($, e, next) => { await $.command.register({ name: 'x' }); return next(e) })
      on("tool.call", { tool: 'Bash' }, ($, e, next) => next(e))
      on(\`ui.render\`, { component: 'AbovePrompt' }, async ($, e) => { $.ui.status('hi'); $.ui.status(undefined) })
      on('ui.render', { component: 'Pane', requestId: 'x' }, async $ => $.ui.toast('a'))
      on('telemetry.*', ($, e, next) => next(e))
    }`

  test('events are unique, sorted literals', () => {
    assert.deepEqual(extractEvents(source), ['session.start', 'telemetry.*', 'tool.call', 'ui.render'])
  })
  test('components', () => assert.deepEqual(extractComponents(source), ['AbovePrompt', 'Pane']))
  test('calls drop the $.', () => assert.deepEqual(extractCalls(source), ['command.register', 'ui.status', 'ui.toast']))
  test('inspectModule notices the import and the export', () => {
    const r = inspectModule(source)
    assert.equal(r.importsClaudeCode, true)
    assert.equal(r.hasRegister, true)
    assert.equal(inspectModule('export function register(on) {}').importsClaudeCode, false)
    assert.equal(inspectModule('export function register(on) {}').hasRegister, true)
  })

  test('modulesOf keeps only JS/TS module paths', () => {
    assert.deepEqual(modulesOf('{"modules": ["./register.tsx"]}'), ['./register.tsx'])
    assert.deepEqual(modulesOf('{"modules": [{"path": "./a.mjs"}], "hooks": {}}'), ['./a.mjs'])
    assert.equal(modulesOf('{"hooks": {"Stop": []}}'), null)
    assert.equal(modulesOf('{"modules": ["./x.py"]}'), null)
    // A trailing comma is not JSON, but the list is still readable.
    assert.deepEqual(modulesOf('{"modules": ["./register.ts",],}'), ['./register.ts'])
  })

  test('paths', () => {
    assert.equal(joinPath('a/hooks', './register.ts'), 'a/hooks/register.ts')
    assert.equal(joinPath('hooks', '../src/x.ts'), 'src/x.ts')
    assert.equal(joinPath('', '../../x.ts'), 'x.ts')
    assert.equal(modDir('hooks/hooks.json'), '.')
    assert.equal(modDir('mods/x/hooks/hooks.json'), 'mods/x')
    assert.equal(modDir('plugin/hooks.json'), 'plugin')
  })
})

describe('copies, fixtures, templates', () => {
  const original = 'import x from "y"\n// the original\nexport function register(on) { on("tool.call", f) }'
  const reindented = 'import x from "y"\n\n   export function register(on) {\n  on("tool.call", f)   // a comment of my own\n}'

  test('the fingerprint ignores whitespace and comments', () => {
    assert.equal(sourceHash(original), sourceHash(reindented))
    assert.notEqual(sourceHash(original), sourceHash(original.replace('tool.call', 'prompt.submit')))
    assert.match(sourceHash(original), /^[0-9a-f]{12}$/)
  })

  test('a copy in a newer repo is set aside, the original kept', () => {
    const entries = [
      { repo: 'b/copy', path: 'mods/w', name: 'token-weather', hash: 'h1', createdAt: '2026-10-03', stars: 900 },
      { repo: 'a/orig', path: 'w', name: 'token-weather', hash: 'h1', createdAt: '2026-09-20', stars: 3 },
      { repo: 'c/other', path: 'x', name: 'something-else', hash: 'h1', createdAt: '2026-10-04', stars: 1 },
      { repo: 'd/solo', path: '.', name: 'solo', hash: 'h2', createdAt: '2026-10-01', stars: 1 },
    ]
    assert.deepEqual([...findCopies(entries)], ['b/copy:mods/w'])
  })

  test("Anthropic's own sample is always the original", () => {
    const entries = [
      { repo: 'old/repo', path: 'x', name: 'blast-radius', hash: 'h', createdAt: '2020-01-01', stars: 5 },
      { repo: 'anthropics/claude-code-playground', path: 'claude-code/mods/blast-radius', name: 'blast-radius', hash: 'h', createdAt: '2026-01-01', stars: 97 },
    ]
    assert.deepEqual([...findCopies(entries)], ['old/repo:x'])
  })

  test('an indexed mod stays the original against an older newcomer', () => {
    const entries = [
      { repo: 'author/cc-arcade', path: '.', name: 'cc-arcade', hash: 'h', createdAt: '2026-09-15', stars: 40 },
      { repo: 'big/catalog', path: 'mods/games/cc-arcade', name: 'cc-arcade', hash: 'h', createdAt: '2025-01-01', stars: 30000 },
    ]
    assert.deepEqual([...findCopies(entries)], ['author/cc-arcade:.'])
    assert.deepEqual([...findCopies(entries, new Set(['author/cc-arcade:.']))], ['big/catalog:mods/games/cc-arcade'])
  })

  test('a renamed copy with the same description is still a copy', () => {
    const entries = [
      { repo: 'anthropics/claude-code-playground', path: 'w', name: 'token-weather', hash: 'h', description: 'A live forecast of the context window.' },
      { repo: 'me/chef', path: '.', name: 'claude-chef', hash: 'h', description: 'A live forecast of the context window.' },
    ]
    assert.deepEqual([...findCopies(entries)], ['me/chef:.'])
  })

  test('two mods in one repo with the same boilerplate are not copies', () => {
    const entries = [
      { repo: 'a/b', path: 'one', name: 'one', hash: 'h', createdAt: '2026-10-01' },
      { repo: 'a/b', path: 'two', name: 'one', hash: 'h', createdAt: '2026-10-01' },
    ]
    assert.equal(findCopies(entries).size, 0)
  })

  test('kindOf', () => {
    assert.equal(kindOf('anthropics/claude-code', 'mods/diff'), 'builtin')
    assert.equal(kindOf('anthropics/claude-code-playground', 'claude-code/mods/x'), 'official')
    assert.equal(kindOf('me/repo', 'tests/fixtures/mod'), 'fixture')
    assert.equal(kindOf('me/repo', 'mods/probe-mod', 'probe mod'), 'fixture')
    assert.equal(kindOf('me/repo', 'templates/mod-template'), 'template')
    assert.equal(kindOf('me/claude-code-docs', 'x'), 'mirror')
    assert.equal(kindOf('me/repo', 'mods/cool'), 'mod')
  })
})

describe('records and stats', () => {
  test('tidyDescription collapses space and cuts at a word', () => {
    assert.equal(tidyDescription('  a\n\n b\tc '), 'a b c')
    const long = tidyDescription('word '.repeat(100), 50)
    assert.ok(long.length <= 50)
    assert.match(long, /word…$/)
  })

  test('seedFirstSeen never predates the index epoch', () => {
    assert.equal(seedFirstSeen('2024-05-01T00:00:00Z'), '2026-09-01')
    assert.equal(seedFirstSeen('2026-10-02T12:00:00Z'), '2026-10-02')
    assert.equal(seedFirstSeen(null), '2026-09-01')
  })

  test('record fills the category and keeps a stable field order', () => {
    const r = record({ name: 'snake', repo: 'a/b', path: '.', url: 'u', description: 'Snake in a pane', calls: ['$.ui.open'], firstSeen: '2026-10-04' })
    assert.equal(r.category, 'fun')
    assert.deepEqual(r.calls, ['ui.open'])
    assert.deepEqual(Object.keys(r).slice(0, 4), ['name', 'repo', 'path', 'url'])
  })

  test('sorting is by stars, then repo, then path', () => {
    const sorted = sortRecords([
      { repo: 'b', path: 'x', stars: 1 },
      { repo: 'a', path: 'y', stars: 1 },
      { repo: 'a', path: 'x', stars: 1 },
      { repo: 'z', path: 'x', stars: 5 },
    ])
    assert.deepEqual(sorted.map(r => `${r.repo}/${r.path}`), ['z/x', 'a/x', 'a/y', 'b/x'])
  })

  test('serialized records are valid JSON, one per line', () => {
    const text = serializeRecords([{ a: 1 }, { b: 'x|y' }])
    assert.deepEqual(JSON.parse(text), [{ a: 1 }, { b: 'x|y' }])
    assert.equal(text.split('\n').length, 5)
  })

  test('stats', () => {
    const today = '2026-10-04'
    const stats = buildStats(
      [
        { repo: 'a/b', category: 'fun', license: 'MIT', components: ['Pane'], calls: [], firstSeen: '2026-10-01' },
        { repo: 'a/b', category: 'cost', license: 'NOASSERTION', components: [], calls: ['ui.status'], firstSeen: '2026-09-01' },
        { repo: 'c/d', category: 'fun', license: null, components: [], calls: [], firstSeen: '2026-09-28' },
      ],
      today,
    )
    assert.equal(stats.mods, 3)
    assert.equal(stats.repos, 2)
    assert.equal(stats.withUi, 2)
    assert.equal(stats.licensed, 1)
    assert.equal(stats.byCategory.fun, 2)
    assert.equal(stats.newThisWeek, 2)
    assert.equal(isNew({ firstSeen: '2026-09-27' }, today), false)
  })

  test('ui surfaces', () => {
    assert.deepEqual(uiOf({ components: ['Pane', 'AbovePrompt', 'Spinner'], calls: ['ui.status'] }), ['pane', 'band', 'status', 'restyle'])
    assert.equal(uiIcons({ components: [], calls: [] }), '')
  })
})

describe('markdown', () => {
  test('escapeCell neutralises pipes, tags, links and newlines', () => {
    assert.equal(escapeCell('a | b'), 'a \\| b')
    assert.equal(escapeCell('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')
    assert.equal(escapeCell('see [x](http://evil)'), 'see \\[x\\](http://evil)')
    assert.equal(escapeCell('line1\nline2'), 'line1 line2')
    assert.equal(escapeCell('`code|x`'), '\\`code\\|x\\`')
    assert.equal(escapeCell('# heading'), '\\# heading')
    assert.equal(escapeCell('a\\|b'), 'a\\\\\\|b')
    assert.equal(escapeCell(null), '')
  })

  test('escapeUrl keeps a link from ending early', () => {
    assert.equal(escapeUrl('https://x/a b(c)'), 'https://x/a%20b%28c%29')
  })

  test('formatStars', () => {
    assert.equal(formatStars(999), '999')
    assert.equal(formatStars(1000), '1k')
    assert.equal(formatStars(1250), '1.3k')
    assert.equal(formatStars(149_354), '149k')
  })
})
