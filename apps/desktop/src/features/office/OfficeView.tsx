import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CameraState } from '../../game/engine/OfficeWorld';
import { inMode, useApp } from '../../state/store';
import { demoRunner } from '../demo/DemoRunner';
import { GameCanvas } from './GameCanvas';
import { OfficeEditor } from './OfficeEditor';
import { TeamChat } from '../team/TeamChat';
import { useEditor } from './editorStore';
import { useGuide } from '../guide/guideStore';
import { worldApi } from './worldApi';
import { useTeam } from '../../team/teamStore';
import { usePlace } from '../../world/placeStore';
import { Wallet } from '../shop/Wallet';

export function OfficeView() {
  const { t } = useTranslation();
  const mode = useApp((s) => s.mode);
  const agentCount = useApp((s) => Object.values(s.agents).filter((a) => inMode(s.mode, a.origin) && s.runtime[a.id]?.status !== 'disconnected').length);
  const link = useApp((s) => s.link);
  const hooks = useApp((s) => s.hooks);
  const followId = useApp((s) => s.followAgentId);
  const followName = useApp((s) => (s.followAgentId ? s.agents[s.followAgentId]?.name : undefined));
  const [camera, setCamera] = useState<CameraState>({ zoom: 3 });
  const [paused, setPaused] = useState(false);
  const editing = useEditor((s) => s.active);
  // In a team office the floor is shared; the setup card would cover teammates.
  const inTeam = useTeam((s) => s.status === 'online');
  // The chat stays on screen while reconnecting (it says it can't send), not only while online.
  const inTeamOffice = useTeam((s) => !!s.membership);
  const inLobby = usePlace((s) => s.place.kind === 'lobby');
  const fading = usePlace((s) => s.fading);

  useEffect(() => {
    if (mode === 'demo') {
      demoRunner.start();
      setPaused(false);
    }
    return () => demoRunner.stop();
  }, [mode]);

  return (
    <main className="relative flex min-w-0 flex-1 flex-col">
      {mode === 'demo' && (
        <div className="relative z-10 flex h-7 shrink-0 items-center gap-2 bg-[repeating-linear-gradient(135deg,#3a2a10_0_10px,#33250e_10px_20px)] px-3 text-[11.5px] text-amber" role="status">
          <span className="rounded bg-amber px-1.5 text-[10.5px] font-bold tracking-wider text-ink uppercase">{t('mode.demo')}</span>
          <span className="truncate">{t('mode.demoBanner')}</span>
        </div>
      )}
      <div className="relative min-h-0 flex-1 bg-ink" data-tour="office">
        <GameCanvas onCamera={setCamera} />

        {mode === 'demo' && (
          <div className="pointer-events-none absolute right-3 bottom-3 font-pixel text-[13px] tracking-widest text-amber/50 select-none" aria-hidden>
            {t('mode.demoWatermark')}
          </div>
        )}

        <OfficeEditor />
        {!editing && <WalkHints />}
        {inTeamOffice && !inLobby && !editing && <TeamChat />}
        {inLobby && (
          <div className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 rounded-lg bg-panel/90 px-3 py-1.5 text-[12px] text-muted shadow-lg ring-1 ring-line-strong backdrop-blur">
            <span className="font-semibold text-fg">{t('team:place.lobby')}</span> · {t('team:place.lobbyHint')}
          </div>
        )}
        {mode === 'live' && agentCount === 0 && !editing && !inTeam && !inLobby && <LiveEmptyState link={link} hooksReady={!!hooks?.installed && !hooks.stale} />}

        {/* camera + mode toolbar */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5">
          <div data-tour="mode" className="flex rounded-lg bg-panel/90 p-0.5 shadow-lg ring-1 ring-line-strong backdrop-blur" role="radiogroup" aria-label={`${t('mode.demo')} / ${t('mode.live')}`}>
            {(['demo', 'live'] as const).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                onClick={() => mode !== m && useApp.getState().setMode(m)}
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${mode === m ? (m === 'demo' ? 'bg-amber text-ink' : 'bg-teal text-ink') : 'text-muted hover:text-fg'}`}
              >
                {t(`mode.${m}`)}
              </button>
            ))}
          </div>
          <Wallet />
          {mode === 'demo' && (
            <div className="flex rounded-lg bg-panel/90 p-0.5 shadow-lg ring-1 ring-line-strong backdrop-blur">
              <ToolButton
                label={paused ? t('actions.resume') : t('actions.pause')}
                onClick={() => {
                  if (paused) demoRunner.resume();
                  else demoRunner.pause();
                  setPaused(!paused);
                }}
              >
                {paused ? '▶' : '❚❚'}
              </ToolButton>
              <ToolButton
                label={t('actions.restart')}
                onClick={() => {
                  useApp.getState().resetWorld();
                  demoRunner.start();
                  setPaused(false);
                }}
              >
                ↺
              </ToolButton>
            </div>
          )}
        </div>

        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          {!editing && !inLobby && (
            <button
              onClick={() => useEditor.getState().start()}
              className="rounded-lg bg-panel/90 px-2.5 py-1 text-[11.5px] text-muted shadow-lg ring-1 ring-line-strong backdrop-blur hover:text-fg"
            >
              ✎ {t('office:editOffice')}
            </button>
          )}
          {mode === 'live' && <LinkPill link={link} />}
          {followId && followName && (
            <button onClick={() => useApp.getState().follow(undefined)} className="rounded-lg bg-amber/15 px-2.5 py-1 text-[11.5px] text-amber shadow-lg ring-1 ring-amber/40 backdrop-blur">
              {t('office:camera.following', { name: followName })} ✕
            </button>
          )}
          <div className="flex items-center rounded-lg bg-panel/90 p-0.5 shadow-lg ring-1 ring-line-strong backdrop-blur">
            <ToolButton label={t('actions.zoomOut')} onClick={() => worldApi.current?.zoomBy(-1)}>
              −
            </ToolButton>
            <span className="min-w-[46px] text-center font-mono text-[11px] text-muted tabular-nums" aria-live="polite">
              {t('office:camera.zoom', { level: camera.zoom })}
            </span>
            <ToolButton label={t('actions.zoomIn')} onClick={() => worldApi.current?.zoomBy(1)}>
              +
            </ToolButton>
            <ToolButton label={t('actions.recenter')} onClick={() => worldApi.current?.fitZoom()}>
              ⤢
            </ToolButton>
          </div>
        </div>
        <div className={`pointer-events-none absolute inset-0 bg-ink transition-opacity duration-300 ${fading ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
      </div>
    </main>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-[13px] text-muted hover:bg-panel-3 hover:text-fg">
      {children}
    </button>
  );
}

function LinkPill({ link }: { link: 'offline' | 'connecting' | 'online' }) {
  const { t } = useTranslation('integration');
  const tone = link === 'online' ? 'bg-leaf' : link === 'connecting' ? 'bg-amber' : 'bg-coral';
  return (
    <button
      onClick={() => useApp.getState().toggleSettings(true, 'monitoring')}
      className="flex items-center gap-1.5 rounded-lg bg-panel/90 px-2.5 py-1 text-[11.5px] text-muted shadow-lg ring-1 ring-line-strong backdrop-blur hover:text-fg"
    >
      <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden />
      {t(`live.${link}`)}
    </button>
  );
}

function LiveEmptyState({ link, hooksReady }: { link: 'offline' | 'connecting' | 'online'; hooksReady: boolean }) {
  const { t } = useTranslation('integration');
  const variant = link !== 'online' ? 'setup' : hooksReady ? 'waiting' : 'hooksMissing';
  const copy = {
    setup: { title: t('live.setupTitle'), body: t('live.setupBody') },
    hooksMissing: { title: t('live.hooksMissingTitle'), body: t('live.hooksMissingBody') },
    waiting: { title: t('live.waitingTitle'), body: t('live.waitingBody') },
  }[variant];
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="pointer-events-auto max-w-sm rounded-xl bg-panel/95 p-5 text-center shadow-xl ring-1 ring-line-strong backdrop-blur">
        {variant === 'waiting' && <div className="mx-auto mb-3 h-2 w-2 animate-ping rounded-full bg-teal" aria-hidden />}
        <p className="text-[14px] font-semibold">{copy.title}</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{copy.body}</p>
        {variant === 'waiting' ? (
          <>
            <code className="mt-3 inline-block rounded bg-ink/70 px-2 py-1 font-mono text-[12px] text-fg ring-1 ring-line">claude</code>
            <button onClick={() => useGuide.getState().open('start')} className="mt-3 block w-full text-[12px] text-muted underline decoration-dotted hover:text-fg">
              {t('live.howTo')}
            </button>
          </>
        ) : (
          <button onClick={() => useApp.getState().toggleSettings(true, 'monitoring')} className="mt-4 rounded-md bg-amber px-3.5 py-1.5 text-[12.5px] font-semibold text-ink">
            {t('live.setupCta')}
          </button>
        )}
      </div>
    </div>
  );
}

const HINTS_KEY = 'agentville.hints.walk';

/** How to move your own character; hidden once dismissed. */
function WalkHints() {
  const { t } = useTranslation('team');
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HINTS_KEY) === 'hidden';
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  return (
    <div className="absolute bottom-3 left-3 max-w-[300px] rounded-lg bg-panel/90 px-3 py-2 text-[11.5px] leading-relaxed text-muted shadow-lg ring-1 ring-line-strong backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-fg">{t('hints.title')}</span>
        <button
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(HINTS_KEY, 'hidden');
            } catch {
              // fine: hidden for this session
            }
          }}
          className="text-[11px] text-faint hover:text-fg"
        >
          {t('hints.dismiss')}
        </button>
      </div>
      <p>
        <kbd className="rounded bg-ink/70 px-1 font-mono text-[10.5px] text-fg ring-1 ring-line">W A S D</kbd> {t('hints.move')}
      </p>
      <p>{t('hints.use')}</p>
    </div>
  );
}
