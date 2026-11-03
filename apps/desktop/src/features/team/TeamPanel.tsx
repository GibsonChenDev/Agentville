import { appearanceFromSeed, sanitizeAppearance } from '@agentville/domain';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlayer } from '../../team/playerStore';
import { team } from '../../team/teamClient';
import { useTeam } from '../../team/teamStore';
import { Portrait } from '../agents/Portrait';

/** Sidebar section: create/join a team office, or see who's in it and invite more people. */
export function TeamPanel() {
  const { t } = useTranslation('team');
  const membership = useTeam((s) => s.membership);
  const status = useTeam((s) => s.status);
  const room = useTeam((s) => s.room);
  const members = useTeam((s) => s.members);
  const error = useTeam((s) => s.error);
  const player = usePlayer();
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!membership) {
    return (
      <div className="mx-2 mb-4 rounded-md bg-panel-2 p-2.5">
        <p className="text-[11.5px] leading-relaxed text-muted">{t('panel.pitch')}</p>
        {error && <p className="mt-1.5 text-[11.5px] text-coral">{t(`error.${error}`)}</p>}
        <div className="mt-2 flex gap-1.5">
          <button onClick={() => useTeam.getState().openDialog('create')} className="flex-1 rounded-md bg-amber px-2 py-1 text-[12px] font-semibold text-ink">
            {t('panel.create')}
          </button>
          <button onClick={() => useTeam.getState().openDialog('join')} className="flex-1 rounded-md px-2 py-1 text-[12px] ring-1 ring-line-strong hover:bg-panel-3">
            {t('panel.join')}
          </button>
        </div>
        <button onClick={() => player.openEditor(true)} className="mt-2 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[11.5px] text-muted hover:bg-panel-3 hover:text-fg">
          <Portrait appearance={player.appearance} size={22} className="rounded bg-panel" />
          {t('panel.editMe')}
        </button>
      </div>
    );
  }

  const list = Object.values(members).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  const tone = status === 'online' ? 'bg-leaf' : status === 'idle' ? 'bg-coral' : 'bg-amber';
  const copy = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; the code is selectable
    }
  };

  return (
    <div className="mx-2 mb-4 rounded-md bg-panel-2 p-2.5">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{room?.name ?? t('panel.connectingName')}</span>
        <span className="shrink-0 text-[10.5px] text-faint">{t(`status.${status}`)}</span>
      </div>
      {status === 'idle' && (
        <button onClick={() => team.retry()} className="mt-1.5 text-[11.5px] text-amber underline decoration-dotted">
          {t('panel.reconnect')}
        </button>
      )}

      {room && (
        <div className="mt-2">
          <div className="text-[10.5px] text-faint">{t('panel.inviteCode')}</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <code className="selectable flex-1 rounded bg-ink/60 px-2 py-1 font-mono text-[12.5px] tracking-wider text-fg ring-1 ring-line">{room.code}</code>
            <button onClick={() => void copy()} className="rounded px-2 py-1 text-[11px] text-muted ring-1 ring-line hover:bg-panel-3 hover:text-fg">
              {copied ? t('panel.copied') : t('panel.copy')}
            </button>
          </div>
          {membership.owner && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await team.rotateCode().catch(() => undefined);
                setBusy(false);
              }}
              className="mt-1 text-[11px] text-faint underline decoration-dotted hover:text-muted disabled:opacity-50"
            >
              {t('panel.rotate')}
            </button>
          )}
        </div>
      )}

      <ul className="mt-2 space-y-0.5">
        {list.map((m) => {
          const me = m.id === membership.memberId;
          return (
            <li key={m.id} className={`flex items-center gap-2 rounded px-1 py-0.5 ${m.online ? '' : 'opacity-45'}`}>
              <Portrait appearance={me ? player.appearance : sanitizeAppearance(m.appearance, appearanceFromSeed(m.id))} size={22} className="rounded bg-panel" />
              <span className="min-w-0 flex-1 truncate text-[12px]">
                {me ? player.name || m.name : m.name}
                {me && <span className="text-faint"> · {t('you')}</span>}
                {m.owner && <span className="ml-1 text-[10px] text-amber" title={t('panel.ownerHint')}>★</span>}
              </span>
              {m.online && !me && (
                <span className="shrink-0 text-[11px] text-muted tabular-nums" title={t('agentsWorking', { count: m.agents })}>
                  🤖 {m.agents}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-[10.5px] leading-snug text-faint">{t('panel.privacy')}</p>

      <div className="mt-2 flex items-center gap-1.5">
        <button onClick={() => player.openEditor(true)} className="flex-1 rounded-md px-2 py-1 text-[11.5px] text-muted ring-1 ring-line hover:bg-panel-3 hover:text-fg">
          {t('panel.editMe')}
        </button>
        {confirmLeave ? (
          <button onClick={() => void team.leave()} className="rounded-md bg-coral/20 px-2 py-1 text-[11.5px] text-coral ring-1 ring-coral/40">
            {t('panel.confirmLeave')}
          </button>
        ) : (
          <button onClick={() => setConfirmLeave(true)} className="rounded-md px-2 py-1 text-[11.5px] text-muted ring-1 ring-line hover:text-coral">
            {t('panel.leave')}
          </button>
        )}
      </div>
    </div>
  );
}
