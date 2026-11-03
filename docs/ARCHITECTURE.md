# Architecture

## Layers

```
 raw source events            normalized domain events        logical status          animation intent
 (hook JSON, SDK messages, ─▶ (DomainEvent, packages/   ─▶ (AgentRuntime via    ─▶ (VisualIntent via
  demo fixtures)               domain/events)               applyEvent reducer)       intentFor + IntentScheduler)
```

The four layers required by the brief are kept in separate modules:

| Layer | Module | Notes |
|---|---|---|
| 1. Raw event | `packages/claude-integration/src/hooks/normalize.ts` (hooks), `apps/desktop/src/features/demo` (fixtures) | Untrusted input. Validated, length-limited, never rendered as HTML. |
| 2. Domain event | `packages/domain/src/events/types.ts` | Language-neutral union, tagged with `source` (`demo`/`hook`/`sdk`/`app`). |
| 3. Logical status | `packages/domain/src/agents/reducer.ts` | Pure state machine. Handles duplicates (store-level id set), reordering (`seq`), late tool events, recoverable tool failures, stale sessions. |
| 4. Visual intent | `apps/desktop/src/game/animations/intent.ts` | Maps status → place/activity/screen. `IntentScheduler` enforces minimum dwell, coalescing and urgent overrides so rapid events don't thrash. |

Cosmetic idle motion (breathing, blinking, dust motes) lives purely in the renderer and never feeds back into status.

## Packages

- **`@agentville/domain`** — no runtime dependencies. Agents, appearance options, capabilities matrix (`can(origin, capability)`), tasks and their transition table, office layout types.
- **`@agentville/claude-integration`** — adapters from Claude Code into domain events. Hook normalizer (tested against malformed payloads).
- **`@agentville/desktop`** — React UI + PixiJS world + Tauri shell.

## Desktop app

```
src/
  app/            App shell, global shortcuts
  features/       agents (sidebar, inspector), activity (console), office (world view, toolbar), settings, demo
  game/           engine (OfficeWorld, textures, pixel toolkit), assets (characters, icons, palettes, themes),
                  furniture, scenes (layouts, room renderer, lighting), navigation (A*), animations, characters
  i18n/, locales/ i18next setup, en + zh-TW namespaces
  presentation/   status tones, formatting (Intl), event display helpers
  state/          Zustand store + preference persistence
src-tauri/        Rust shell: settings, tool detection, bridge supervisor
```

### Renderer boundary

`OfficeWorld` receives `WorldAgent[]` (record + derived status + **already localized** badge text) through `sync()`. It never imports the store or talks to Claude. React subscribes to the store outside the render cycle and pushes snapshots; language changes re-push labels, so the world updates instantly.

### State

Zustand store (`state/store.ts`) holds agents, runtimes, a bounded event log (2,000) and a bounded seen-id set (5,000) for de-duplication. Subagents are created on `subagent.started`, attributed `parentId`, and leave on `subagent.stopped`. Collaboration events fan out to all participants.

Persistence:
- **SQLite** (`src-tauri/src/db.rs`) stores character profiles and office layouts as validated JSON documents with schema migrations. The UI reaches it through `persistence/repository.ts` (Tauri commands), which falls back to localStorage outside the desktop shell.
- Characters are shown as `applyProfile(baseRecord, profile)`; the store keeps both the discovered record and the effective one, so “Restore defaults” is exact.
- Office layouts are edited as pure transformations (`game/scenes/editing.ts`) that either return a new valid scene or an error code; the renderer only ever draws a scene it is given.
- Preferences (language, theme, panels, motion) remain in localStorage.

## Runtime topology (Monitor Mode, macOS & Windows)

```
claude (terminal/IDE) ──http hook POST──▶ receiver 127.0.0.1:47821 (Rust, in-app)
                                              │ validates envelope, stamps id/seq/time, buffers 500
                                              ▼ NDJSON /stream (UI token)
                     webview: hookPipeline → normalizeHookPayload (TS) → store → PixiJS world
                                              ▲ /rpc: hooks install/preview/remove, git.info, claude.status
```

- No runtime dependencies besides Claude Code: the receiver (`src-tauri/src/receiver.rs`, tiny_http) and the hooks installer (`hooks.rs`) are Rust, built into the app.
- Event ids derive from the receiver's per-run hook id/sequence, so stream reconnects replay deterministically and the store de-duplicates.
- Rust also owns Claude Code detection (`detect.rs`, platform-specific locations), the official-installer runner (`installer.rs`: bash on macOS, PowerShell on Windows), opening a terminal with `claude`, settings, and SQLite (`db.rs`).
- React never executes processes; it calls typed Tauri commands or the receiver's RPC.

## Decisions

| Decision | Why |
|---|---|
| Three-quarter top-down view, 16 px tiles | Simplest correct depth sorting (by feet y), square-grid A*, predictable hit-testing; detailed sprites without isometric distortion. |
| Procedural pixel art drawn at native resolution | No image-generation API is assumed; assets are deterministic, palette-locked and replaceable via the texture cache. |
| Integer zoom (1–6×) + device-pixel camera snapping | Keeps pixels crisp on Retina without shimmer. |
| Screen-space badges (Pixi `Text`) | Chinese and English labels stay sharp at every zoom; pixel fonts are never used for CJK. |
| Tailwind v4 for UI | Matches the brief; theme tokens live in `styles/index.css`. |
