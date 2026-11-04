import type { CharacterAppearance } from '@agentville/domain';
import type { Update } from '@tauri-apps/plugin-updater';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ANIMS, buildCharacterSheet, type AnimName } from '../../game/assets/characterSprites';
import { isTauri } from '../../integration/platform';
import { useApp } from '../../state/store';
import { usePlayer } from '../../team/playerStore';
import { formatBytes, pickNotes } from './notes';

type Phase = 'available' | 'downloading' | 'installing' | 'done' | 'error';

/** Pause on the cheer frame before relaunching, so the finish is visible. */
const CHEER_MS = 1200;

/** The player's own character, animated from the same sprite sheet the office uses. */
function PixelSprite({ appearance, anim, flip = false, scale = 2 }: { appearance: CharacterAppearance; anim: AnimName; flip?: boolean; scale?: number }) {
  const sheet = useMemo(() => buildCharacterSheet(appearance), [appearance]);
  const urls = useMemo(() => ((flip && sheet.flipped[anim]) || sheet.frames[anim]).map((c) => c.toDataURL()), [sheet, anim, flip]);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setFrame((f) => f + 1), ANIMS[anim].frameMs);
    return () => clearInterval(id);
  }, [anim]);
  const canvas = sheet.frames[anim][0]!;
  return (
    <img
      src={urls[frame % urls.length]}
      width={canvas.width * scale}
      height={canvas.height * scale}
      alt=""
      aria-hidden
      draggable={false}
      className="pixelated block"
    />
  );
}

/**
 * Checks GitHub for a newer signed build once per launch and, if the user
 * agrees, downloads and installs it in place, then relaunches. The webview
 * only sees progress; signature checks and the install happen in Rust.
 */
export function UpdateDialog() {
  const { t, i18n } = useTranslation('common');
  const onboarded = useApp((s) => s.prefs.onboarded);
  const appearance = usePlayer((s) => s.appearance);
  const dialog = useRef<HTMLDialogElement>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<Phase>('available');
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  // Dev builds would always look outdated against the published release.
  useEffect(() => {
    if (!isTauri || import.meta.env.DEV || !onboarded) return;
    let cancelled = false;
    void (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const found = await check();
        if (!cancelled && found) setUpdate(found);
      } catch (e) {
        // Offline or GitHub unreachable: try again next launch.
        console.warn('update check failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onboarded]);

  useEffect(() => {
    const d = dialog.current;
    if (d && update && !d.open) d.showModal();
  }, [update]);

  const busy = phase === 'downloading' || phase === 'installing' || phase === 'done';
  const close = () => {
    if (busy) return;
    dialog.current?.close();
    setUpdate(null);
  };

  const install = async () => {
    if (!update) return;
    setPhase('downloading');
    setReceived(0);
    setTotal(0);
    setError('');
    try {
      let got = 0;
      // On Windows the installer takes over and closes the app after "Finished".
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') setTotal(e.data.contentLength ?? 0);
        else if (e.event === 'Progress') setReceived((got += e.data.chunkLength));
        else setPhase('installing');
      });
      setPhase('done');
      await new Promise((r) => setTimeout(r, CHEER_MS));
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  };

  if (!update) return null;
  const pct = total > 0 ? Math.min(100, (received / total) * 100) : 0;
  const notes = pickNotes(update.body, i18n.language);
  const sprite: { anim: AnimName; flip?: boolean } =
    phase === 'downloading' ? { anim: 'walk_side', flip: true } : phase === 'installing' ? { anim: 'stand_play_back' } : phase === 'done' ? { anim: 'stand_cheer' } : phase === 'error' ? { anim: 'idle_front' } : { anim: 'stand_raise' };

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="m-auto w-[460px] max-w-[94vw] overflow-hidden rounded-2xl bg-panel p-0 text-fg shadow-2xl ring-1 ring-line-strong backdrop:bg-black/60"
      aria-labelledby="update-title"
    >
      <div className="bg-[repeating-linear-gradient(135deg,#2a2234_0_14px,#2e2639_14px_28px)] px-6 pt-5 pb-4">
        <h2 id="update-title" className="font-pixel text-[20px] leading-none tracking-wide text-amber">
          {t('update.title')}
        </h2>
        <p className="mt-2 text-[12.5px] text-muted">{t('update.versions', { from: update.currentVersion, to: update.version })}</p>
      </div>

      <div className="space-y-4 px-6 py-5">
        {phase === 'available' || phase === 'error' ? (
          <div>
            <p className="text-[12.5px] font-medium">{t('update.whatsNew')}</p>
            <p className="scroll-thin mt-1.5 max-h-[38vh] overflow-y-auto whitespace-pre-line rounded-lg bg-panel-2 px-3 py-2 text-[12.5px] leading-relaxed text-muted">
              {notes || t('update.noNotes')}
            </p>
          </div>
        ) : null}

        {/* The character walks along the bar while the download runs. */}
        <div className="relative pt-[76px]" aria-hidden={phase === 'available'}>
          <div
            className="absolute bottom-[14px] transition-[left] duration-300 ease-linear"
            style={{ left: phase === 'downloading' ? `calc(${pct}% - ${pct * 0.48}px)` : phase === 'available' || phase === 'error' ? '0px' : 'calc(100% - 48px)' }}
          >
            <PixelSprite appearance={appearance} anim={sprite.anim} flip={sprite.flip} />
          </div>
          <div
            role="progressbar"
            aria-label={t('update.title')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={phase === 'downloading' && total > 0 ? Math.round(pct) : undefined}
            className="h-3 overflow-hidden rounded-sm bg-panel-3 ring-1 ring-line"
          >
            <div
              className={`h-full bg-amber transition-[width] duration-300 ${phase === 'downloading' && total === 0 ? 'animate-pulse' : ''}`}
              style={{ width: phase === 'downloading' ? `${total > 0 ? pct : 100}%` : phase === 'available' || phase === 'error' ? '0%' : '100%' }}
            />
          </div>
        </div>

        <p className="min-h-[1.25em] text-[12px] text-muted tabular-nums" aria-live="polite">
          {phase === 'downloading'
            ? total > 0
              ? t('update.downloading', { received: formatBytes(received), total: formatBytes(total), pct: Math.floor(pct) })
              : t('update.downloadingUnknown', { received: formatBytes(received) })
            : phase === 'installing'
              ? t('update.installing')
              : phase === 'done'
                ? t('update.restarting')
                : phase === 'error'
                  ? t('update.failed', { error })
                  : t('update.hint')}
        </p>

        <div className="flex justify-end gap-2">
          {phase === 'available' || phase === 'error' ? (
            <>
              <button onClick={close} className="rounded-md px-3 py-1.5 text-[13px] ring-1 ring-line hover:bg-panel-2">
                {t('update.later')}
              </button>
              <button onClick={() => void install()} className="rounded-md bg-amber px-4 py-1.5 text-[13px] font-semibold text-ink">
                {phase === 'error' ? t('update.retry') : t('update.install')}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
