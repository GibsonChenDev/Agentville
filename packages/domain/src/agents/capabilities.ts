import type { AgentOrigin } from './types';

export type AgentCapability =
  | 'observe'
  | 'send_prompt'
  | 'decide_permission'
  | 'cancel'
  | 'resume'
  | 'customize';

/**
 * What Agentville can truthfully do for an agent of each origin. External
 * sessions are observed through hooks only; Demo agents are fixtures.
 */
const MATRIX: Record<AgentOrigin, ReadonlySet<AgentCapability>> = {
  managed: new Set(['observe', 'send_prompt', 'decide_permission', 'cancel', 'resume', 'customize']),
  external: new Set(['observe', 'customize']),
  demo: new Set(['observe', 'customize']),
};

export function can(origin: AgentOrigin, capability: AgentCapability): boolean {
  return MATRIX[origin].has(capability);
}
