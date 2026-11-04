import type { HookDialect, NormalizeContext, NormalizeResult } from '../hooks/normalize';

/**
 * One observed coding agent. The desktop app and the Rust receiver both keep a
 * registry keyed by `id` (see apps/desktop/src-tauri/src/providers.rs); adding
 * an agent means one entry on each side.
 */
export interface HookProvider {
  /** Matches the Rust provider id and the receiver route `/hooks/<id>`. */
  id: string;
  /** Product name, shown as-is (never translated). */
  label: string;
  /** Short badge on characters, e.g. "CC". */
  badge: string;
  /** Badge colour (any CSS colour); also used for the canvas name tag. */
  color: string;
  dialect: HookDialect;
  /** Agentville agent id for a session (and optional subagent). Must be stable across app runs. */
  agentIdFor: (sessionId: string, subagentId?: string) => string;
  /**
   * True when the agent runs new hooks only after the user trusts them in the
   * agent itself (Codex). Agentville can't do that step for the user.
   */
  needsTrust: boolean;
}

export type ProviderNormalize = (raw: unknown, ctx: Omit<NormalizeContext, 'agentIdFor'>) => NormalizeResult;
