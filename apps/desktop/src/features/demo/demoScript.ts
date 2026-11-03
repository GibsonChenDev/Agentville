import type { AgentLocation, AgentRecord, DomainEventPayload } from '@agentville/domain';

/**
 * Deterministic Demo Mode fixtures for visual QA. Every event produced from
 * this file is tagged `source: 'demo'` and every agent `origin: 'demo'`; the UI
 * labels them as demo content and they never mix with live sessions.
 */

export const DEMO_AGENTS: Omit<AgentRecord, 'createdAt'>[] = [
  {
    id: 'demo-ada',
    name: 'Ada',
    role: 'engineering_lead',
    origin: 'demo',
    kind: 'agent',
    projectPath: '~/code/storefront',
    appearance: {
      gender: 'female',
      hairStyle: 'bob',
      hairColor: 'espresso',
      skin: 'light',
      face: 'smile',
      top: 'blazer',
      topColor: 'navy',
      bottom: 'chinos',
      bottomColor: 'charcoal',
      shoes: 'loafers',
      shoesColor: 'charcoal',
      accessory: 'glasses',
      equipment: 'dual_monitor',
    },
  },
  {
    id: 'demo-kenji',
    name: 'Kenji',
    role: 'backend_engineer',
    origin: 'demo',
    kind: 'agent',
    projectPath: '~/code/storefront/api',
    appearance: {
      gender: 'male',
      hairStyle: 'short',
      hairColor: 'black',
      skin: 'tan',
      face: 'focused',
      top: 'hoodie',
      topColor: 'teal',
      bottom: 'jeans',
      bottomColor: 'denim',
      shoes: 'sneakers',
      shoesColor: 'charcoal',
      accessory: 'headphones',
      equipment: 'desktop_tower',
    },
  },
  {
    id: 'demo-mei',
    name: 'Mei',
    role: 'qa_engineer',
    origin: 'demo',
    kind: 'agent',
    projectPath: '~/code/storefront',
    appearance: {
      gender: 'female',
      hairStyle: 'bun',
      hairColor: 'auburn',
      skin: 'porcelain',
      face: 'cheerful',
      top: 'sweater',
      topColor: 'mustard',
      bottom: 'skirt',
      bottomColor: 'plum',
      shoes: 'boots',
      shoesColor: 'charcoal',
      accessory: 'none',
      equipment: 'debug_rig',
    },
  },
  {
    id: 'demo-rafa',
    name: 'Rafa',
    role: 'designer',
    origin: 'demo',
    kind: 'agent',
    projectPath: '~/code/storefront/web',
    appearance: {
      gender: 'male',
      hairStyle: 'curly',
      hairColor: 'black',
      skin: 'brown',
      face: 'cheerful',
      top: 'tee',
      topColor: 'coral',
      bottom: 'joggers',
      bottomColor: 'charcoal',
      shoes: 'hightops',
      shoesColor: 'cream',
      accessory: 'beanie',
      equipment: 'tablet',
    },
  },
  {
    id: 'demo-lin',
    name: '林小雨',
    role: 'frontend_engineer',
    origin: 'demo',
    kind: 'agent',
    projectPath: '~/code/storefront/web',
    appearance: {
      gender: 'female',
      hairStyle: 'long',
      hairColor: 'black',
      skin: 'light',
      face: 'calm',
      top: 'shirt',
      topColor: 'sage',
      bottom: 'jeans',
      bottomColor: 'navy',
      shoes: 'sneakers',
      shoesColor: 'cream',
      accessory: 'none',
      equipment: 'monitor',
    },
  },
];

export interface DemoStep {
  at: number;
  agent: string;
  payload: DomainEventPayload;
}

const tool = (toolUseId: string, toolName: string, category: Extract<DomainEventPayload, { kind: 'tool.started' }>['category'], target: string): DomainEventPayload => ({
  kind: 'tool.started',
  toolUseId,
  toolName,
  category,
  target,
});
const done = (toolUseId: string, toolName: string): DomainEventPayload => ({ kind: 'tool.finished', toolUseId, toolName });

