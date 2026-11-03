import { appearanceFromSeed, type AgentRecord } from '@agentville/domain';
import type { WorldAgent } from '../game/engine/OfficeWorld';
import { i18n } from '../i18n';
import { onlinePeers, type TeamState } from './teamStore';

/**
 * Most teammates' agents drawn at once. A full office (50 people × 32 agents)
 * would be 1,600 characters; beyond this the team panel still shows the counts.
 */
export const MAX_PEER_AGENTS = 40;

/**
 * Teammates' agents: anonymous characters at desks. Only their number is known.
 * Taken round-robin, so with many teammates everyone still has some agents shown.
 */
export function peerAgents(team: TeamState): WorldAgent[] {
  const t = i18n.t.bind(i18n);
  const out: WorldAgent[] = [];
  const members = onlinePeers(team);
  const most = Math.max(0, ...members.map((m) => m.agents));
  for (let i = 0; i < most && out.length < MAX_PEER_AGENTS; i++) {
    for (const m of members) {
      if (i >= m.agents || out.length >= MAX_PEER_AGENTS) continue;
      const id = `peer:${m.id}:${i}`;
      const record: AgentRecord = { id, name: t('team:agentOf', { name: m.name }), role: 'generalist', origin: 'external', kind: 'agent', appearance: appearanceFromSeed(id), createdAt: i };
      // Alternate screens so a row of teammates' agents doesn't look cloned; both read as "working".
      out.push({ record, status: i % 2 ? 'executing_tool' : 'writing', badge: { name: record.name, status: t('team:working'), tone: 'busy' } });
    }
  }
  return out;
}
