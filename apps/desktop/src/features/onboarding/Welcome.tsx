import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyLocale, type LocalePreference } from '../../i18n';
import { useApp } from '../../state/store';
import { useGuide } from '../guide/guideStore';
import { SetupChecklist } from '../setup/SetupChecklist';

/** First-run welcome: pick a language, then start with the demo or set up monitoring. */
export function Welcome() {
  const { t } = useTranslation('integration');
  const onboarded = useApp((s) => s.prefs.onboarded);
  const locale = useApp((s) => s.prefs.locale);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !onboarded && !d.open) d.showModal();
    if (d && onboarded && d.open) d.close();
  }, [onboarded]);

  const finish = (mode: 'demo' | 'live') => {
    const s = useApp.getState();
    if (s.mode !== mode) s.setMode(mode);
    if (mode === 'live') return setStep(3);
    s.setPref('onboarded', true);
  };
  const setLocale = (id: LocalePreference) => {
    useApp.getState().setLocale(id);
    void applyLocale(id);
  };

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => e.preventDefault()}
      className="m-auto w-[580px] max-w-[94vw] overflow-hidden rounded-2xl bg-panel p-0 text-fg shadow-2xl ring-1 ring-line-strong backdrop:bg-black/60"
      aria-labelledby="welcome-title"
    >
      <div className="bg-[repeating-linear-gradient(135deg,#2a2234_0_14px,#2e2639_14px_28px)] px-6 pt-6 pb-5">
        <p className="font-pixel text-[26px] leading-none tracking-wide text-amber">Agentville</p>
        <h2 id="welcome-title" className="mt-2 text-[15px] font-semibold">
          {t('welcome.title')}
        </h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t('welcome.body')}</p>
      </div>

      {step === 1 ? (
        <div className="space-y-3 px-6 py-5">
          <p className="text-[12.5px] font-medium">
            {t('settings:language')} <span className="font-normal text-faint">/ Language</span>
          </p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('settings:language')}>
            {(
              [
                ['system', t('settings:system')],
                ['en', 'English'],
                ['zh-TW', '繁體中文'],
              ] as [LocalePreference, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                role="radio"
                aria-checked={locale === id}
                onClick={() => setLocale(id)}
                className={`rounded-lg px-3 py-2 text-[13px] ${locale === id ? 'bg-amber/15 text-amber ring-1 ring-amber/60' : 'ring-1 ring-line hover:bg-panel-2'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex justify-end pt-2">
            <button onClick={() => setStep(2)} className="rounded-md bg-amber px-4 py-1.5 text-[13px] font-semibold text-ink">
              {t('welcome.next')}
            </button>
          </div>
        </div>
      ) : step === 3 ? (
        <div className="scroll-thin max-h-[60vh] space-y-3 overflow-y-auto px-6 py-5">
          <p className="text-[12.5px] font-medium">{t('welcome.setupTitle')}</p>
          <SetupChecklist compact />
          <div className="flex items-center justify-between pt-1">
            <button onClick={() => useGuide.getState().open('start')} className="text-[12px] text-muted underline decoration-dotted hover:text-fg">
              {t('welcome.readGuide')}
            </button>
            <button onClick={() => useApp.getState().setPref('onboarded', true)} className="rounded-md bg-amber px-4 py-1.5 text-[13px] font-semibold text-ink">
              {t('welcome.finish')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 px-6 py-5">
          <p className="text-[12.5px] font-medium">{t('welcome.chooseTitle')}</p>
          <button onClick={() => finish('live')} className="block w-full rounded-xl p-3.5 text-left ring-1 ring-teal/50 hover:bg-teal/10">
            <span className="block text-[13.5px] font-semibold text-teal">{t('welcome.liveTitle')}</span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{t('welcome.liveBody')}</span>
          </button>
          <button onClick={() => finish('demo')} className="block w-full rounded-xl p-3.5 text-left ring-1 ring-amber/50 hover:bg-amber/10">
            <span className="block text-[13.5px] font-semibold text-amber">{t('welcome.demoTitle')}</span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{t('welcome.demoBody')}</span>
          </button>
          <button onClick={() => setStep(1)} className="text-[12px] text-faint hover:text-muted">
            ← {t('welcome.back')}
          </button>
        </div>
      )}
    </dialog>
  );
}