/** One loop of the demo story (~64 s). Timestamps are milliseconds from loop start. */
export const DEMO_SCRIPT: DemoStep[] = [
  { at: 0, agent: 'demo-ada', payload: { kind: 'session.started', cwd: '~/code/storefront' } },
  { at: 700, agent: 'demo-kenji', payload: { kind: 'session.started', cwd: '~/code/storefront/api' } },
  { at: 1400, agent: 'demo-mei', payload: { kind: 'session.started', cwd: '~/code/storefront' } },
  { at: 2100, agent: 'demo-rafa', payload: { kind: 'session.started', cwd: '~/code/storefront/web' } },
  { at: 2800, agent: 'demo-lin', payload: { kind: 'session.started', cwd: '~/code/storefront/web' } },

  // Ada plans and delegates exploration to a subagent.
  { at: 6000, agent: 'demo-ada', payload: { kind: 'prompt.submitted', preview: 'Plan the checkout refactor' } },
  { at: 7200, agent: 'demo-ada', payload: tool('a1', 'TodoWrite', 'plan', 'Checkout refactor plan') },
  { at: 10500, agent: 'demo-ada', payload: done('a1', 'TodoWrite') },
  { at: 10800, agent: 'demo-ada', payload: tool('a2', 'Agent', 'delegate', 'Explore the checkout module') },
  { at: 11200, agent: 'demo-ada', payload: { kind: 'subagent.started', subagentId: 'explore-1', agentType: 'Explore' } },
  { at: 14500, agent: 'demo-ada/explore-1', payload: tool('s1', 'Grep', 'search', 'checkout') },
  { at: 17500, agent: 'demo-ada/explore-1', payload: done('s1', 'Grep') },
  { at: 17800, agent: 'demo-ada/explore-1', payload: tool('s2', 'Read', 'read', 'src/checkout/cart.ts') },
  { at: 21500, agent: 'demo-ada/explore-1', payload: done('s2', 'Read') },
  { at: 22000, agent: 'demo-ada', payload: { kind: 'subagent.stopped', subagentId: 'explore-1' } },
  { at: 22200, agent: 'demo-ada', payload: done('a2', 'Agent') },

  // Kenji edits, a test fails (recoverable), fixes and completes.
  { at: 6800, agent: 'demo-kenji', payload: { kind: 'prompt.submitted', preview: 'Add idempotency keys to POST /orders' } },
  { at: 7800, agent: 'demo-kenji', payload: tool('k1', 'Read', 'read', 'api/src/orders.rs') },
  { at: 11000, agent: 'demo-kenji', payload: done('k1', 'Read') },
  { at: 11400, agent: 'demo-kenji', payload: tool('k2', 'Edit', 'write', 'api/src/orders.rs') },
  { at: 17000, agent: 'demo-kenji', payload: done('k2', 'Edit') },
  { at: 17400, agent: 'demo-kenji', payload: tool('k3', 'Bash', 'test', 'cargo test orders') },
  { at: 22000, agent: 'demo-kenji', payload: { kind: 'tool.failed', toolUseId: 'k3', toolName: 'Bash', error: 'test orders::duplicate_key ... FAILED' } },
  { at: 22600, agent: 'demo-kenji', payload: tool('k4', 'Edit', 'write', 'api/src/orders.rs') },
  { at: 27000, agent: 'demo-kenji', payload: done('k4', 'Edit') },
  { at: 27300, agent: 'demo-kenji', payload: tool('k5', 'Bash', 'test', 'cargo test orders') },
  { at: 31500, agent: 'demo-kenji', payload: done('k5', 'Bash') },
  { at: 32000, agent: 'demo-kenji', payload: { kind: 'turn.completed' } },

  // Mei runs the suite, asks for permission, then the run fails and she retries.
  { at: 8800, agent: 'demo-mei', payload: { kind: 'prompt.submitted', preview: 'Run the regression suite' } },
  { at: 9800, agent: 'demo-mei', payload: tool('m1', 'Bash', 'test', 'npm run test:e2e') },
  { at: 18000, agent: 'demo-mei', payload: { kind: 'permission.requested', requestId: 'demo-perm-1', toolName: 'Bash', target: 'rm -rf test-results/' } },
  { at: 25000, agent: 'demo-mei', payload: { kind: 'permission.resolved', requestId: 'demo-perm-1', decision: 'allow' } },
  { at: 30000, agent: 'demo-mei', payload: done('m1', 'Bash') },
  { at: 30400, agent: 'demo-mei', payload: { kind: 'run.failed', error: '2 regression tests failed: checkout.spec.ts' } },
  { at: 39000, agent: 'demo-mei', payload: { kind: 'prompt.submitted', preview: 'Investigate the checkout failures' } },
  { at: 40000, agent: 'demo-mei', payload: tool('m2', 'Read', 'read', 'e2e/checkout.spec.ts') },
  { at: 45000, agent: 'demo-mei', payload: done('m2', 'Read') },
  { at: 45400, agent: 'demo-mei', payload: { kind: 'turn.completed' } },

  // Rafa researches, writes tokens, then a handoff meeting with Ada.
  { at: 7600, agent: 'demo-rafa', payload: { kind: 'prompt.submitted', preview: 'Update design tokens for checkout' } },
  { at: 8600, agent: 'demo-rafa', payload: tool('r1', 'WebFetch', 'web', 'design-spec/checkout') },
  { at: 13000, agent: 'demo-rafa', payload: done('r1', 'WebFetch') },
  { at: 13400, agent: 'demo-rafa', payload: tool('r2', 'Write', 'write', 'web/src/styles/tokens.css') },
  { at: 20000, agent: 'demo-rafa', payload: done('r2', 'Write') },
  { at: 20400, agent: 'demo-rafa', payload: { kind: 'turn.completed' } },
  { at: 26000, agent: 'demo-ada', payload: { kind: 'collaboration.started', meetingId: 'demo-meet-1', participants: ['demo-ada', 'demo-rafa', 'demo-lin'], reason: 'handoff' } },
  { at: 38000, agent: 'demo-ada', payload: { kind: 'collaboration.ended', meetingId: 'demo-meet-1' } },

  // 林小雨 builds UI.
  { at: 9400, agent: 'demo-lin', payload: { kind: 'prompt.submitted', preview: '實作結帳頁面的新版元件' } },
  { at: 10400, agent: 'demo-lin', payload: tool('l1', 'Glob', 'search', 'web/src/checkout/**/*.tsx') },
  { at: 13000, agent: 'demo-lin', payload: done('l1', 'Glob') },
  { at: 13300, agent: 'demo-lin', payload: tool('l2', 'Edit', 'write', '/Users/demo/code/storefront/web/src/checkout/Summary.tsx') },
  { at: 24000, agent: 'demo-lin', payload: done('l2', 'Edit') },
  { at: 40000, agent: 'demo-lin', payload: tool('l3', 'Bash', 'test', 'npm run lint') },
  { at: 46000, agent: 'demo-lin', payload: done('l3', 'Bash') },
  { at: 46300, agent: 'demo-lin', payload: { kind: 'turn.completed' } },

  { at: 40000, agent: 'demo-ada', payload: { kind: 'prompt.submitted', preview: 'Review Kenji’s orders change' } },
  { at: 41000, agent: 'demo-ada', payload: tool('a3', 'Read', 'read', 'api/src/orders.rs') },
  { at: 47000, agent: 'demo-ada', payload: done('a3', 'Read') },
  { at: 47400, agent: 'demo-ada', payload: { kind: 'turn.completed' } },

  // Agent team: Ada (lead) posts tasks; teammates complete them (TaskCreated / TaskCompleted hooks).
  { at: 7000, agent: 'demo-ada', payload: { kind: 'task.created', taskId: 'demo-t1', subject: 'Idempotency keys for POST /orders', teamName: 'session-demo-ada' } },
  { at: 7300, agent: 'demo-ada', payload: { kind: 'task.created', taskId: 'demo-t2', subject: 'Checkout regression suite', teamName: 'session-demo-ada' } },
  { at: 7600, agent: 'demo-ada', payload: { kind: 'task.created', taskId: 'demo-t3', subject: 'Design tokens for checkout', teamName: 'session-demo-ada' } },
  { at: 7900, agent: 'demo-ada', payload: { kind: 'task.created', taskId: 'demo-t4', subject: '結帳頁面新版元件', teamName: 'session-demo-ada' } },
  { at: 32200, agent: 'demo-kenji', payload: { kind: 'task.completed', taskId: 'demo-t1', subject: 'Idempotency keys for POST /orders', teammateName: 'kenji', teamName: 'session-demo-ada' } },
  { at: 20600, agent: 'demo-rafa', payload: { kind: 'task.completed', taskId: 'demo-t3', subject: 'Design tokens for checkout', teammateName: 'rafa', teamName: 'session-demo-ada' } },
  { at: 20900, agent: 'demo-rafa', payload: { kind: 'teammate.idle', teammateName: 'rafa', teamName: 'session-demo-ada' } },
  { at: 46500, agent: 'demo-lin', payload: { kind: 'task.completed', taskId: 'demo-t4', subject: '結帳頁面新版元件', teammateName: 'lin', teamName: 'session-demo-ada' } },
  // Two agents in the same working tree edit one file: a real conflict risk.
  { at: 36000, agent: 'demo-rafa', payload: { kind: 'prompt.submitted', preview: 'Tweak the summary card spacing' } },
  { at: 36500, agent: 'demo-rafa', payload: tool('r3', 'Edit', 'write', '/Users/demo/code/storefront/web/src/checkout/Summary.tsx') },
  { at: 40500, agent: 'demo-rafa', payload: done('r3', 'Edit') },
  { at: 40800, agent: 'demo-rafa', payload: { kind: 'turn.completed' } },

  // Kenji leaves for a break and comes back.
  { at: 50000, agent: 'demo-kenji', payload: { kind: 'session.ended', reason: 'logout' } },
  { at: 58000, agent: 'demo-kenji', payload: { kind: 'session.started', cwd: '~/code/storefront/api' } },
];

export const DEMO_LOOP_MS = 64_000;

const REPO = '/Users/demo/code/storefront/.git';
/** Fixture git locations: Kenji and Mei work in their own worktrees. */
export const DEMO_LOCATIONS: Record<string, AgentLocation> = {
  'demo-ada': { cwd: '/Users/demo/code/storefront', git: { repo: REPO, toplevel: '/Users/demo/code/storefront', branch: 'main', isWorktree: false } },
  'demo-kenji': { cwd: '/Users/demo/code/storefront-idem/api', git: { repo: REPO, toplevel: '/Users/demo/code/storefront-idem', branch: 'feature/idempotency', isWorktree: true } },
  'demo-mei': { cwd: '/Users/demo/code/storefront-qa', git: { repo: REPO, toplevel: '/Users/demo/code/storefront-qa', branch: 'qa/regression', isWorktree: true } },
  'demo-rafa': { cwd: '/Users/demo/code/storefront/web', git: { repo: REPO, toplevel: '/Users/demo/code/storefront', branch: 'main', isWorktree: false } },
  'demo-lin': { cwd: '/Users/demo/code/storefront/web', git: { repo: REPO, toplevel: '/Users/demo/code/storefront', branch: 'main', isWorktree: false } },
};
