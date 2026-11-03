import { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { PLAYER_ID } from '../../game/engine/OfficeWorld';
import { useApp } from '../../state/store';
import { worldApi } from '../office/worldApi';

/**
 * First-run tour: a few short steps that point at the real controls. Shown
 * once after the welcome screen (and once to people upgrading); replayable
 * from the guide.
 */
const STEPS: { id: string; target: string; onShow?: () => void }[] = [
  { id: 'you', target: 'office', onShow: () => worldApi.current?.follow(PLAYER_ID) },
  { id: 'sit', target: 'office' },
  { id: 'agents', target: 'mode' },
  { id: 'wallet', target: 'wallet' },
  { id: 'offices', target: 'offices' },
  { id: 'account', target: 'settings' },
  { id: 'guide', target: 'guide' },
];

const KEY = 'agentville.tour.v1';

export const useTour = create<{ step?: number; start: () => void; go: (step?: number) => void }>((set) => ({
  start: () => set({ step: 0 }),
  go: (step) => {
    if (step === undefined) {
      try {
        localStorage.setItem(KEY, 'done');
      } catch {
        // shown again next launch; harmless
      }
    }
    set({ step });
  },
}));

/** Starts the tour once, after the welcome screen has been completed. */
let watching = false;

export function startTourWhenReady() {
  if (watching) return;
  watching = true;
  const done = (() => {
    try {
      return localStorage.getItem(KEY) === 'done';
    } catch {
      return true;
    }
  })();
  if (done) return;
  const maybe = () => {
    if (useApp.getState().prefs.onboarded && useTour.getState().step === undefined) {
      setTimeout(() => useTour.getState().start(), 900);
      return true;
    }
    return false;
  };
  if (maybe()) return;
  const unsub = useApp.subscribe((s, prev) => {
    if (s.prefs.onboarded && !prev.prefs.onboarded && maybe()) unsub();
  });
}

export function Tour() {
  const { t } = useTranslation('tour');
  const step = useTour((s) => s.step);
  const [rect, setRect] = useState<DOMRect>();
  const current = step === undefined ? undefined : STEPS[step];

  useLayoutEffect(() => {
    if (!current) return;
    current.onShow?.();
    const measure = () => setRect(document.querySelector(`[data-tour="${current.target}"]`)?.getBoundingClientRect());
    measure();
    window.addEventListener('resize', measure);
    const id = setInterval(measure, 500);
    return () => {
      window.removeEventListener('resize', measure);
      clearInterval(id);
    };
  }, [current]);

  useEffect(() => {
    if (step === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useTour.getState().go(undefined);
      // Enter on the focused button already clicks it.
      if ((e.key === 'Enter' && (e.target as HTMLElement | null)?.tagName !== 'BUTTON') || e.key === 'ArrowRight') useTour.getState().go(step + 1 < STEPS.length ? step + 1 : undefined);
      if (e.key === 'ArrowLeft' && step > 0) useTour.getState().go(step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  if (step === undefined || !current) return null;
  const pad = 6;
  const big = rect && rect.width > 400;
  // Card next to the highlighted control, or along the bottom of the office for the big one.
  const card: React.CSSProperties = !rect
    ? { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
    : big
      ? { left: rect.left + rect.width / 2, top: rect.bottom - 24, transform: 'translate(-50%, -100%)' }
      : rect.left < 300
        ? { left: rect.right + 16, top: Math.max(16, Math.min(window.innerHeight - 220, rect.top)) }
        : { left: Math.min(window.innerWidth - 340, Math.max(16, rect.left)), top: rect.bottom + 14 };
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-amber transition-all duration-300"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: '0 0 0 9999px rgba(10,8,16,0.62)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(10,8,16,0.62)]" />
      )}
      <div className="absolute w-[320px] rounded-xl bg-panel p-4 text-fg shadow-2xl ring-1 ring-amber/50" style={card}>
        <div className="text-[11px] font-semibold tracking-wide text-amber">{t('progress', { n: step + 1, total: STEPS.length })}</div>
        <h2 id="tour-title" className="mt-1 text-[15px] font-semibold">
          {t(`${current.id}.title`)}
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed whitespace-pre-line text-muted">{t(`${current.id}.body`)}</p>
        <div className="mt-3.5 flex items-center gap-2">
          <button onClick={() => useTour.getState().go(undefined)} className="text-[12px] text-faint hover:text-muted">
            {t('skip')}
          </button>
          <div className="ml-auto flex gap-1.5">
            {step > 0 && (
              <button onClick={() => useTour.getState().go(step - 1)} className="rounded-md px-3 py-1.5 text-[12px] ring-1 ring-line-strong hover:bg-panel-3">
                {t('back')}
              </button>
            )}
            <button autoFocus onClick={() => useTour.getState().go(last ? undefined : step + 1)} className="rounded-md bg-amber px-3.5 py-1.5 text-[12.5px] font-semibold text-ink">
              {last ? t('done') : t('next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
