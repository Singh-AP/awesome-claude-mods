# Changelog

New mods, curation decisions and fixes, newest first. Entries from 2026-10-05 on are written by the [daily run](automation/README.md).

## 2026-11-17

- Added five mods, each read in full, tested on Claude Code 2.1.326 and pinned for install from here: [usage-pet](https://github.com/manson341349-beep/claude-desktop-mods/tree/main/plugins/usage-pet) (#5), [flightdeck](https://github.com/scasella/claude-flightdeck), [diffr](https://github.com/devdotfast/whiteboard/tree/main/diffr/packages/claude-code/plugin), [prismantis](https://github.com/NahumLitvin/prismantis/tree/main/plugin) and [headroom-snip](https://github.com/headroomlabs-ai/headroom/tree/main/plugins/headroom-snip).
- Reviewed and passed on 20 more; every reason is in `data/curation-log.json`.
- CI is green again on Claude Code 2.1.326: test fixtures carry the band's new `isCollapsed`, and command-explainer's tests account for `$.tool.call` now running the engine's own permission check.
- The link check skips star-history's chart API, which rate-limits bots (#8).

## 2026-10-13

- Added two submitted mods, both reviewed line by line, tested and pinned for install from here: [cockpit](https://github.com/drkokorev/cockpit-for-claude/tree/main/plugins/cockpit) (#2) and [mixture-of-models](https://github.com/alinaqi/mixture-of-models-claude-mod) (#3).
- Fixed the weekly link check: it failed on a flag lychee v2 removed, so it never checked a link (#1, #4).

## 2026-10-04

- Launched with 20 mods built and tested here (793 tests), 76 curated community mods (24 pinned and installable from this marketplace), and a daily index of every public mod.
- Fixed fake connection strings in tests that GitHub secret scanning flagged (not real credentials).
