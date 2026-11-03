import type { GitInfo } from '@agentville/domain';

/**
 * Wire protocol between the UI and the built-in Rust hook receiver
 * (src-tauri/src/receiver.rs). Stream: NDJSON over GET /stream. Commands: JSON
 * POST /rpc. Both require the per-launch UI token.
 */

/** A Claude Code hook payload as received, stamped by the receiver. */
export interface RawHook {
  /** Unique per receiver run; stable across stream reconnects. */
  id: string;
  /** Monotonic per receiver run. */
  seq: number;
  receivedAt: number;
  body: Record<string, unknown>;
}

export interface BridgeStatus {
  version: string;
  port: number;
  hooks: { received: number; rejected: number; lastAt?: number | null };
}

export type StreamMessage =
  | { type: 'hello'; status: BridgeStatus; recent: RawHook[] }
  | { type: 'hook'; hook: RawHook }
  | { type: 'status'; status: BridgeStatus }
  | { type: 'ping'; at: number };

export interface ExternalSession {
  agentId: string;
  sessionId: string;
  cwd?: string;
  firstSeenAt: number;
}

export interface HooksStatus {
  settingsPath: string;
  installed: boolean;
  stale: boolean;
  events: string[];
}

export interface HooksPreview {
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

export type RpcRequest =
  | { method: 'status' }
  | { method: 'hooks.status' }
  | { method: 'hooks.preview'; params: { action: 'install' | 'uninstall' } }
  | { method: 'hooks.install' }
  | { method: 'hooks.uninstall' }
  | { method: 'git.info'; params: { cwd: string } }
  | { method: 'claude.status' };

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
          : never;
