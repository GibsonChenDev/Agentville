import { EARN } from '@agentville/team-protocol';
import { worldApi } from '../features/office/worldApi';
import { useApp } from '../state/store';
import { useAccount } from './accountStore';

/**
 * Pays you for your agents' work: every turn a live agent completes (Claude
 * Code's Stop hook) earns coins, plus a little for each tool it used. The
 * server applies the real limits; this only reports what happened, live.
 */
let started = false;

export function startEarning() {
  if (started) return; // once per app, even if the app shell mounts twice
  started = true;
  const since = Date.now();
  const credited = new Set<string>();
  const toolsByAgent = new Map<string, number>();
  let turns = 0;
  let tools = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    timer = undefined;
    if (!turns) return;
    const batch = { turns: Math.min(turns, 50), tools: Math.min(tools, 5000) };
    turns -= batch.turns;
    tools = Math.max(0, tools - batch.tools);
    try {
      await useAccount.getState().earn(batch.turns, batch.tools);
    } catch {
      // Offline: keep them for the next try.
      turns += batch.turns;
      tools += batch.tools;
      timer = setTimeout(() => void flush(), 30_000);
    }
  };

  useApp.subscribe((s, prev) => {
    if (s.events === prev.events || !s.events.length) return;
    const fresh = s.events.slice(-Math.max(1, s.events.length - prev.events.length));
    for (const e of fresh) {
      // Only live hook events that just happened — not history or replays after a reconnect.
      if (e.source !== 'hook' || e.receivedAt < since || Date.now() - e.receivedAt > 60_000) continue;
      if (s.agents[e.agentId]?.origin === 'demo') continue;
      if (e.payload.kind === 'tool.started') toolsByAgent.set(e.agentId, (toolsByAgent.get(e.agentId) ?? 0) + 1);
      if (e.payload.kind !== 'turn.completed' || credited.has(e.id)) continue;
      credited.add(e.id);
      if (credited.size > 2000) credited.delete(credited.values().next().value!);
      const used = toolsByAgent.get(e.agentId) ?? 0;
      toolsByAgent.delete(e.agentId);
      turns += 1;
      tools += used;
      const account = useAccount.getState().account;
      const today = account?.earn.day === new Date().toISOString().slice(0, 10) ? account.earn.today : 0;
      if (account && today < EARN.dailyCap) worldApi.current?.coinPop(e.agentId, EARN.perTurn + Math.min(used, EARN.maxToolBonus) * EARN.perTool);
      if (!timer) timer = setTimeout(() => void flush(), 1500);
    }
  });
}
