import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { eventDetail, eventGroup, formatTime, type EventGroup } from '../../presentation/format';
import { inMode, useApp } from '../../state/store';

const GROUPS: EventGroup[] = ['lifecycle', 'tools', 'permissions', 'subagents', 'messages'];
const GROUP_COLOR: Record<EventGroup, string> = {
  lifecycle: 'text-muted',
  tools: 'text-teal',
  permissions: 'text-amber',
  subagents: 'text-violet',
  messages: 'text-fg',
};
const MAX_ROWS = 400;

export function ActivityConsole() {
  const { t, i18n } = useTranslation();
  const open = useApp((s) => s.consoleOpen);
  const events = useApp((s) => s.events);
  const agents = useApp((s) => s.agents);
  const mode = useApp((s) => s.mode);
  const [agentFilter, setAgentFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState<EventGroup | ''>('');
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const modeEvents = useMemo(() => events.filter((e) => inMode(mode, e.source === 'demo' ? 'demo' : 'external')), [events, mode]);
  const rows = useMemo(() => {
    const filtered = modeEvents.filter((e) => (!agentFilter || e.agentId === agentFilter) && (!groupFilter || eventGroup(e) === groupFilter));
    return filtered.slice(-MAX_ROWS);
  }, [modeEvents, agentFilter, groupFilter]);

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows, open]);

  return (
    <section className={`flex shrink-0 flex-col border-t border-line bg-panel transition-[height] duration-200 ${open ? 'h-[196px]' : 'h-9'}`} aria-label={t('console.title')}>
      <header className="flex h-9 shrink-0 items-center gap-2 px-3">
        <button
          onClick={() => useApp.getState().toggleConsole()}
          aria-expanded={open}
          aria-label={open ? t('console.collapse') : t('console.expand')}
          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] font-semibold hover:bg-panel-2"
          title="`"
        >
          <span className={`inline-block text-[9px] text-muted transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          {t('console.title')}
        </button>
        <span className="text-[11px] text-faint">{t('console.eventCount', { count: modeEvents.length })}</span>
        {open && (
          <div className="ml-auto flex items-center gap-2">
            <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="rounded bg-panel-2 px-2 py-0.5 text-[11.5px] ring-1 ring-line" aria-label={t('console.filterAll')}>
              <option value="">{t('console.filterAll')}</option>
              {Object.values(agents)
                .filter((a) => inMode(mode, a.origin))
                .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value as EventGroup | '')} className="rounded bg-panel-2 px-2 py-0.5 text-[11.5px] ring-1 ring-line" aria-label={t('console.filterTypeAll')}>
              <option value="">{t('console.filterTypeAll')}</option>
              {GROUPS.map((g) => (
                <option key={g} value={g}>
                  {t(`eventGroup.${g}`)}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>
      {open && (
        <div
          ref={list}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="scroll-thin selectable flex-1 overflow-y-auto px-3 pb-2 font-mono text-[11.5px] leading-[19px]"
          role="log"
          aria-live="polite"
        >
          {rows.length === 0 && <p className="py-4 text-center font-sans text-faint">{t('console.empty')}</p>}
          {rows.map((e) => {
            const group = eventGroup(e);
            const detail = eventDetail(e, t);
            const agent = agents[e.agentId];
            return (
              <div key={e.id} className="grid grid-cols-[64px_44px_minmax(80px,140px)_minmax(120px,190px)_1fr] gap-2 whitespace-nowrap hover:bg-panel-2/60">
                <time className="text-faint tabular-nums">{formatTime(e.at, i18n.language)}</time>
                <span className={`font-sans text-[10.5px] ${e.source === 'demo' ? 'text-amber/80' : 'text-faint'}`}>{t(`source.${e.source}`)}</span>
                <span className="truncate font-sans text-fg">{agent?.name ?? e.agentId}</span>
                <span className={`truncate font-sans ${GROUP_COLOR[group]} ${e.payload.kind === 'tool.failed' || e.payload.kind === 'run.failed' ? '!text-coral' : ''}`}>{t(`eventKind.${e.payload.kind}`)}</span>
                <span className="truncate text-muted">{detail}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
