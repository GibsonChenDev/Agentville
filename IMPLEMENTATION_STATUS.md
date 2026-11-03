# Implementation status

_Last updated: 2026-11-03 — cross-platform release candidate (macOS + Windows)._

## What Agentville is today

A desktop app for **macOS 12+ and Windows 10/11** that shows the Claude Code sessions you run in a terminal or IDE as characters in a hi-res pixel-art office (Monitor Mode). No API key and no runtime dependencies besides Claude Code itself, which the app can install with Anthropic's official installer.

## Final test results (2026-11-03)

| Check | Result |
|---|---|
| TypeScript typecheck (`tsc -b`) | ✅ clean |
| Unit/integration tests (vitest) | ✅ 111 passed (domain, normalizer, hook pipeline, layouts, profiles, collaboration, i18n parity, history restore…) |
| Rust tests (`cargo test`) | ✅ 31 passed (real-HTTP receiver tests, hooks installer, SQLite, git, detection, installer) |
| Lint (`cargo clippy --all-targets`) | ✅ 0 warnings (macOS) · ✅ 0 warnings (Windows target) |
| Translation check (en / zh-TW) | ✅ parity, no Simplified characters |
| Windows compile (cross-check from macOS, `x86_64-pc-windows-gnu`) | ✅ compiles and links; `agentville.exe` produced (PE32+ x64 GUI) |
| Windows installer (`-setup.exe`) | ⚠️ not produced locally: Homebrew `makensis` 3.13 crashes on macOS (`bad_alloc`) for any configuration. Built by the Windows runner in `.github/workflows/release.yml` |
| macOS universal build | ✅ `Agentville.app` (x86_64 + arm64, 12.7 MB) and `Agentville_0.1.0_universal.dmg` (6.1 MB) |
| Real Claude Code session → Rust dev receiver → UI | ✅ 17/17 hooks accepted, full sequence incl. Explore subagent, ordering by sequence correct |
| Real Claude Code session → **packaged app** via the user's own installed hooks | ✅ receiver inside the app process (no Node), events in office and SQLite history, branch detected |
| First-run "Set up automatically" on a simulated fresh machine | ✅ shows actions + official command, installs (simulated), starts receiver, writes hooks to an empty settings file (real), asks to sign in |
| Windows wording/commands in UI and guide | ✅ PowerShell installer, Git for Windows note, Windows paths/uninstall |
| App quit | ✅ receiver closes with the app |

## Not verified

- Running the app on an actual Windows PC (no Windows machine available). The CI workflow runs all tests on `windows-latest`; the GUI, installer and Windows Terminal launch need a manual check.
- Real installation of Claude Code by the app (the installer command and runner are tested; running it would have modified this Mac's existing Claude Code).
- Agent teams with a live interactive team (team events verified with documented payloads).

## Feature summary

- **Office**: three themed pixel offices, layered characters, pathfinding, lighting, monitor screens, editor for furniture with walkability rules.
- **Monitor Mode**: built-in Rust receiver (127.0.0.1, token-authenticated, observe-only), opt-in reversible hooks (15 events, never `WorktreeCreate`), deterministic replay on reconnect.
- **Setup & teaching**: first-run welcome → one-click setup (install Claude Code if missing, start receiver, connect hooks, sign-in guidance); Settings checklist with per-step fixes; in-app guide (getting started with commands for macOS/Windows, bubble legend, teams & worktrees, FAQ incl. privacy, cost and uninstall).
- **Cowork (observed)**: agent-team task board, lead/teammate roles, handoff animations, subagent reports, repository/branch/worktree grouping, edit-conflict warnings.
- **Customization**: character editor and office editor, saved in SQLite.
- **History**: 14-day session/event history in SQLite, restored on start; clear in Settings.
- **Team office**: create/join with an invite code; your own character (WASD/click to walk, sit at desks/sofas/beanbags, play the arcade); teammates' characters and agent counts live; their agents as anonymous characters; shared map and furniture edits. Cloudflare Worker relay (`server/relay`), privacy contract in `packages/team-protocol` — see docs/TEAM.md.
- **Product**: native notifications, optional sounds, en/zh-TW throughout, Demo Mode for exploration.

## Deferred

- Phase 3 — in-app control of agents (Agent SDK; needs an API key).
- Code signing (needs an Apple Developer ID and a Windows code-signing certificate) — see docs/RELEASE.md.
- Accessibility audit, measured frame rate, UI/E2E screenshot tests.

## Lobby, accounts, coins, shop, arcade, tour (2026-11-03)

| Check | Result |
|---|---|
| Account rules (recovery codes, earning limits, daily cap, purchases, rooms, scores) | ✅ unit tests |
| Arcade games (2048 merging/game over, snake, flappy, breakout) | ✅ unit tests |
| Relay on local Cloudflare runtime + `scripts/team-smoke.mjs` | ✅ 25/25 (rooms + accounts: create, profile, restore with retyped code, earn 2 turns + 3 tools = 23, buy, no double buy, insufficient funds, score, bad code) |
| In the browser pane (two separate app windows) | ✅ account auto-created with 200 coins · tour · walk-in on launch · out the door to the lobby · "New office" door → create → walk into the new office · arcade opens on reaching the cabinet, all four games play · shop buy/wear · agent turn → "+11 🪙" and server credit · recovery code restores character, coins and team office on the other window · lobby door into the team office |
| Bugs found and fixed while testing | Enter skipped tour steps · arrow keys panned the office behind dialogs · clicks on the top of tall furniture missed it · coin tracker and account creation could start twice |
| Deployed relay with accounts | ⏳ deploys when pushed to main (Cloudflare build) |

## Team office (2026-11-03)

| Check | Result |
|---|---|
| Protocol + room logic unit tests | ✅ 14 passed (auth, relay to teammates only, extra fields stripped, late-joiner welcome, theme/layout sharing, replaced connections, leave/cleanup, rate limit) |
| Interactables tests | ✅ every desk, sofa place, beanbag and arcade reachable in all three offices |
| Relay on local Cloudflare runtime (`wrangler dev`) + `scripts/team-smoke.mjs` | ✅ 16/16 (create, wrong code, sloppy code, join, presence, agent count, theme/layout by non-owner, rotate by owner only, old code dead, leave, empty room deleted) |
| Two app windows + scripted third member, in the browser pane | ✅ create/join UI, invite code, WASD with collision, click-to-walk, desk/sofa sitting, teammate movement mirrored, 3 anonymous agents at desks, map switch synced, arcade |
| Deployed relay on Cloudflare | ⏳ needs `wrangler login` by the account owner |

## Known limitations

- Hooks installed by an older Agentville (11 events) keep working but are flagged "reinstall" to add the team/directory events.
- When Agentville isn't running, Claude Code prints a harmless "hook … failed: connect ECONNREFUSED" line (explained in the guide).
- Sessions already running when hooks are installed must be restarted once.
- Team office: layout edits made while reconnecting are not queued; the last saved layout wins when two people edit at once.
- Preferred workstations are per office theme; restored history shows past sessions as departed until they're active again.
