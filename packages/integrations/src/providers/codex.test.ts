import { describe, expect, it } from 'vitest';
import { normalizeHook, type NormalizeContext } from '../hooks/normalize';
import { codex } from './codex';

let n = 0;
const ctx: NormalizeContext = { receivedAt: 7, newId: () => `id${++n}`, agentIdFor: codex.agentIdFor };
const run = (raw: Record<string, unknown>) => normalizeHook({ session_id: 'th-1', cwd: '/w', model: 'gpt-5.5', ...raw }, ctx, codex.dialect);
const tool = (tool_name: string, tool_input: unknown) => {
  const r = run({ hook_event_name: 'PreToolUse', turn_id: 't', tool_name, tool_use_id: 'u', tool_input });
  return r.ok && r.event.payload.kind === 'tool.started' ? [r.event.payload.category, r.event.payload.target] : r;
};

describe('Codex hooks', () => {
  it('maps lifecycle events onto Codex characters', () => {
    const start = run({ hook_event_name: 'SessionStart', source: 'startup' });
    expect(start.ok && [start.event.agentId, start.event.payload]).toEqual(['ext-codex-th-1', { kind: 'session.started', cwd: '/w', source: 'startup' }]);
    const prompt = run({ hook_event_name: 'UserPromptSubmit', turn_id: 't', prompt: 'fix the build' });
    expect(prompt.ok && prompt.event.payload).toEqual({ kind: 'prompt.submitted', preview: 'fix the build' });
    const end = run({ hook_event_name: 'SessionEnd', reason: 'other' });
    expect(end.ok && end.event.payload).toEqual({ kind: 'session.ended', reason: 'other' });
  });

  it('ends the turn on Stop and on Interrupt', () => {
    for (const hook_event_name of ['Stop', 'Interrupt']) {
      const r = run({ hook_event_name, turn_id: 't', stop_hook_active: false });
      expect(r.ok && r.event.payload).toEqual({ kind: 'turn.completed' });
    }
  });

  it('classifies Codex tools', () => {
    expect(tool('Bash', { command: 'ls -la' })).toEqual(['execute', 'ls -la']);
    expect(tool('exec_command', { cmd: 'cargo test --all' })).toEqual(['test', 'cargo test --all']);
    expect(tool('Bash', { command: ['zsh', '-lc', 'pnpm test'] })).toEqual(['test', 'pnpm test']);
    expect(tool('Bash', { command: ['git', 'status'] })).toEqual(['execute', 'git status']);
    const patch = '*** Begin Patch\n*** Add File: a.ts\n+x\n*** Update File: b.ts\n@@\n*** End Patch';
    expect(tool('apply_patch', { command: patch })).toEqual(['write', 'a.ts +1']);
    expect(tool('apply_patch', { input: '*** Begin Patch\n*** Delete File: old.md\n*** End Patch' })).toEqual(['write', 'old.md']);
    expect(tool('apply_patch', 'garbage')).toEqual(['write', undefined]);
    expect(tool('update_plan', { plan: [] })).toEqual(['plan', undefined]);
    expect(tool('spawn_agent', { description: 'audit deps' })).toEqual(['delegate', 'audit deps']);
    expect(tool('mcp__filesystem__read_file', { path: '/w/x' })).toEqual(['other', '/w/x']);
  });

  it('attributes subagent lifecycle to the parent and keeps permission requests', () => {
    const sub = run({ hook_event_name: 'SubagentStart', turn_id: 't', agent_id: 'w1', agent_type: 'worker' });
    expect(sub.ok && [sub.event.agentId, sub.event.payload]).toEqual(['ext-codex-th-1', { kind: 'subagent.started', subagentId: 'w1', agentType: 'worker' }]);
    const perm = run({ hook_event_name: 'PermissionRequest', turn_id: 't', tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: null } });
    expect(perm.ok && perm.event.payload).toMatchObject({ kind: 'permission.requested', toolName: 'Bash', target: 'rm -rf build' });
  });

  it("drops the Codex app's own background threads (no transcript), not the user's", () => {
    // What the Codex app sent for one "hi": the user's thread plus two suggestion threads with no transcript.
    const mine = { transcript_path: '/Users/u/.codex/sessions/2026/11/04/rollout-x.jsonl' };
    const background = { session_id: 'bg-1', cwd: '/', transcript_path: null };
    expect(run({ hook_event_name: 'SessionStart', source: 'startup', ...mine }).ok).toBe(true);
    for (const raw of [
      { hook_event_name: 'SessionStart', source: 'startup' },
      { hook_event_name: 'UserPromptSubmit', turn_id: 't', prompt: 'Generate 0 to 3 hyperpersonalized suggestions…' },
      { hook_event_name: 'PreToolUse', turn_id: 't', tool_name: 'mcp__codex_apps__github__search_prs', tool_use_id: 'u', tool_input: {} },
      { hook_event_name: 'Stop', turn_id: 't' },
      { hook_event_name: 'SessionEnd', reason: 'other' },
    ])
      expect(run({ ...raw, ...background }), raw.hook_event_name).toEqual({ ok: false, reason: 'background' });
    // Older Codex without the field, and a subagent's events (its own transcript is agent_transcript_path), are kept.
    expect(run({ hook_event_name: 'SessionStart', source: 'startup' }).ok).toBe(true);
    expect(run({ hook_event_name: 'PreToolUse', turn_id: 't', tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'w1', transcript_path: null }).ok).toBe(true);
  });

  it.each(['PostToolUseFailure', 'Notification', 'TaskCreated', 'TeammateIdle', 'CwdChanged', 'PreCompact', 'PreModelRequest', 'hasOwnProperty'])('ignores %s, which Codex does not send', (hook_event_name) => {
    expect(run({ hook_event_name })).toEqual({ ok: false, reason: 'unsupported_event' });
  });
});
