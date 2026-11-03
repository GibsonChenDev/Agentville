# Roadmap

| Phase | Scope | State |
|---|---|---|
| 0 — Discovery | Toolchain check (Node 26, Rust 1.99 installed, Xcode, Claude Code 2.1.277), hooks + Agent SDK verification, architecture & art plans | ✅ done |
| 1 — Pixel office + bilingual UI | Tauri app, three themed hi-res pixel offices, layered animated characters, pathfinding, lighting, sidebar / inspector / activity console / settings, en + zh-TW, Demo Mode | ✅ done |
| 2 — Monitor Mode | Local hook receiver (supervised Node bridge), opt-in reversible hook installer, setup UI, live external sessions & subagents | ✅ done (Agent SDK managed mode deferred) |
| 3 — Controls & tasks | Managed agents via Agent SDK (API key), prompts, approvals, cancel, resume, task board | deferred (product decision) |
| 4 — Customization | Character editor (live preview), equipment, workstation choice, office editor (place/move/remove furniture, validation, walkable paths), SQLite persistence | ✅ done |
| 5 — Multi-agent cowork | Observed: agent-team tasks and handoffs, subagent reports, worktree/branch grouping, edit-conflict warnings. App-driven delegation needs Phase 3 | ✅ done (observed) |
| 6 — Productization | Notifications, sound (opt-in), first-run welcome, history persistence, DMG ✅; signing (needs Developer ID), accessibility audit, performance measurement, UI/E2E tests open | in progress |
