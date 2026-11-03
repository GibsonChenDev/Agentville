// Replays a realistic Claude Code session against the hooks installed in a
// settings file, exactly as Claude Code would POST them. For testing Monitor
// Mode without spending model usage.
//   node scripts/replay-hooks.mjs [settings.json] [speed]
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const settingsPath = process.argv[2] ?? join(tmpdir(), 'agentville-dev', 'settings.json');
const speed = Number(process.argv[3] ?? 1);
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
const target = (event) => settings.hooks?.[event]?.flatMap((g) => g.hooks).find((h) => h.url?.includes('src=agentville'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms / speed));
let n = 0;
async function fire(event, body) {
  const hook = target(event);
  if (!hook) throw new Error(`no Agentville hook installed for ${event}`);
  const res = await fetch(hook.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...hook.headers }, body: JSON.stringify({ hook_event_name: event, ...body }) });
  console.log(`${String(++n).padStart(2)} ${event.padEnd(19)} ${res.status}`);
}

const A = { session_id: 'a1b2c3d4-0000-4000-8000-000000000001', transcript_path: '/tmp/a.jsonl', cwd: '/Users/demo/code/storefront', permission_mode: 'default' };
const B = { session_id: 'b2c3d4e5-0000-4000-8000-000000000002', transcript_path: '/tmp/b.jsonl', cwd: '/Users/demo/code/api-server', permission_mode: 'default' };
const tool = (s, event, name, id, input, extra = {}) => fire(event, { ...s, tool_name: name, tool_use_id: id, tool_input: input, ...extra });

await fire('SessionStart', { ...A, source: 'startup', model: 'claude-sonnet' });
await sleep(1500);
await fire('SessionStart', { ...B, source: 'startup' });
await sleep(3000);
await fire('UserPromptSubmit', { ...A, prompt: 'Fix the flaky checkout test' });
await sleep(1500);
await tool(A, 'PreToolUse', 'Read', 'toolu_r1', { file_path: '/Users/demo/code/storefront/src/checkout.ts' });
await fire('UserPromptSubmit', { ...B, prompt: '幫我加上 /health 端點' });
await sleep(4000);
await tool(A, 'PostToolUse', 'Read', 'toolu_r1', {}, { tool_response: {} });
await tool(B, 'PreToolUse', 'Edit', 'toolu_e1', { file_path: '/Users/demo/code/api-server/src/routes.ts' });
await tool(A, 'PreToolUse', 'Bash', 'toolu_b1', { command: 'npm test -- checkout', description: 'Run checkout tests' });
await sleep(4500);
await tool(A, 'PostToolUseFailure', 'Bash', 'toolu_b1', {}, { error: '1 failing: checkout › applies coupon' });
await tool(B, 'PostToolUse', 'Edit', 'toolu_e1', {});
await sleep(800);
await tool(A, 'PreToolUse', 'Agent', 'toolu_t1', { subagent_type: 'Explore', description: 'Find coupon logic' });
await fire('SubagentStart', { ...A, agent_id: 'sub-explore-1', agent_type: 'Explore' });
await tool(B, 'PreToolUse', 'Bash', 'toolu_b2', { command: 'rm -rf dist && npm run build' });
await fire('PermissionRequest', { ...B, tool_name: 'Bash', tool_input: { command: 'rm -rf dist && npm run build' } });
await sleep(4000);
await tool({ ...A, agent_id: 'sub-explore-1', agent_type: 'Explore' }, 'PreToolUse', 'Grep', 'toolu_g1', { pattern: 'applyCoupon' });
await sleep(4000);
await tool({ ...A, agent_id: 'sub-explore-1', agent_type: 'Explore' }, 'PostToolUse', 'Grep', 'toolu_g1', {});
await fire('SubagentStop', { ...A, agent_id: 'sub-explore-1', agent_type: 'Explore', stop_hook_active: false });
await tool(A, 'PostToolUse', 'Agent', 'toolu_t1', {});
await sleep(1000);
await tool(A, 'PreToolUse', 'Edit', 'toolu_e2', { file_path: '/Users/demo/code/storefront/src/coupon.ts' });
await sleep(3000);
await tool(B, 'PostToolUse', 'Bash', 'toolu_b2', {});
await sleep(1000);
await fire('Stop', { ...B, stop_hook_active: false });
await sleep(3000);
await tool(A, 'PostToolUse', 'Edit', 'toolu_e2', {});
await fire('Stop', { ...A, stop_hook_active: false });
await sleep(6000);
await fire('SessionEnd', { ...B, reason: 'prompt_input_exit' });
console.log('done');
