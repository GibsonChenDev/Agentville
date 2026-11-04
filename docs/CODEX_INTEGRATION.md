# Codex integration

Verified on 2026-11-04 against https://developers.openai.com/codex/hooks (now served from learn.chatgpt.com/docs/hooks) with the Codex CLI **0.160.1** bundled in ChatGPT.app (`hooks` feature: stable, on by default).

Codex sessions join the office next to Claude Code's, as their own characters with a **CX** tag (Claude Code: **CC**). The two never share a character, a customization or a hooks file.

## How it works

```
codex (CLI / IDE / desktop app)
   │  command hook, payload on stdin
   ▼
agentville --agentville-hook codex     (Agentville's own executable, no window, no output, exit 0)
   │  POST /hooks/codex  (hook token read from Agentville's config)
   ▼
built-in receiver 127.0.0.1:47821 ──NDJSON, tagged provider=codex──▶ UI (Codex dialect normalizer)
      ▲
      └── ~/.codex/hooks.json written by Agentville (opt-in, reversible)
```

Differences from Claude Code and why:

| | Claude Code | Codex |
|---|---|---|
| Hook file | `~/.claude/settings.json` | `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`). `config.toml` is never touched. |
| Handler | `type: "http"` | `type: "command"` — Codex has no http hooks. The command is Agentville's executable with `--agentville-hook codex`; it reads port and token from Agentville's config, so **the token is not in hooks.json** and changing the port doesn't change the hook. |
| Trust | none | Codex skips new or changed hooks until the user trusts them (`/hooks` in the CLI; **Review hooks** or Settings → Hooks in the desktop app). Agentville can't do this step; the Settings card says how and turns "Connected" when the first hook arrives. |
| Timeout | 2 s | 2 s (Codex's default is 600 s). |
| Output | `{}` from the receiver | none at all. Codex adds SessionStart/UserPromptSubmit stdout to the model's context and treats exit 2 as "block", so the forwarder never prints and always exits 0. |

## Event mapping

| Codex hook | Domain event | Notes |
|---|---|---|
| `SessionStart` / `SessionEnd` | `session.started` / `session.ended` | |
| `UserPromptSubmit` | `prompt.submitted` | |
| `PreToolUse` / `PostToolUse` | `tool.started` / `tool.finished` | matcher `*` |
| `PermissionRequest` | `permission.requested` | |
| `Stop`, `Interrupt` | `turn.completed` | `Interrupt` = the user stopped the turn |
| `SubagentStart` / `SubagentStop` | `subagent.started` / `.stopped` | Codex reports a subagent's tool events under the parent session, so they show on the parent |

Not sent by Codex: `PostToolUseFailure`, `Notification`, agent-team task events, `CwdChanged` (the `cwd` on every event still drives location). Not observed: `PreCompact`/`PostCompact`, `PreModelRequest`/`PostModelRequest`.

Tool names: `Bash`/`exec_command` (argv or string; test commands → test), `apply_patch` (write; target = patched files from the patch text), `update_plan` (plan), `spawn_agent` (delegate), `view_image` (read), MCP tools as for Claude Code.

## Verification

- `cargo test` — hooks file merge/uninstall for both providers, receiver routes per provider, forwarder flag.
- `cargo test --test codex_forwarding` — the **real `agentville` executable** as forwarder: delivers to the receiver tagged `codex`, prints nothing, exits 0 (also when Agentville isn't running or has no config).
- `cargo test --test codex_forwarding -- --ignored --nocapture` — **real Codex CLI** with Agentville-written hooks.json in an empty `CODEX_HOME`, no credentials and an unreachable API (nothing leaves the machine). Uses Codex's `--dangerously-bypass-hook-trust` for that one run, in place of the trust step a user does by hand. Not run automatically.
- Vitest: Codex dialect (`packages/integrations/src/providers/codex.test.ts`), pipeline separation (`hookPipeline.test.ts`), Rust ↔ TS registry parity (`providerParity.test.ts`).

## Not verified

- A live Codex session with a trusted hook through the packaged app (the real-CLI test above is opt-in).
- Codex on Windows: how `command` is run there (cmd vs PowerShell) isn't documented; the executable path is unquoted unless it contains spaces.
