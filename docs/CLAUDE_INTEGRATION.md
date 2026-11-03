# Claude integration

Verified on 2026-11-02 against https://code.claude.com/docs/en/hooks with Claude Code CLI **2.1.277** installed locally.

## Modes

| Mode | Status | Needs |
|---|---|---|
| **A — Monitor Mode** (observe sessions started in a terminal / IDE) | ✅ implemented, macOS & Windows | Claude Code only (the app can install it). **No API key, no extra cost.** |
| B — Managed agents (start / prompt / approve from Agentville via the Agent SDK) | ⏸ deferred by product decision | An Anthropic API key (the SDK quickstart requires `ANTHROPIC_API_KEY`; claude.ai login may not be offered by third-party products). |

Everything below describes Mode A.

## How Monitor Mode works

```
claude (terminal/IDE) ──http hook POST──▶ bridge 127.0.0.1:47821 ──NDJSON stream──▶ Agentville UI
      ▲                                    (Node, supervised by Rust)
      └── ~/.claude/settings.json hooks written by Agentville (opt-in, reversible)
```

1. The app starts its built-in Rust receiver on 127.0.0.1 with a per-install **hook token** (for Claude Code) and a per-launch **UI token** (for the webview).
2. The user installs hooks from **Settings → Monitoring setup**. Agentville adds one `http` hook per observed event to `~/.claude/settings.json`, each with `timeout: 2` and an `Authorization: Bearer <hook token>` header, URL-tagged `?src=agentville`.
3. Each hook POST is authenticated, size-limited (64 KB), answered immediately with `{}` (observe-only — it never influences Claude's decisions), stamped with an id/sequence and streamed to the UI, where `normalizeHookPayload` turns it into domain events.
4. Unknown session ids become new characters (`ext-<session_id>`), named after the project folder.

## Verified behaviour (spike with the real CLI)

- `type: "http"` hooks work on 2.1.277; the bearer header is delivered verbatim.
- Events can arrive **before** `SessionStart` (observed: `UserPromptSubmit` first). The receiver therefore discovers sessions from any event and synthesizes the arrival.
- An unreachable receiver is a non-blocking hook error; with `timeout: 2` a stalled receiver can delay a tool by at most 2 s.

## Hook → domain mapping

| Hook | Domain event | Notes |
|---|---|---|
| `SessionStart` | `session.started` | `cwd`, `source` |
| `SessionEnd` | `session.ended` | character leaves |
| `UserPromptSubmit` | `prompt.submitted` | preview ≤ 280 chars, shown verbatim as text |
| `PreToolUse` | `tool.started` | category via `classifyTool`, target via `toolTarget` |
| `PostToolUse` | `tool.finished` | correlated by `tool_use_id` |
| `PostToolUseFailure` | `tool.failed` | recoverable |
| `PermissionRequest` | `permission.requested` | no `tool_use_id` in payload; local request id minted |
| `Notification` | `notification` | |
| `Stop` | `turn.completed` | end of a model turn |
| `SubagentStart` / `SubagentStop` | `subagent.started` / `.stopped` | events with `agent_id` are attributed to the subagent's character |

| `TaskCreated` / `TaskCompleted` | `task.created` / `task.completed` | agent-team task list; `teammate_name`, deprecated `team_name` |
| `TeammateIdle` | `teammate.idle` | |
| `CwdChanged` | `location.changed` | plus `cwd` on every event → git location |

**Not hooked on purpose:** `WorktreeCreate` replaces Claude Code's own worktree creation (the hook must return the path), so observing it would break worktrees. Worktrees are detected from each session's `cwd` with read-only `git rev-parse` instead.

**Verified with a real session (2026-11-03, CLI 2.1.277):** a `claude -p` run with Read, Edit, Bash and an Explore subagent produced 17 hook events, all accepted, in the expected order. In this version the Explore subagent ran in the background, so its tool events arrived after the parent's `Stop` — characters handle that because subagents have their own state. Agent teams need an interactive session, so team events were verified with documented payloads (replay), not a live team.

**Permission resolution is implicit.** Hooks never report how the user answered a permission prompt. The state machine treats the gated tool finishing/failing (same tool name), or any new tool starting, as the resolution.

## Capabilities (Monitor Mode)

| Capability | Supported |
|---|---|
| See sessions, tools, prompts, subagents, permission waits, turn end, session end | ✅ |
| Send prompts, approve/deny, cancel, resume | ❌ — the inspector disables these and says to respond in the terminal |

## Security

- Receiver binds to `127.0.0.1` only. Hook endpoint requires the hook token; UI endpoints (`/stream`, `/rpc`) require the per-launch UI token and only grant CORS to the app's own origins. Tokens are compared in constant time.
- The settings file is never rewritten if it isn't valid JSON. A timestamped backup (`settings.json.agentville-backup-<ms>`) is written before every change, and writes are atomic (temp file + rename, mode 0600).
- Uninstall removes only entries carrying the Agentville marker; tests assert the original settings are restored exactly.
- The receiver runs inside the app process, so it can never outlive the app.
- Payload strings are length-limited and rendered as text only.
