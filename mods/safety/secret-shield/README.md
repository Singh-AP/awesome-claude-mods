# 🔐 secret-shield

> Claude never sees your keys. API keys, tokens, private keys and passwords in tool output are swapped for `[REDACTED:kind]` before they reach the model *or* your transcript file.

<img src="../../../assets/screens/secret-shield.svg" alt="secret-shield in a real Claude Code session" width="100%">

```text
● Bash(cat build.log)
  ⎿  step 1: checkout ok
     step 2: push with [REDACTED:github-token] ok
     step 3: done
                                   ╭──────────────────────────────────────────────╮
                                   │ secret-shield                                │
                                   │ secret-shield hid 1 GitHub token from Bash   │
                                   │ output                                       │
                                   ╰──────────────────────────────────────────────╯
```

`cat .env`, `env`, `aws sts get-session-token`, a stack trace with a connection string, a log line with a bearer token: one tool call is all it takes for a live secret to land in the model's context, in your `~/.claude/projects` transcript, and in whatever you paste next. secret-shield scrubs every tool result on its way in.

## Features

- **Redacts before storing.** The tool's result is rewritten in `tool.call`, so the model reads the redacted text and the transcript keeps no copy, display record included. A `session.append` hook is the second net, for file attachments, settings-hook context and anything else that enters the conversation.
- **Finds 20+ secret formats.** AWS access keys, secret keys and STS session tokens · GitHub (`ghp_`, `gho_`, `ghs_`, `github_pat_`…) · Anthropic · OpenAI · Slack tokens and webhooks · Stripe live/test keys and `whsec_` · Google API keys · JWTs · npm · PyPI · Hugging Face · SendGrid · `Authorization: Bearer …` headers · PEM private keys, even half-printed ones · passwords in URLs (`postgres://app:•••@db`, user and host kept).
- **Understands assignments.** `.env`, shell `export`, YAML, TOML, JSON and JS/TS/Python lines like `API_KEY=…`, `password: …`, `"client_secret": "…"` or `const apiKey = "…"` keep the name and lose the value. Lookalikes are left alone: `MAX_TOKENS=1024`, `TOKEN_URL=https://…`, `tokenizer = "bert-base"`, `password = get_password()`, `${DB_PASSWORD}` and `<your-api-key>`.
- **Fails closed.** If a row ever can't be scanned, its text is withheld rather than stored raw.
- **Keeps you informed without noise.** One toast per kind of secret per session.
- **`/secret-shield`** shows what was hidden this session and all time. **`/secret-shield test <text>`** dry-runs any text.
- **Optional file lockout.** With `blockSecretFiles` on, Read, Edit and Write are refused on `.env*`, `*.pem`/`*.key`, `id_rsa`/`id_ed25519`, `~/.ssh/*`, `~/.aws/credentials`, `.npmrc`, `.netrc`, `.git-credentials`, `~/.kube/config` and service-account JSON. `.env.example` and its friends stay readable.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install secret-shield@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later.

## Configuration

| Option | Default | What it does |
| --- | --- | --- |
| `blockSecretFiles` | `false` | Also refuse Read, Edit and Write on files that usually hold secrets. |
| `redactPrompts` | `false` | Also redact secrets you paste into your own prompts. Off by default, because a key you paste is usually meant for Claude. |

## How it works

| Event | Why |
| --- | --- |
| `tool.call` (every tool) | `await next(e)`, then deep-redact the tool's structured result and answer `{ result }`, so core re-maps it for the model and records the redacted copy. Also the optional secret-file lockout. |
| `session.append` on `tool-result`, `tool-message`, `attachment`, `hook-context`, `delivery` | Redacts text blocks and `tool_result` content of every row stored from outside the conversation. Its `.catch` withholds a row's text rather than storing it unscanned. |
| `command.run` | `/secret-shield` status and dry-run |
| `$.store` | All-time counts by kind |

The detectors (`hooks/patterns.ts`) are pure TypeScript with no `$`, so you can import them into your own mod.

## Test it

```shell
claude plugin test mods/safety/secret-shield   # 96 tests
```

A live headless run (`claude -p --plugin-dir …`) had Claude `cat` and `Read` a log line holding a fake GitHub token. The model quoted it back as `[REDACTED:github-token]`, and the session's `.jsonl` transcript held no copy of the token.

## Limitations

- Detection is pattern-based. A secret with no recognizable format and no telltale name, such as a bare 32-character hex string on its own line, gets through. High-entropy guessing is left out on purpose, because it redacts commit SHAs and hashes.
- It protects what flows *into* Claude's context. A secret Claude already knows, because you pasted it with `redactPrompts` off, can still be written into files.
- Your terminal may briefly show a tool's raw output before the redacted row replaces it. The model and the transcript file never get the raw form.
- This build's `claude plugin test` kit can't stand in beneath `session.append`, so that hook's row logic is unit-tested as a pure function (`hooks/rows.ts`) and was checked end to end in a live session.
