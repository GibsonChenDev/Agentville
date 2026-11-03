import { can, type AgentRecord, type DomainEvent } from '@agentville/domain';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { eventDetail, formatRelative, formatTime } from '../../presentation/format';
import { useApp } from '../../state/store';
import { Portrait } from './Portrait';
import { StatusDot } from './StatusDot';
import { ConflictWarnings } from './TeamPanels';

const ORIGIN_STYLE = {
  managed: 'bg-teal/15 text-teal ring-teal/30',
  external: 'bg-violet/15 text-violet ring-violet/30',
  demo: 'bg-amber/15 text-amber ring-amber/30',
} as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2 py-1.5 text-[12.5px]">
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

export function Inspector() {
  const { t, i18n } = useTranslation('agents');
  const id = useApp((s) => s.selectedAgentId);
  const agent = useApp((s) => (id ? s.agents[id] : undefined));
  const runtime = useApp((s) => (id ? s.runtime[id] : undefined));
  const parent = useApp((s) => (agent?.parentId ? s.agents[agent.parentId] : undefined));
  const events = useApp((s) => s.events);
  const width = useApp((s) => s.prefs.inspectorWidth);
  const followId = useApp((s) => s.followAgentId);

  const recent = useMemo(() => (id ? events.filter((e) => e.agentId === id).slice(-8).reverse() : []), [events, id]);
  const lastPrompt = useMemo(() => {
    if (!id) return undefined;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.agentId === id && e.payload.kind === 'prompt.submitted') return e.payload.preview;
    }
    return undefined;
  }, [events, id]);

  if (!agent || !runtime) {
    return (
      <aside className="flex h-full shrink-0 flex-col items-center justify-center border-l border-line bg-panel px-8 text-center" style={{ width }}>
        <div className="mb-3 grid h-14 w-14 place-items-center rounded-xl bg-panel-2 text-2xl text-faint" aria-hidden>
          ⌖
        </div>
        <p className="text-[13px] font-medium">{t('inspector.empty')}</p>
        <p className="mt-1 text-[12px] text-muted">{t('inspector.emptyHint')}</p>
      </aside>
    );
  }

  const tool = runtime.openTools[runtime.openTools.length - 1];
  const locale = i18n.language;
  const controllable = can(agent.origin, 'send_prompt');
  const unavailable = agent.origin === 'demo' ? t('inspector.unavailableDemo') : t('inspector.unavailableExternal');
  const following = followId === agent.id;

  return (
    <aside className="flex h-full shrink-0 flex-col border-l border-line bg-panel" style={{ width }} aria-label={agent.name}>
      <header className="border-b border-line p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-panel-2 p-1 ring-1 ring-line">
            <Portrait appearance={agent.appearance} size={56} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="selectable truncate text-[16px] font-semibold">{agent.name}</h2>
            <p className="truncate text-[12px] text-muted">
              {agent.kind === 'subagent' && parent ? t('kind.subagentOf', { name: parent.name }) : t(`role.${agent.role}`)}
              {agent.agentType && <span className="ml-1 font-mono text-[11px] text-faint">({agent.agentType})</span>}
            </p>
            <span className={`mt-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ${ORIGIN_STYLE[agent.origin]}`} title={t(`originHint.${agent.origin}`)}>
              {t(`origin.${agent.origin}`)}
            </span>
          </div>
          <button
            onClick={() => useApp.getState().follow(following ? undefined : agent.id)}
            aria-pressed={following}
            className={`rounded-md px-2 py-1 text-[11.5px] ring-1 ring-line ${following ? 'bg-amber/15 text-amber' : 'text-muted hover:bg-panel-2 hover:text-fg'}`}
            title="F"
          >
            {following ? t('common:actions.unfollow') : t('common:actions.follow')}
          </button>
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-faint">{t(`originHint.${agent.origin}`)}</p>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto">
        {runtime.pendingPermission && (
          <section className="m-3 rounded-lg bg-amber/10 p-3 ring-1 ring-amber/40" role="alert">
            <h3 className="text-[12.5px] font-semibold text-amber">{t('inspector.permission')}</h3>
            <p className="mt-1 text-[12.5px]">{t('inspector.permissionBody', { tool: runtime.pendingPermission.toolName })}</p>
            {runtime.pendingPermission.target && (
              <code className="selectable mt-2 block rounded bg-ink/60 px-2 py-1.5 font-mono text-[11.5px] break-all text-fg">{runtime.pendingPermission.target}</code>
            )}
            <div className="mt-2.5 flex gap-2">
              <button disabled={!can(agent.origin, 'decide_permission')} className="rounded-md bg-amber px-3 py-1 text-[12px] font-medium text-ink disabled:opacity-40">
                {t('inspector.approve')}
              </button>
              <button disabled={!can(agent.origin, 'decide_permission')} className="rounded-md px-3 py-1 text-[12px] ring-1 ring-line-strong disabled:opacity-40">
                {t('inspector.deny')}
              </button>
            </div>
            {!can(agent.origin, 'decide_permission') && <p className="mt-2 text-[11.5px] text-muted">{unavailable}</p>}
          </section>
        )}

        <div className="pt-3">
          <ConflictWarnings agentId={agent.id} />
        </div>
        <dl className="px-4 py-2">
          <Field label={t('inspector.status')}>
            <span className="flex items-center gap-2">
              <StatusDot status={runtime.status} />
              {t(`status.${runtime.status}`)}
            </span>
            {runtime.status === 'thinking' && <span className="mt-0.5 block text-[11px] text-faint">{t('statusHint.thinking')}</span>}
          </Field>
          <Field label={t('inspector.currentTool')}>
            {tool ? (
              <span className="block">
                <span className="text-muted">{t(`category.${tool.category}`)}</span>
                <span className="selectable mt-0.5 block font-mono text-[11.5px] break-all">
                  {tool.toolName}
                  {tool.target && <span className="text-muted"> · {tool.target}</span>}
                </span>
              </span>
            ) : (
              <span className="text-faint">{t('inspector.noTool')}</span>
            )}
          </Field>
          <Field label={t('inspector.task')}>{lastPrompt ? <span className="selectable">{lastPrompt}</span> : <span className="text-faint">{t('inspector.noTask')}</span>}</Field>
          <Field label={t('inspector.project')}>
            {agent.projectPath ? <span className="selectable font-mono text-[11.5px] break-all">{agent.projectPath}</span> : <span className="text-faint">{t('inspector.noProject')}</span>}
          </Field>
          {agent.location?.git && (
            <Field label={t('inspector.branch')}>
              <span className="selectable font-mono text-[11.5px]">⎇ {agent.location.git.branch}</span>
              <span className="mt-0.5 block text-[11px] text-faint">
                {agent.location.git.isWorktree ? t('team.worktreeHint', { path: agent.location.git.toplevel }) : t('team.mainCheckout')}
              </span>
            </Field>
          )}
          {agent.team && (
            <Field label={t('inspector.team')}>
              {agent.team.role === 'lead' ? t('team.leadOf', { team: agent.team.key }) : t('team.memberOf', { name: agent.team.teammateName ?? agent.name, team: agent.team.key })}
            </Field>
          )}
          <Field label={t('inspector.session')}>
            {runtime.sessionId ? <span className="selectable font-mono text-[11.5px] break-all">{runtime.sessionId}</span> : <span className="text-faint">{t('inspector.noSession')}</span>}
          </Field>
          {runtime.lastEventAt && (
            <Field label={t('inspector.lastEvent')}>
              <span className="text-muted">{formatRelative(runtime.lastEventAt, Date.now(), locale, t('common:time.justNow'))}</span>
            </Field>
          )}
          {(runtime.lastError || runtime.lastToolFailure) && (
            <Field label={t('inspector.lastError')}>
              <span className="selectable block text-coral">{runtime.lastError ?? t('inspector.lastToolFailure', { tool: runtime.lastToolFailure!.toolName })}</span>
            </Field>
          )}
        </dl>

        <section className="border-t border-line px-4 py-3">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">{t('inspector.actions')}</h3>
          <div className="grid grid-cols-2 gap-2">
            <ActionButton disabled={!controllable} label={t('inspector.sendPrompt')} />
            <ActionButton disabled={!can(agent.origin, 'cancel')} label={t('inspector.cancelRun')} />
            <button
              onClick={() => useApp.getState().openCustomizer(agent.id)}
              className="col-span-2 rounded-md bg-amber/15 px-2.5 py-1.5 text-[12px] font-medium text-amber ring-1 ring-amber/40 hover:bg-amber/25"
            >
              {t('inspector.customize')}
            </button>
          </div>
          {!controllable && <p className="mt-2 text-[11.5px] leading-relaxed text-muted">{unavailable}</p>}
        </section>

        <section className="border-t border-line px-4 py-3">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">{t('inspector.recent')}</h3>
          {recent.length === 0 ? <p className="text-[12px] text-faint">{t('inspector.noRecent')}</p> : <EventList events={recent} locale={locale} />}
        </section>
      </div>
    </aside>
  );
}

function ActionButton({ label, disabled, className = '' }: { label: string; disabled?: boolean; className?: string }) {
  return (
    <button disabled={disabled} className={`rounded-md bg-panel-2 px-2.5 py-1.5 text-[12px] ring-1 ring-line transition-colors hover:bg-panel-3 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>
      {label}
    </button>
  );
}

function EventList({ events, locale }: { events: DomainEvent[]; locale: string }) {
  const { t } = useTranslation();
  return (
    <ol className="space-y-1.5">
      {events.map((e) => (
        <li key={e.id} className="grid grid-cols-[56px_1fr] gap-2 text-[11.5px]">
          <time className="font-mono text-faint tabular-nums">{formatTime(e.at, locale)}</time>
          <span className="min-w-0">
            <span className="text-fg">{t(`eventKind.${e.payload.kind}`)}</span>
            {eventDetail(e, t) && <span className="selectable block truncate font-mono text-[11px] text-muted">{eventDetail(e, t)}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export type { AgentRecord };
