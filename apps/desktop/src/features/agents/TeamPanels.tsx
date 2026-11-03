import type { AgentRecord } from '@agentville/domain';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { inMode, useApp } from '../../state/store';

const RECENT_CONFLICT_MS = 30 * 60_000;

/** Repository a character works in: shared by all worktrees of one repo. */
export function projectKey(a: AgentRecord) {
  return a.location?.git?.repo ?? a.projectPath ?? '';
}

export function projectLabel(key: string) {
  const parts = key.split(/[\\/]/).filter(Boolean);
  const last = parts.at(-1) ?? '';
  return last === '.git' ? (parts.at(-2) ?? last) : last || '—';
}

/** Branch / worktree / team chips shown next to a character's name. */
export function AgentChips({ agent }: { agent: AgentRecord }) {
  const { t } = useTranslation('agents');
  const git = agent.location?.git;
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      {git && (
        <span
          className={`min-w-0 truncate rounded px-1 font-mono text-[10px] ring-1 ${git.isWorktree ? 'text-violet ring-violet/40' : 'text-faint ring-line'}`}
          title={git.isWorktree ? t('team.worktreeHint', { path: git.toplevel }) : git.toplevel}
        >
          ⎇ {git.branch}
        </span>
      )}
      {agent.team && <span className="shrink-0 rounded bg-amber/10 px-1 text-[10px] whitespace-nowrap text-amber ring-1 ring-amber/30">{agent.team.role === 'lead' ? t('team.lead') : t('team.teammate')}</span>}
    </span>
  );
}

/** Agent-team tasks observed through TaskCreated / TaskCompleted hooks. Read-only. */
export function ObservedTasks() {
  const { t } = useTranslation('agents');
  const mode = useApp((s) => s.mode);
  const tasks = useApp((s) => s.collab.tasks);
  const agents = useApp((s) => s.agents);
  const list = useMemo(() => {
    const all = Object.values(tasks).filter((task) => inMode(mode, task.teamKey === 'session-demo-ada' ? 'demo' : 'external'));
    return [...all.filter((x) => x.status === 'open').sort((a, b) => a.createdAt - b.createdAt), ...all.filter((x) => x.status === 'completed').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))].slice(0, 12);
  }, [tasks, mode]);
  if (!list.length) return <p className="px-3 text-[12px] leading-relaxed text-faint">{t('team.noTasks')}</p>;
  return (
    <ul className="space-y-0.5 px-2">
      {list.map((task) => {
        const owner = task.completedByAgentId ? agents[task.completedByAgentId] : undefined;
        const who = task.completedBy ?? owner?.name ?? task.createdBy;
        return (
          <li key={task.key}>
            <button
              onClick={() => owner && useApp.getState().select(owner.id)}
              className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-panel-2"
              title={task.description ?? task.subject}
            >
              <span className={`mt-[3px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm text-[9px] ${task.status === 'completed' ? 'bg-leaf text-ink' : 'ring-1 ring-line-strong'}`} aria-hidden>
                {task.status === 'completed' ? '✓' : ''}
              </span>
              <span className="min-w-0">
                <span className={`block truncate text-[12px] ${task.status === 'completed' ? 'text-muted line-through decoration-faint' : ''}`}>{task.subject}</span>
                {who && <span className="block truncate text-[10.5px] text-faint">{task.status === 'completed' ? t('team.doneBy', { name: who }) : t('team.postedBy', { name: who })}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Recent same-file edits by different agents in the same working tree. */
export function ConflictWarnings({ agentId }: { agentId?: string }) {
  const { t } = useTranslation('agents');
  const conflicts = useApp((s) => s.collab.conflicts);
  const agents = useApp((s) => s.agents);
  const mode = useApp((s) => s.mode);
  const now = Date.now();
  const list = conflicts.filter(
    (c) => now - c.at < RECENT_CONFLICT_MS && (!agentId || c.agentIds.includes(agentId)) && c.agentIds.every((id) => agents[id] && inMode(mode, agents[id]!.origin)),
  );
  if (!list.length) return null;
  return (
    <div className="mx-2 mb-3 rounded-lg bg-coral/10 p-2.5 ring-1 ring-coral/35" role="alert">
      <p className="text-[12px] font-semibold text-coral">⚠ {t('team.conflictTitle')}</p>
      <ul className="mt-1 space-y-1">
        {list.slice(-4).map((c) => (
          <li key={`${c.path}:${c.agentIds.join()}`} className="text-[11.5px] leading-snug">
            <span className="selectable block truncate font-mono text-[11px] text-fg" title={c.path}>
              {c.path.split(/[\\/]/).slice(-2).join('/')}
            </span>
            <span className="text-muted">{t('team.conflictBody', { a: agents[c.agentIds[0]]?.name ?? '?', b: agents[c.agentIds[1]]?.name ?? '?' })}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[10.5px] leading-snug text-faint">{t('team.conflictHint')}</p>
    </div>
  );
}

/** Several active sessions writing in one working tree (no worktrees). */
export function sharedTreeCount(members: AgentRecord[], runtime: Record<string, { status: string } | undefined>) {
  const byTree = new Map<string, number>();
  for (const a of members) {
    if (a.kind !== 'agent' || runtime[a.id]?.status === 'disconnected' || !a.location?.git) continue;
    byTree.set(a.location.git.toplevel, (byTree.get(a.location.git.toplevel) ?? 0) + 1);
  }
  return Math.max(0, ...byTree.values());
}
