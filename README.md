# Agentville

**Your AI team, alive. ／ 你的 AI 團隊，活起來了。**

Agentville is a desktop app for **macOS and Windows** (Tauri 2 + React + PixiJS) that shows your Claude Code agents as characters in a hi-res pixel-art office. Characters move and animate according to **observed** agent activity: reading files, editing code, running tests, waiting for approval, spawning subagents.

Agentville 是一款支援 **macOS 與 Windows** 的桌面 App，把你的 Claude Code Agent 變成高解析像素風辦公室裡的角色。角色會根據**實際觀察到的** Agent 活動移動與做動作：讀檔、改程式、跑測試、等待核准、建立子 Agent。

> **Status:** Phases 1, 2, 4, 5 (Monitor Mode cowork) and most of 6 are done; Phase 3 (in-app control, needs an API key) is deferred. Phase 2 — **Monitor Mode** works: Claude Code sessions you start in a terminal appear in the office through hooks (no API key). See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
>
> **目前進度：** 第 1、2、4、5 階段（監控模式下的協作）與大部分第 6 階段已完成；第 3 階段（App 內控制，需要 API 金鑰）暫緩。第 2 階段——**監控模式**已完成：你在終端機啟動的 Claude Code 工作階段會透過 Hooks 出現在辦公室（不需要 API 金鑰）。

## Using Monitor Mode ／ 使用監控模式

1. Install Agentville (`.dmg` on macOS, `-setup.exe` on Windows) and open it.
2. The welcome screen offers **Set up automatically / 開始自動設定**, which:
   - installs Claude Code with Anthropic's official installer if it's missing (macOS `curl -fsSL https://claude.ai/install.sh | bash`, Windows `irm https://claude.ai/install.ps1 | iex`) — no admin rights;
   - starts the built-in receiver (nothing else to install — no Node.js);
   - connects Claude Code by adding hooks to `~/.claude/settings.json` (backup first; removable any time).
3. Sign in to Claude Code once (the app opens a terminal running `claude` for you).
4. Run `claude` in any project — the session walks into the office.

The in-app **Guide / 使用教學** (sidebar) explains installing and signing in to Claude Code, what every bubble means, agent teams, worktrees and troubleshooting.

Monitored sessions are view-only: answer prompts and permissions in the terminal.

## Teams, tasks & worktrees ／ 團隊、任務與 worktree

Monitor Mode also shows real coordination, still without an API key:
- **Agent teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): the shared task list appears in the sidebar; when a teammate completes a task a document flies to the lead's desk.
- **Subagents** report back with a flying document when they finish.
- **Git worktrees**: sessions are grouped by repository with their branch; worktrees are marked.
- **Conflicts**: two sessions editing the same file in one working tree within 10 minutes raise a warning.

## Customizing ／ 自訂

- **Characters / 角色**: select someone → **Customize outfit / 自訂服裝**. Hair, skin, outfit, accessory, desk equipment and preferred desk, with a live animated preview. Customizations follow the project folder, so every new session in that project keeps the look.
- **Office / 辦公室**: **✎ Edit office / 編輯辦公室** → drag furniture, place new pieces from the palette, flip or remove desks. Invalid spots (blocking the door or someone's path) are refused with a reason. Saved per theme.
- Everything is stored locally in SQLite (`~/Library/Application Support/com.agentville.desktop/agentville.sqlite`).

## Requirements

Users: macOS 12+ or Windows 10/11, and a Claude account with Claude Code access (the app installs Claude Code itself).

Development: Node.js 18+, Rust stable, and Xcode Command Line Tools (macOS) or the MSVC build tools (Windows).

## Develop

```bash
npm install
npm run tauri dev      # desktop app with hot reload
```

## Test & check

```bash
npm test               # vitest: domain, hooks normalization, i18n parity, navigation, animation scheduling
npm run typecheck      # tsc -b across all workspaces
npm run i18n:check     # en / zh-TW key parity, interpolation, Simplified-character guard
(cd apps/desktop/src-tauri && cargo test)
```

## Build

```bash
npm run tauri build -- --target universal-apple-darwin --bundles app,dmg   # macOS
npm run tauri build -- --bundles nsis                                       # Windows
```

CI builds and tests both platforms (`.github/workflows`).

Signing, notarization and uninstall steps: [docs/RELEASE.md](docs/RELEASE.md).

## Layout

```
apps/desktop/            React UI, PixiJS world, Tauri shell (src-tauri/: receiver, storage, installers)
packages/domain/         Language-neutral domain: events, agent state machine, tasks, office types
packages/claude-integration/  Hook payload normalization
docs/                    Architecture, art direction, localization, integration, roadmap, testing
```

## Keyboard

`+`/`−` zoom · arrows pan · `F` follow selected · `]` next agent · `Esc` deselect · `` ` `` activity log · `⌘,` settings. Trackpad: two-finger pan, pinch to zoom.
