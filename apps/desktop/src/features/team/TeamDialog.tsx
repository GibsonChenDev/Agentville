import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TeamApiError, normalizeServer } from '../../team/api';
import { usePlayer } from '../../team/playerStore';
import { team } from '../../team/teamClient';
import { DEFAULT_TEAM_SERVER, useTeam, type TeamError } from '../../team/teamStore';

/** Create a team office (you get the invite code) or join one with a code. */
export function TeamDialog() {
  const { t } = useTranslation('team');
  const mode = useTeam((s) => s.dialog);
  const savedServer = useTeam((s) => s.server);
  const dialog = useRef<HTMLDialogElement>(null);
  const [roomName, setRoomName] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [server, setServer] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TeamError>();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (mode && !d.open) {
      setName(usePlayer.getState().name);
      setServer(savedServer);
      setAdvanced(!savedServer);
      setError(undefined);
      setCode('');
      setRoomName('');
      d.showModal();
    }
    if (!mode && d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const close = () => useTeam.getState().openDialog(undefined);
  const serverOk = !!normalizeServer(server);
  const ready = name.trim() && serverOk && (mode === 'create' ? roomName.trim() : code.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    useTeam.getState().setServer(normalizeServer(server)!);
    try {
      if (mode === 'create') await team.create(roomName.trim(), name.trim());
      else await team.join(code, name.trim());
      close();
    } catch (err) {
      setError(err instanceof TeamApiError ? err.code : 'server');
    } finally {
      setBusy(false);
    }
  };

  const field = 'selectable mt-1 w-full rounded-md bg-ink/60 px-2.5 py-1.5 text-[13px] ring-1 ring-line outline-none focus:ring-amber/60';
  return (
    <dialog ref={dialog} onClose={close} className="m-auto w-[420px] max-w-[95vw] rounded-xl bg-panel p-0 text-fg shadow-2xl ring-1 ring-line-strong backdrop:bg-black/55" aria-labelledby="team-dialog-title">
      {mode && (
        <form onSubmit={(e) => void submit(e)}>
          <div className="border-b border-line px-5 py-3">
            <h2 id="team-dialog-title" className="text-[15px] font-semibold">
              {t(mode === 'create' ? 'dialog.createTitle' : 'dialog.joinTitle')}
            </h2>
            <p className="mt-0.5 text-[12px] text-muted">{t(mode === 'create' ? 'dialog.createBody' : 'dialog.joinBody')}</p>
          </div>
          <div className="space-y-3 px-5 py-4">
            {mode === 'create' ? (
              <label className="block">
                <span className="text-[12px] text-muted">{t('dialog.roomName')}</span>
                <input autoFocus value={roomName} maxLength={40} onChange={(e) => setRoomName(e.target.value)} placeholder={t('dialog.roomNamePlaceholder')} className={field} />
              </label>
            ) : (
              <label className="block">
                <span className="text-[12px] text-muted">{t('dialog.code')}</span>
                <input autoFocus value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} placeholder="AGV-XXXX-XXXX" className={`${field} font-mono tracking-wider uppercase`} />
              </label>
            )}
            <label className="block">
              <span className="text-[12px] text-muted">{t('dialog.nickname')}</span>
              <input autoFocus={mode === 'create' && !!roomName} value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder={t('dialog.nicknamePlaceholder')} className={field} />
            </label>
            <div>
              <button type="button" onClick={() => setAdvanced(!advanced)} className="text-[11.5px] text-faint underline decoration-dotted hover:text-muted">
                {t(advanced ? 'dialog.hideServer' : 'dialog.showServer')}
              </button>
              {advanced && (
                <label className="mt-1.5 block">
                  <span className="text-[12px] text-muted">{t('dialog.server')}</span>
                  <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://agentville-relay.example.workers.dev" className={`${field} font-mono text-[12px]`} />
                  <span className="mt-1 block text-[11px] text-faint">{DEFAULT_TEAM_SERVER ? t('dialog.serverHint') : t('dialog.serverRequired')}</span>
                  {server && !serverOk && <span className="mt-1 block text-[11px] text-coral">{t('dialog.serverInvalid')}</span>}
                </label>
              )}
            </div>
            <p className="rounded-md bg-ink/40 p-2.5 text-[11.5px] leading-relaxed text-muted ring-1 ring-line">{t('dialog.privacy')}</p>
            {error && (
              <p className="text-[12px] text-coral" role="alert">
                {t(`error.${error}`)}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button type="button" onClick={close} className="rounded-md px-3 py-1.5 text-[12px] ring-1 ring-line-strong hover:bg-panel-3">
              {t('common:actions.cancel')}
            </button>
            <button type="submit" disabled={!ready || busy} className="rounded-md bg-amber px-4 py-1.5 text-[12.5px] font-semibold text-ink disabled:opacity-50">
              {busy ? t('dialog.working') : t(mode === 'create' ? 'dialog.createCta' : 'dialog.joinCta')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
