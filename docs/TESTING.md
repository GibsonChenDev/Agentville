# Testing

## Commands

```bash
npm test                 # vitest (all workspaces)
npm run typecheck        # tsc -b
npm run i18n:check       # locale parity & quality gate
(cd apps/desktop/src-tauri && cargo test)
npm run build            # production web bundle
npm run tauri build -- --bundles app
```


## Coverage (Phase 1)

| Area | File | What is covered |
|---|---|---|
| Agent state machine | `packages/domain/src/agents/reducer.test.ts` | typical turn, no success-as-completion, recoverable tool failure, permission wait/restore with id matching, reordering by `seq`, uncorrelated tool removal, late events after completion, disconnect stickiness, stale detection |
| Tool classification | `packages/domain/src/events/toolCategory.test.ts` | categories incl. test/build Bash commands, target extraction & truncation |
| Task lifecycle | `packages/domain/src/tasks/types.test.ts` | timestamps, invalid transitions, dependencies |
| Hook normalization (security) | `packages/claude-integration/src/hooks/normalize.test.ts` | mapping, subagent attribution, malformed payloads (null, arrays, unknown events, path-like session ids, missing fields), oversized/markup strings |
| Localization | `apps/desktop/src/i18n/i18n.test.ts` + `scripts/check-i18n.mjs` | system locale mapping, key parity, interpolation parity, no empty strings |
| Navigation | `apps/desktop/src/game/navigation/grid.test.ts` | A*, no corner cutting, unreachable targets, explicit endpoints |
| Visual sync | `apps/desktop/src/game/animations/intent.test.ts` | status→intent, min dwell + coalescing, urgent permission override, transient celebration |
| Preferences | `apps/desktop/src/state/persistence.test.ts` | sanitizing persisted prefs |
| Receiver (Rust) | `src-tauri/src/receiver.rs` | real HTTP: token auth, stream hello/replay + live hooks with ids/seq, malformed/oversized payloads, install/uninstall round trip with backup, invalid JSON settings untouched, CORS allow-list, port in use |
| Hook installer (Rust) | `src-tauri/src/hooks.rs` | merge keeps user hooks and key order, idempotent, exact uninstall, stale detection (port/token/missing events), atomic write + backup, no WorktreeCreate |
| Hook pipeline | `apps/desktop/src/integration/hookPipeline.test.ts` | mid-flight discovery, deterministic ids for replay, subagent attribution, location changes |
| Detection / installer | `src-tauri/src/{detect,installer}.rs` | version + login-status parsing, platform candidates, official install command per OS, unknown tools/links rejected |
| Collaboration | `packages/domain/src/collaboration/collab.test.ts` | team keys, task lifecycle, teammate attribution without fabrication, conflict window and worktree paths |
| Git location | `src-tauri/src/gitinfo.rs` | main checkout vs linked worktree (real repo), detached head, repo without commits |
| History restore | `apps/desktop/src/state/store.test.ts` | replay rebuilds log/tasks, restored sessions departed, revival on new events, de-duplication |
| Profiles | `packages/domain/src/agents/profile.test.ts` | stable keys across sessions, option-level sanitization, overrides |
| Office layouts | `apps/desktop/src/game/scenes/editing.test.ts` | all default layouts valid, move/add/remove/flip, bounds, overlap, doorway, spots, walled-off seats, last desk, stored-document round trip and tampering |
| SQLite | `src-tauri/src/db.rs` | migrations, upserts, theme/key/document validation, size limit, persistence across reopen |
| Rust | `src-tauri/src/{config,detect,lib}.rs` | config defaults/round trip/validation/corruption, version parsing, missing paths |

## Manual verification done for Phase 1

- At 1440×900: all three themes render; characters arrive, path to desks, sit, show activity icons and monitor states; meeting gathering; subagent arrives and leaves; theme switch re-seats agents instantly.
- Language switch zh-TW ↔ en during a running demo: all UI + world badges update, demo continues.
- Production bundle under the Tauri CSP: renders with no console errors (this caught Pixi's `unsafe-eval` requirement, fixed with `pixi.js/unsafe-eval`).

## Real Claude Code check

1. `npm run tauri dev` to start the desktop app.
2. Settings → Monitoring setup → **Set up automatically** (or connect the hooks by hand).
3. In a terminal, in any project folder, run `claude` and send a prompt — the session walks into the office and its events appear in the activity log.

`node scripts/replay-hooks.mjs [settings.json]` replays a realistic two-session run through the hooks installed in a settings file, without spending model usage.

## Not yet automated

- UI component tests and end-to-end desktop tests (planned with Phase 3 when interactive flows exist).
- Bilingual screenshot/overflow snapshots across window sizes.
- Frame-time measurement (no numbers are claimed yet).
