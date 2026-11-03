import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyLocale, type LocalePreference } from '../../i18n';
import { useApp, type SettingsTab } from '../../state/store';
import { MonitoringSetup } from './MonitoringSetup';
import { unlockAudio } from '../alerts/sounds';
import { clearHistory } from '../../persistence/historyRecorder';

const LOCALES: { id: LocalePreference; key: string }[] = [
  { id: 'system', key: 'system' },
  { id: 'en', key: 'english' },
  { id: 'zh-TW', key: 'traditionalChinese' },
];

const SHORTCUTS: [string, string][] = [
  ['+ / −', 'zoom'],
  ['← ↑ → ↓', 'pan'],
  ['F', 'follow'],
  [']', 'cycle'],
  ['Esc', 'deselect'],
  ['`', 'console'],
  [/Mac/.test(navigator.userAgent) ? '⌘ ,' : 'Ctrl+,', 'settings'],
];

export function SettingsDialog() {
  const { t } = useTranslation('settings');
  const open = useApp((s) => s.settingsOpen);
  const tab = useApp((s) => s.settingsTab);
  const prefs = useApp((s) => s.prefs);
  const storageAvailable = useApp((s) => s.storageAvailable);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const setLocale = (id: LocalePreference) => {
    useApp.getState().setLocale(id);
    void applyLocale(id);
  };

  return (
    <dialog
      ref={dialog}
      onClose={() => useApp.getState().toggleSettings(false)}
      onClick={(e) => e.target === dialog.current && useApp.getState().toggleSettings(false)}
      className="m-auto w-[640px] max-w-[94vw] rounded-xl bg-panel p-0 text-fg shadow-2xl ring-1 ring-line-strong backdrop:bg-black/50"
      aria-labelledby="settings-title"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 id="settings-title" className="text-[15px] font-semibold">
          {t('title')}
        </h2>
        <button onClick={() => useApp.getState().toggleSettings(false)} className="rounded px-2 py-0.5 text-[12px] text-muted hover:bg-panel-2 hover:text-fg">
          {t('common:actions.close')}
        </button>
      </div>
      <div className="flex gap-1 border-b border-line px-4 pt-2" role="tablist">
        {(['general', 'monitoring'] as SettingsTab[]).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => useApp.setState({ settingsTab: id })}
            className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] ${tab === id ? 'border-amber font-semibold text-fg' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {t(`integration:tabs.${id}`)}
          </button>
        ))}
      </div>
      {tab === 'monitoring' && open && (
        <div className="scroll-thin max-h-[72vh] overflow-y-auto px-5 py-4">
          <MonitoringSetup />
        </div>
      )}
      <div className={`scroll-thin max-h-[72vh] space-y-5 overflow-y-auto px-5 py-4 ${tab === 'general' ? '' : 'hidden'}`}>
        <section>
          <h3 className="text-[12.5px] font-semibold">
            {t('language')} <span className="font-normal text-faint">/ Language</span>
          </h3>
          <p className="mt-0.5 text-[11.5px] text-muted">{t('languageHint')}</p>
          <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-panel-2 p-1" role="radiogroup" aria-label={t('language')}>
            {LOCALES.map((l) => (
              <button
                key={l.id}
                role="radio"
                aria-checked={prefs.locale === l.id}
                onClick={() => setLocale(l.id)}
                className={`rounded-md px-2 py-1.5 text-[12.5px] ${prefs.locale === l.id ? 'bg-panel-3 font-medium text-fg ring-1 ring-line-strong' : 'text-muted hover:text-fg'}`}
              >
                {t(l.key)}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2.5">
          <h3 className="text-[12.5px] font-semibold">{t('appearance')}</h3>
          <Toggle checked={prefs.reduceMotion} onChange={(v) => useApp.getState().setPref('reduceMotion', v)} label={t('reduceMotion')} hint={t('reduceMotionHint')} />
          <Toggle checked={prefs.alwaysShowLabels} onChange={(v) => useApp.getState().setPref('alwaysShowLabels', v)} label={t('showLabels')} />
        </section>

        <section className="space-y-2.5">
          <h3 className="text-[12.5px] font-semibold">{t('alerts')}</h3>
          <Toggle checked={prefs.notifyAttention} onChange={(v) => useApp.getState().setPref('notifyAttention', v)} label={t('notifyAttention')} hint={t('notifyAttentionHint')} />
          <Toggle checked={prefs.notifyDone} onChange={(v) => useApp.getState().setPref('notifyDone', v)} label={t('notifyDone')} />
          <Toggle
            checked={prefs.sound}
            onChange={(v) => {
              if (v) unlockAudio();
              useApp.getState().setPref('sound', v);
            }}
            label={t('sound')}
            hint={t('soundHint')}
          />
        </section>

        <HistorySection />

        <section>
          <h3 className="mb-2 text-[12.5px] font-semibold">{t('common:shortcuts.title')}</h3>
          <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-[12px]">
            {SHORTCUTS.map(([keys, id]) => (
              <div key={id} className="contents">
                <dt>
                  <kbd className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-line">{keys}</kbd>
                </dt>
                <dd className="text-muted">{t(`common:shortcuts.${id}`)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-t border-line pt-3 text-[11.5px] text-faint">
          <p>{t('version', { version: '0.1.0' })}</p>
          <p>{t('phase', { phase: '2' })}</p>
          {!storageAvailable && <p className="mt-1 text-amber">{t('errors:storageUnavailable')}</p>}
        </section>
      </div>
    </dialog>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-[12.5px]">{label}</span>
        {hint && <span className="block text-[11.5px] text-muted">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full bg-panel-3 ring-1 ring-line transition-colors peer-checked:bg-teal peer-focus-visible:outline-2 peer-focus-visible:outline-amber after:absolute after:top-[2px] after:left-[2px] after:h-[14px] after:w-[14px] after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-[14px]" aria-hidden />
    </label>
  );
}

function HistorySection() {
  const { t } = useTranslation('settings');
  const [state, setState] = useState<'idle' | 'confirm' | 'done'>('idle');
  return (
    <section>
      <h3 className="text-[12.5px] font-semibold">{t('history')}</h3>
      <p className="mt-0.5 text-[11.5px] text-muted">{t('historyHint')}</p>
      <div className="mt-2 flex items-center gap-2">
        {state === 'confirm' ? (
          <>
            <button
              onClick={() =>
                void clearHistory().then(() => {
                  useApp.getState().clearOrigin('external');
                  setState('done');
                })
              }
              className="rounded-md bg-coral px-3 py-1 text-[12px] font-semibold text-ink"
            >
              {t('historyConfirm')}
            </button>
            <button onClick={() => setState('idle')} className="rounded-md px-3 py-1 text-[12px] ring-1 ring-line-strong">
              {t('common:actions.cancel')}
            </button>
          </>
        ) : (
          <button onClick={() => setState('confirm')} className="rounded-md px-3 py-1 text-[12px] text-coral ring-1 ring-coral/40 hover:bg-coral/10">
            {t('historyClear')}
          </button>
        )}
        {state === 'done' && <span className="text-[11.5px] text-leaf">{t('historyCleared')}</span>}
      </div>
    </section>
  );
}
