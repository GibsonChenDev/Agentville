import {
  ACCESSORIES,
  BOTTOMS,
  EQUIPMENT,
  FACES,
  HAIR_COLORS,
  HAIR_STYLES,
  OUTFIT_COLORS,
  SHOES,
  SKIN_TONES,
  TOPS,
  type CharacterAppearance,
} from './appearance';
import { AGENT_ROLES, type AgentRecord, type AgentRole } from './types';

/**
 * A user's customization of a character. Observed sessions change id every time
 * Claude Code starts, so profiles attach to a stable identity instead: the
 * project folder for monitored sessions, the agent type for subagents.
 */
export interface AgentProfile {
  key: string;
  /** User-authored display name; never translated. */
  name?: string;
  role?: AgentRole;
  appearance?: CharacterAppearance;
  /** Preferred workstation id in the current office theme. */
  workstationId?: string;
  updatedAt: number;
}

export function profileKeyFor(agent: Pick<AgentRecord, 'id' | 'origin' | 'kind' | 'projectPath' | 'agentType'>): string {
  if (agent.kind === 'subagent') return `subagent:${agent.agentType ?? 'general-purpose'}`;
  if (agent.origin === 'demo') return `demo:${agent.id}`;
  if (agent.projectPath) return `project:${agent.projectPath}`;
  return `agent:${agent.id}`;
}

const OPTIONS: { [K in keyof CharacterAppearance]: readonly CharacterAppearance[K][] } = {
  hairStyle: HAIR_STYLES,
  hairColor: HAIR_COLORS,
  skin: SKIN_TONES,
  face: FACES,
  top: TOPS,
  topColor: OUTFIT_COLORS,
  bottom: BOTTOMS,
  bottomColor: OUTFIT_COLORS,
  shoes: SHOES,
  shoesColor: OUTFIT_COLORS,
  accessory: ACCESSORIES,
  equipment: EQUIPMENT,
};

export const APPEARANCE_OPTIONS = OPTIONS;

/** Keeps only known option ids; anything else falls back to `fallback`'s value. */
export function sanitizeAppearance(raw: unknown, fallback: CharacterAppearance): CharacterAppearance {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...fallback };
  for (const key of Object.keys(OPTIONS) as (keyof CharacterAppearance)[]) {
    const value = r[key];
    if (typeof value === 'string' && (OPTIONS[key] as readonly string[]).includes(value)) (out as Record<string, string>)[key] = value;
  }
  return out;
}

export function sanitizeProfile(key: string, raw: unknown, fallbackAppearance: CharacterAppearance, updatedAt: number): AgentProfile {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const profile: AgentProfile = { key, updatedAt };
  if (typeof r.name === 'string' && r.name.trim()) profile.name = r.name.trim().slice(0, 40);
  if (typeof r.role === 'string' && (AGENT_ROLES as readonly string[]).includes(r.role)) profile.role = r.role as AgentRole;
  if (r.appearance) profile.appearance = sanitizeAppearance(r.appearance, fallbackAppearance);
  if (typeof r.workstationId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(r.workstationId)) profile.workstationId = r.workstationId;
  return profile;
}

/** The record as shown in the office: base record with the profile's overrides. */
export function applyProfile(base: AgentRecord, profile: AgentProfile | undefined): AgentRecord {
  if (!profile) return base;
  return {
    ...base,
    name: profile.name ?? base.name,
    role: profile.role ?? base.role,
    appearance: profile.appearance ?? base.appearance,
    workstationId: profile.workstationId ?? base.workstationId,
  };
}
