import type { GitInfo } from '@agentville/domain';

/**
 * Wire protocol between the UI and the built-in Rust hook receiver
 * (src-tauri/src/receiver.rs). Stream: NDJSON over GET /stream. Commands: JSON
 * POST /rpc. Both require the per-launch UI token.
 */

/** A hook payload as received, stamped by the receiver. */
export interface RawHook {
  /** Unique per receiver run; stable across stream reconnects. */
  id: string;
  /** Which agent sent it (`/hooks/<provider>`); absent from older receivers, meaning Claude Code. */
  provider?: string;
  /** Monotonic per receiver run. */
  seq: number;
  receivedAt: number;
  body: Record<string, unknown>;
}

export interface BridgeStatus {
  version: string;
  port: number;
  hooks: {
    received: number;
    rejected: number;
    lastAt?: number | null;
    /** Accepted hooks per provider id in this receiver run. */
    providers?: Record<string, { received: number; lastAt: number }>;
  };
}

/** When this receiver run last accepted a hook from `provider` (older receivers only report a total, which is Claude Code's). */
export function lastHookAt(status: BridgeStatus | undefined, provider: string): number | undefined {
  const hooks = status?.hooks;
  if (!hooks) return undefined;
  return (hooks.providers ? hooks.providers[provider]?.lastAt : provider === 'claude' ? hooks.lastAt : undefined) ?? undefined;
}

export type StreamMessage =
  | { type: 'hello'; status: BridgeStatus; recent: RawHook[] }
  | { type: 'hook'; hook: RawHook }
  | { type: 'status'; status: BridgeStatus }
  | { type: 'ping'; at: number };

export interface ExternalSession {
  agentId: string;
  sessionId: string;
  provider: string;
  cwd?: string;
  firstSeenAt: number;
}

export interface HooksStatus {
  provider: string;
  settingsPath: string;
  installed: boolean;
  stale: boolean;
  events: string[];
}

export interface HooksPreview {
  provider: string;
  settingsPath: string;
  before: string;
  after: string;
  changed: boolean;
}

export interface ClaudeStatus {
  path: string | null;
  version: string | null;
  installed: boolean;
  /** From `claude auth status`; null when it couldn't be determined. */
  loggedIn: boolean | null;
}

/** Whether an agent is installed. For Codex, the CLI is optional (the desktop app and IDE extension have none). */
export interface AgentDetection {
  provider: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  /** Codex: `$CODEX_HOME` or `~/.codex`, when it exists. */
  home?: string | null;
}

export type RpcRequest =
  | { method: 'status' }
  | { method: 'hooks.status'; params: { provider: string } }
  | { method: 'hooks.preview'; params: { provider: string; action: 'install' | 'uninstall' } }
  | { method: 'hooks.install'; params: { provider: string } }
  | { method: 'hooks.uninstall'; params: { provider: string } }
  | { method: 'git.info'; params: { cwd: string } }
  | { method: 'claude.status' }
  | { method: 'agent.detect'; params: { provider: string } };

export type RpcResult<M extends RpcRequest['method']> = M extends 'hooks.status' | 'hooks.install' | 'hooks.uninstall'
  ? HooksStatus & { backup?: string | null }
  : M extends 'hooks.preview'
    ? HooksPreview
    : M extends 'status'
      ? BridgeStatus
      : M extends 'git.info'
        ? GitInfo | null
        : M extends 'claude.status'
          ? ClaudeStatus
          : M extends 'agent.detect'
            ? AgentDetection
            : never;
