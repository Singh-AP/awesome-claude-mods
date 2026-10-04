# Writing Claude Code mods: the practical guide

The [official docs](https://code.claude.com/docs/en/plugins/mods/overview) are the reference. This page is the field guide: the ten patterns every mod in this repo is built from, the rules the validator enforces, and the testing recipes that keep them working. Everything here was verified against Claude Code 2.1.288.

- [Anatomy of a mod](#anatomy-of-a-mod)
- [Ten patterns](#ten-patterns)
- [Rules the validator enforces](#rules-the-validator-enforces)
- [Testing recipes](#testing-recipes)
- [Running and debugging](#running-and-debugging)
- [Shipping it](#shipping-it)

## Anatomy of a mod

```text
my-mod/
├── .claude-plugin/plugin.json   name, version, description, userConfig
├── hooks/hooks.json             { "modules": ["./register.ts"] }
├── hooks/register.ts            export const register: Register = (on, options) => { ... }
├── hooks/logic.ts               pure helpers, no `$`
├── types/index.d.ts             only if you keep values in $.state
└── tests/my-mod.test.ts         claude plugin test
```

The `modules` key in `hooks.json` is what makes a plugin a mod. Every hook has the same shape:

```ts
on('event.name', optionalMatcher, async ($, e, next) => {
  // $    : the engine (ui, model, session, tool, fs, store, clock, process, http, ...)
  // e    : the event's input, frozen
  // next : run everything beneath you (other mods, then Claude Code itself)
  return next(e)              // pass through
  // return next({ ...e, x }) // rewrite what the rest sees
  // return { deny: '...' }   // answer for yourself
})
```

Copy [`templates/mod-template`](../templates/mod-template) to start.

## Ten patterns

### 1. A status line entry

One per mod, pinned under the prompt. `undefined` clears it. Call it from any hook.

```ts
on('session.measure', async ($, e, next) => {
  const { context } = await $.session.usage()
  $.ui.status(`ctx ${Math.round(context.percent ?? 0)}%`)
  return next(e)
})
```

Used by [cost-meter](../mods/cost/cost-meter) and [git-pulse](../mods/awareness/git-pulse).

### 2. A toast

A small box over the transcript's top-right corner for a few seconds. Use it for news, not every event.

```ts
$.ui.toast('Claude made 2 commits on feat/login')
```

### 3. A slash command

Register it in `session.start`, answer it in `command.run`. The returned `text` is printed, and the model reads it too.

```ts
on('session.start', async ($, e, next) => {
  await $.command.register({ name: 'hello', description: 'Says hi', argumentHint: '[name]' })
  return next(e)
})
on('command.run', { command: 'hello' }, async ($, e) => ({ text: `hi ${e.args || 'there'}` }))
```

### 4. Block or confirm a tool call

`tool.call` fires below the permission system, for the main thread and every subagent. Here's how [bash-guard](../mods/safety/bash-guard) holds even in bypass mode:

```ts
on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
  if (isCatastrophic(e.command)) return { deny: 'blocked: deletes your home directory' }
  if (isRisky(e.command)) {
    const answer = await $.ui.ask(`Run ${e.command}?`, { options: ['Run it', 'Block it'] }).catch(() => 'Block it')
    if (answer !== 'Run it') return { deny: 'the user declined' }
  }
  return next(e)
})
```

`$.ui.ask` rejects in a `-p` run, where nobody can answer, so `.catch` to the safe choice. The `deny` text is what the model reads, so tell it what to do next.

### 5. React to a tool's result

`await next(e)` runs the tool. Then look at the result.

```ts
on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
  const ran = await next(e)
  if (ran.deny === undefined && ran.isError === true) $.ui.toast(`failed: ${e.command.slice(0, 40)}`)
  return ran
})
```

### 6. Rewrite what the model reads

`session.append` fires once for every row the conversation keeps, before it's stored and sent. Rewrite the `content` blocks:

```ts
on('session.append', { door: 'tool-result' }, ($, e, next) => next({ ...e, message: redact(e.message) }))
  .catch(($, e, next) => next({ ...e, message: placeholder(e.message) }))
```

The `.catch` handler is important for a redactor. If the hook throws, the row is stored with a placeholder, never raw. See [secret-shield](../mods/safety/secret-shield).

### 7. Add to the system prompt

`prompt.compose` resolves the system prompt's sections. Append yours last with `scope: 'session'`:

```ts
on('prompt.compose', async ($, e, next) => {
  const composed = await next(e)
  if (goal === undefined) return composed
  return { ...composed, sections: [...composed.sections, { id: 'focus', text: `The user's focus: ${goal}`, scope: 'session' }] }
})
```

Changing a section spends the prompt cache, so only change it when the content does. See [focus](../mods/productivity/focus).

### 8. A band above the prompt

Hook `ui.render` on `AbovePrompt`. Return `next(e)` to show nothing. Size the tree to `e.props.bodyColumns`, and stay out of the way of a survey (`e.props.hasSurvey`).

```tsx
on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
  const goal = await read($, goalAtom)
  if (goal === null || e.props.hasSurvey) return next(e)
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box>
      <Text dimColor>🎯 {goal} </Text>
      <Button key="done" label="Done" onPress={() => update($, goalAtom, () => null)} />
    </Box>
  )
})
```

Elements come from `$.ui.resolve(e)`, not globals. Every `Button` needs a `key`.

### 9. A pane

`$.ui.open({ id, title })` opens it, and a `ui.render` hook on `{ component: 'Pane', requestId: id }` draws it. A pane you open because the user typed a command seats at any width. One opened unasked, from `session.start` or a timer, waits until the terminal is 144 columns wide.

```ts
on('command.run', { command: 'radar' }, async $ => {
  await $.ui.open({ id: 'radar', title: 'Tool radar' })
  return { text: 'Radar open.' }
})
```

See [tool-radar](../mods/awareness/tool-radar) and [wrapped](../mods/fun/wrapped).

### 10. State that redraws

Values a drawing reads belong in `$.state`, because module variables reset on every hot reload. Declare them in `types/index.d.ts` and name the file in `plugin.json` as `"types": "./types/index.d.ts"`:

```ts
// types/index.d.ts
declare module 'claude-code' {
  interface PluginState { 'my-mod': { goal: string | null } }
}
```

```ts
import { atom, read, update } from 'claude-code'
const goalAtom = atom({ plugin: 'my-mod', key: 'goal' } as const, null)
// read($, goalAtom) while drawing subscribes the drawing; update($, goalAtom, fn) redraws it.
```

Writes are refused while drawing, so write from an `onPress` or another event. To keep a value across sessions, write it to `$.store` as well. `$.store` is JSON on disk, 4 MiB per mod.

## Rules the validator enforces

`claude plugin validate --strict <dir>` reads your source the way the engine will. It prints `hooks:` and `calls:` lines, a capability manifest for anyone reviewing the mod. It refuses:

| Rule | Instead |
| --- | --- |
| Passing `$` to a helper defined inside `register` | Make the helper a **top-level** `function` (or a top-level `const` bound to one) |
| Aliasing or destructuring `$` (`const { ui } = $`) | Write every call in full: `$.ui.toast(...)` |
| Computed event names (`on(name, ...)`) | String literals: `on('tool.call', ...)` |
| `import()`, `require`, Node built-ins, `setTimeout` | Static relative `import`s, `$.clock.after/every/sleep`, `$.fs`, `$.process` |
| `$.state` keys that aren't literals or aren't in your contract | `{ plugin: 'my-mod', key: 'goal' } as const`, declared in `types/index.d.ts` |
| A plugin name starting with `claude-` | Any other name |
| A parameter or local with the same name as a `$`-taking helper (`function ping($)` and later `(ping) => ...`) | Keep helper names unique across the file |
| Registering a built-in command name (`/cost`, `/help`, ...) | Pick another name (`/spend`) |

Module-level `let`s are fine for state that may reset on reload, such as counters and caches.

A few more facts that save time:

- Claude Code prefixes a command's output with the mod's name (`my-mod: ...`), so don't add it yourself.
- A matcher can list several values, meaning any of them: `on('tool.call', { tool: ['Edit', 'Write'] }, ...)` also narrows `e`.
- Native macOS and Linux builds don't register `Grep`, `Glob` or `MultiEdit`, so compare those with `String(e.tool) === 'Grep'`.
- `Edit` and `Write` results carry `structuredPatch`, which gives exact +/− line counts. `Write` also says `type: 'create' | 'update'`.
- Loading a mod with `--plugin-dir` writes `.claude-plugin/types/` and a `tsconfig.json` into its folder. Gitignore them.

## Testing recipes

`claude plugin test <dir>` runs every `*.test.ts` against the real engine, with no session, network or sign-in. The test gets the engine's `$`, which fires events through your mod, and an `on` for stubs that answer beneath it, in Claude Code's place.

```ts
import { expect, mock, test } from 'claude-code/testing'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

test('blocks rm -rf ~', async ($, on) => {
  mock.store(on)                                          // $.store in memory
  on('ui.toast', () => ({ value: undefined }))            // every $ call your hook makes needs a stub
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))

  const out = await $.tool.call({ tool: 'Bash', command: 'rm -rf ~' })
  expect(out.deny).toMatch(/home/)

  const status = await $.command.run({ command: 'bash-guard', args: '', ...TYPED })
  expect(status.text).toMatch(/1 blocked/)
})
```

| You need | Stub |
| --- | --- |
| `$.store` | `mock.store(on, { initial: 'values' })` |
| `$.command.register` | `on('command.register', ($, e) => ({ value: { command: e.name } }))` |
| `$.ui.toast`, `$.ui.status`, `$.ui.log` | `() => ({ value: undefined })`, where `e.text` is what was shown |
| `$.clock` (timers, now) | `const clock = mock.clock(on)`, then `await clock.advance(1000)` |
| `$.env.get` | `mock.env(on, { HOME: '/home/me' })` |
| `$.ui.ask` | A `tool.call` stub for `AskUserQuestion`: `({ result: { questions: e.questions, answers: { [e.questions[0].question]: 'Run it' } } })` |
| `$.model.complete` | `on('model.complete', () => ({ value: { isAnswered: true, text: '...', usage } }))` |
| `$.process.run` | `on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: '...', stderr: '' } }))` |
| `$.http.fetch` | `on('http.fetch', ($, e) => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))` |
| Options | `test('name', { options: { risky: 'block' } }, async ($, on) => ...)` |
| A drawing | `const ui = await $.ui.mount({ plugin, surface: 'terminal', component: 'Pane', requestId, props })`, then `ui.press({ key })`, `ui.find({ text })` |

Gotchas:

- Register every stub **before** the first call on `$`.
- `session.start` doesn't fire by itself. Fire it with `$.session.start(...)` if your hooks depend on it.
- The typed `$.command.run` wants `origin` and `presentation`. Spread `TYPED` as above.
- A hook that calls a `$` method with no stub is **skipped**, and the test only says why when an assertion fails. When a test fails mysteriously, look for `no implementation for <call>` under `the engine reported:`.
- Run the same drawing test on `['terminal', 'desktop'] as const`. The element tables differ.
- `$.turn.complete(...)` in a test needs `reason: 'answer'` among its fields.
- A stub that returns `{ deny }` makes the mod's call reject, and a `tool.call` stub that throws makes `$.tool.call` reject. Use these to test failure paths.
- Type the `ui.render` stub that stands for Claude Code's own drawing as `() => ({ type: 'Text' as const, props: {}, children: ['…'] })`. A whole-object `as const` makes `children` readonly and fails the typecheck.
- Test files can't use dynamic `import()` either.

## Running and debugging

```shell
claude --plugin-dir ./my-mod            # load it for one session; saving a file hot-reloads it
claude --plugin-dir ./my-mod --debug    # every refused tree and skipped hook, with the reason
claude -p --plugin-dir ./my-mod "..."   # headless: hooks run, nothing is drawn
```

- A failing hook is skipped, never fatal. The transcript shows one dim line, `<mod>: <event> ... <reason>`.
- A `ui.render` tree that doesn't validate (an element the surface lacks, or a prop it doesn't take) is replaced by the engine's own drawing.
- In `-p` mode, `$.ui.ask` rejects and nothing is drawn. `claude -p "/my-command"` still runs your registered command and prints its output, and `--debug-file <path>` logs every `$.ui.status`, `$.ui.toast`, `$.process.run` and `$.audio.play`. That's enough to prove a UI mod's hooks fire in CI.
- Hooks have a 10-second budget, not counting time inside `next` or `$` calls. Long work belongs in a `$.clock` timer started from `session.start`.

## Shipping it

A mod ships as a normal plugin. Put a `.claude-plugin/marketplace.json` at your repo's root:

```json
{
  "name": "my-mods",
  "owner": { "name": "you" },
  "plugins": [{ "name": "my-mod", "source": "./my-mod", "description": "..." }]
}
```

Users then run:

```shell
/plugin marketplace add you/your-repo
/plugin install my-mod@my-mods
```

Bump `version` with every change, because installed copies are cached by version. Then [submit it to this list](https://github.com/Singh-AP/awesome-claude-mods/issues/new?template=submit-a-mod.yml).
