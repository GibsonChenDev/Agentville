import type { AgentRuntime, AgentStatus } from '@agentville/domain';
import type { BadgeInfo } from '../game/characters/CharacterActor';

/** Single source of truth for how a logical status is presented (tone + i18n key). */
export const STATUS_TONE: Record<AgentStatus, BadgeInfo['tone']> = {
  disconnected: 'muted',
  idle: 'neutral',
  starting: 'neutral',
  planning: 'busy',
  thinking: 'busy',
  reading: 'busy',
  writing: 'busy',
  executing_tool: 'busy',
  waiting_for_permission: 'attention',
  collaborating: 'busy',
  completed: 'success',
  failed: 'danger',
  cancelled: 'muted',
  unknown: 'muted',
};

export const TONE_CLASS: Record<BadgeInfo['tone'], string> = {
  neutral: 'bg-faint',
  busy: 'bg-teal',
  attention: 'bg-amber',
  success: 'bg-leaf',
  danger: 'bg-coral',
  muted: 'bg-panel-3',
};

export function currentCategory(r: AgentRuntime | undefined) {
  return r?.openTools[r.openTools.length - 1]?.category;
}
