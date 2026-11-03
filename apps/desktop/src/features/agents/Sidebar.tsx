import { OFFICE_THEMES, type AgentRecord, type OfficeTheme } from '@agentville/domain';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { THEMES } from '../../game/assets/themes';
import { DEFAULT_SCENES } from '../../game/scenes/layouts';
import { drawRoom } from '../../game/scenes/room';
import { inMode, useApp } from '../../state/store';
import { useEditor } from '../office/editorStore';
import { useGuide } from '../guide/guideStore';
import { isMac } from '../../integration/platform';
import { Portrait } from './Portrait';
import { TeamPanel } from '../team/TeamPanel';
import { chooseOfficeTheme, useOfficeTheme } from '../../world/officeTheme';
import { StatusDot } from './StatusDot';
import { AgentChips, ConflictWarnings, ObservedTasks, projectKey, projectLabel, sharedTreeCount } from './TeamPanels';

const thumbCache = new Map<OfficeTheme, string>();
function themeThumb(theme: OfficeTheme) {
  let url = thumbCache.get(theme);
  if (!url) {
    url = drawRoom(THEMES[theme], DEFAULT_SCENES[theme]).canvas.toDataURL();
    thumbCache.set(theme, url);
  }
  return url;
}

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between px-3">
      <h2 className="text-[11px] font-semibold tracking-wide text-faint uppercase">{children}</h2>
      {aside && <span className="text-[11px] text-faint">{aside}</span>}
    </div>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const agents = useApp((s) => s.agents);
  const runtime = useApp((s) => s.runtime);
  const selected = useApp((s) => s.selectedAgentId);
  const theme = useOfficeTheme();
  const width = useApp((s) => s.prefs.sidebarWidth);
  const mode = useApp((s) => s.mode);
  const editing = useEditor((s) => s.active);
  const [showDeparted, setShowDeparted] = useState(false);
  const { select, toggleSettings } = useApp.getState();

  const groups = useMemo(() => {
    const list = Object.values(agents)
      .filter((a) => inMode(mode, a.origin))
      .sort((a, b) => a.createdAt - b.createdAt);
    const top = list.filter((a) => a.kind === 'agent');
    const children = (id: string) => list.filter((a) => a.parentId === id && runtime[a.id]?.status !== 'disconnected');
    const gone = (a: AgentRecord) => runtime[a.id]?.status === 'disconnected';
    const departed = top.filter(gone).length;
    const visibleTop = showDeparted ? top : top.filter((a) => !gone(a));
    const byProject = new Map<string, AgentRecord[]>();
    for (const a of visibleTop) byProject.set(projectKey(a), [...(byProject.get(projectKey(a)) ?? []), a, ...children(a.id)]);
    return { departed, list: [...byProject.entries()].map(([key, members]) => ({ key, members })) };
  }, [agents, runtime, mode, showDeparted]);
  const rosterCount = groups.list.reduce((n, g) => n + g.members.length, 0);

  return (
    <aside className="flex h-full shrink-0 flex-col border-r border-line bg-panel" style={{ width }} aria-label={t('sidebar.team')}>
      <div className="titlebar-pad flex items-center gap-2.5 px-4 pt-4 pb-3" data-tauri-drag-region>
        <img src={themeLogo()} width={28} height={28} alt="" className="pixelated" />
        <div className="min-w-0">
          <div className="font-pixel text-[17px] leading-none tracking-wide text-fg">{t('appName')}</div>
          <div className="mt-1 truncate text-[11px] text-muted">{t('tagline')}</div>
        </div>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto pb-3">
        <SectionTitle>{t('team:sectionTitle')}</SectionTitle>
        <TeamPanel />

        <SectionTitle>{t('sidebar.office')}</SectionTitle>
        <div className="mb-4 grid gap-1.5 px-2" role="radiogroup" aria-label={t('sidebar.office')}>
          {OFFICE_THEMES.map((id) => (
            <button
              key={id}
              role="radio"
              aria-checked={theme === id}
              disabled={editing && theme !== id}
              onClick={() => chooseOfficeTheme(id)}
              className={`group flex items-center gap-2.5 rounded-md p-1.5 text-left transition-colors ${theme === id ? 'bg-panel-3 ring-1 ring-amber/60' : 'hover:bg-panel-2'} disabled:opacity-40`}
            >
              <img src={themeThumb(id)} alt="" className="pixelated h-[30px] w-[45px] shrink-0 rounded-[3px] object-cover" />
              <span className="min-w-0 text-[12.5px] leading-tight">
                <span className="block truncate">{t(`office:themeShort.${id}`)}</span>
                <span className="block truncate text-[11px] text-faint">{t(`office:theme.${id}`)}</span>
              </span>
            </button>
          ))}
        </div>

        <SectionTitle aside={rosterCount ? t('agents:roster.count', { count: rosterCount }) : undefined}>{t('sidebar.team')}</SectionTitle>
        <div className="mb-4 px-2" role="listbox" aria-label={t('sidebar.team')}>
          {rosterCount === 0 && <p className="px-2 py-3 text-[12px] text-faint">{t('agents:roster.empty')}</p>}
          {groups.list.map((g) => {
            const shared = sharedTreeCount(g.members, runtime);
            return (
              <div key={g.key} className="mb-1.5">
                {groups.list.length > 1 || g.key ? (
                  <div className="flex items-center gap-1.5 px-1.5 pt-1 pb-0.5 text-[10.5px] text-faint">
                    <span className="truncate font-medium text-muted" title={g.key}>
                      {projectLabel(g.key)}
                    </span>
                    {shared > 1 && (
                      <span className="shrink-0 text-amber" title={t('agents:team.sharedTreeHint')}>
                        ⚠ {t('agents:team.sharedTree', { count: shared })}
                      </span>
                    )}
                  </div>
                ) : null}
                <ul>
                  {g.members.map((a) => (
                    <RosterItem key={a.id} agent={a} selected={a.id === selected} onClick={() => select(a.id)} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

          {groups.departed > 0 && (
            <button onClick={() => setShowDeparted(!showDeparted)} className="mt-0.5 w-full rounded-md px-2 py-1 text-left text-[11.5px] text-faint hover:bg-panel-2 hover:text-muted">
              {showDeparted ? t('agents:roster.hideDeparted') : t('agents:roster.showDeparted', { count: groups.departed })}
            </button>
          )}

        <ConflictWarnings />

        <SectionTitle>{t('sidebar.activeTasks')}</SectionTitle>
        <ObservedTasks />
      </div>

      <div className="m-2 flex gap-1">
        <button
          data-tour="settings"
          onClick={() => toggleSettings(true)}
          className="flex flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-[12.5px] text-muted hover:bg-panel-2 hover:text-fg"
          title={isMac ? '⌘,' : 'Ctrl+,'}
        >
          <GearIcon />
          {t('sidebar.settings')}
        </button>
        <button data-tour="guide" onClick={() => useGuide.getState().open('start')} className="flex items-center gap-1.5 rounded-md px-2.5 py-2 text-[12.5px] text-muted hover:bg-panel-2 hover:text-fg">
          <span aria-hidden className="grid h-3.5 w-3.5 place-items-center rounded-full text-[10px] font-bold ring-1 ring-current">?</span>
          {t('sidebar.guide')}
        </button>
      </div>
    </aside>
  );
}

function RosterItem({ agent, selected, onClick }: { agent: AgentRecord; selected: boolean; onClick: () => void }) {
  const { t } = useTranslation('agents');
  const status = useApp((s) => s.runtime[agent.id]?.status ?? 'disconnected');
  const sub = agent.kind === 'subagent';
  return (
    <li role="option" aria-selected={selected}>
      <button
        onClick={onClick}
        className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left transition-colors ${sub ? 'pl-6' : 'pl-1.5'} ${selected ? 'bg-panel-3' : 'hover:bg-panel-2'}`}
      >
        <span className="relative">
          <Portrait appearance={agent.appearance} size={sub ? 24 : 30} className={`rounded bg-panel-2 ${status === 'disconnected' ? 'opacity-40 grayscale' : ''}`} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium">{agent.name}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
            <StatusDot status={status} />
            <span className="shrink-0 whitespace-nowrap">{t(`status.${status}`)}</span>
            <AgentChips agent={agent} />
          </span>
        </span>
      </button>
    </li>
  );
}

let logo: string | undefined;
function themeLogo() {
  if (logo) return logo;
  const c = document.createElement('canvas');
  c.width = 14;
  c.height = 14;
  const ctx = c.getContext('2d')!;
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  // tiny pixel house with a glowing monitor window
  px(2, 6, 10, 7, '#e2705c');
  px(1, 5, 12, 2, '#3a2a2a');
  px(3, 3, 8, 2, '#3a2a2a');
  px(5, 1, 4, 2, '#3a2a2a');
  px(4, 8, 6, 4, '#1b1f2e');
  px(5, 9, 4, 1, '#7fd1ff');
  px(5, 10, 2, 1, '#ffd166');
  px(2, 12, 10, 1, '#a3533b');
  logo = c.toDataURL();
  return logo;
}

export function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Zm5.3-1.4.9.7-1 1.8-1.1-.4a4.6 4.6 0 0 1-1.2.7l-.2 1.2H7.3l-.2-1.2a4.6 4.6 0 0 1-1.2-.7l-1.1.4-1-1.8.9-.7a4.7 4.7 0 0 1 0-1.4l-.9-.7 1-1.8 1.1.4c.4-.3.8-.5 1.2-.7l.2-1.2h2.1l.2 1.2c.4.2.8.4 1.2.7l1.1-.4 1 1.8-.9.7a4.7 4.7 0 0 1 0 1.4Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}
