import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { desktop, isTauri } from '../../integration/platform';
import { lastHookAt } from '../../integration/protocol';
import { formatRelative } from '../../presentation/format';
import { useApp } from '../../state/store';
import { useErrorText } from '../settings/MonitoringSetup';
import { useGuide } from '../guide/guideStore';
import { setupReady, useSetup, useSteps, type StepId, type StepState } from './setupStore';

function Mark({ state }: { state: StepState }) {
  const cls: Record<StepState, string> = {
    done: 'bg-leaf text-ink',
    todo: 'bg-coral/20 text-coral ring-1 ring-coral/40',
    running: 'bg-amber/20 text-amber ring-1 ring-amber/50 animate-pulse',
    waiting: 'bg-teal/15 text-teal ring-1 ring-teal/40',
    blocked: 'bg-panel-3 text-faint ring-1 ring-line-strong',
    unknown: 'bg-panel-3 text-faint ring-1 ring-line-strong',
  };
  const glyph: Record<StepState, string> = { done: '✓', todo: '!', running: '…', waiting: '…', blocked: '·', unknown: '?' };
  return (
    <span className={`mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[11px] font-bold ${cls[state]}`} aria-hidden>
      {glyph[state]}
    </span>
  );
}

function Btn({ onClick, children, primary, disabled }: { onClick: () => void; children: React.ReactNode; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 rounded-md px-2.5 py-1 text-[11.5px] font-medium disabled:opacity-40 ${primary ? 'bg-amber text-ink hover:brightness-105' : 'ring-1 ring-line-strong hover:bg-panel-3'}`}
    >
      {children}
    </button>
  );
}

/** Copyable command line. */
export function CommandLine({ command }: { command: string }) {
  const { t } = useTranslation('guide');
  const [copied, setCopied] = useState(false);
  return (
    <span className="mt-1 flex items-center gap-1.5">
      <code className="selectable min-w-0 flex-1 truncate rounded bg-ink/80 px-2 py-1 font-mono text-[11.5px] text-fg ring-1 ring-line" title={command}>
        {command}
      </code>
      <button
        onClick={() => void navigator.clipboard?.writeText(command).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-line hover:text-fg"
      >
        {copied ? t('copied') : t('copy')}
      </button>
    </span>
  );
}

/**
 * The Monitor Mode checklist with a one-click "set everything up" button. Each
 * row explains what the step is for and offers the fix for that step alone.
 */
export function SetupChecklist({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation('setup');
  const errorText = useErrorText();
  const s = useSetup();
  const steps = useSteps();
  const lastAt = useApp((a) => lastHookAt(a.bridgeStatus, 'claude'));
  const link = useApp((a) => a.link);
  const logRef = useRef<HTMLPreElement>(null);
  const [backup, setBackup] = useState<string>();

  useEffect(() => {
    void s.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (link === 'online') void useSetup.getState().recheck();
  }, [link]);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [s.install?.lines.length]);

  const command = s.plans?.claude.command ?? '';
  const allDone = setupReady(steps);
  const running = s.auto === 'running' || s.install?.phase === 'running';

  const row = (id: StepId, action?: React.ReactNode, extra?: React.ReactNode) => (
    <li className="flex items-start gap-2.5">
      <Mark state={steps[id]} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[12.5px] ${steps[id] === 'done' ? 'text-fg' : 'text-muted'}`}>{t(`step.${id}.title`)}</span>
        {!compact && <span className="block text-[11.5px] leading-relaxed text-faint">{t(`step.${id}.why`)}</span>}
        {extra}
      </span>
      {steps[id] !== 'done' && action}
    </li>
  );

  return (
    <section className="space-y-3">
      {isTauri && allDone && (
        <div className="flex items-start gap-2.5 rounded-lg bg-leaf/10 p-3 ring-1 ring-leaf/35" role="status">
          <span className="mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-leaf text-[11px] font-bold text-ink" aria-hidden>
            ✓
          </span>
          <span>
            <span className="block text-[12.5px] font-semibold text-leaf">{t('ready.title')}</span>
            <span className="block text-[11.5px] leading-relaxed text-muted">{steps.events === 'done' ? t('ready.body') : t('ready.waiting')}</span>
          </span>
        </div>
      )}
      {isTauri && !allDone && (
        <div className="rounded-lg bg-amber/10 p-3 ring-1 ring-amber/35">
          <p className="text-[12.5px] font-semibold text-amber">{t('auto.title')}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11.5px] leading-relaxed text-muted">
            {steps.claude !== 'done' && (
              <li>
                {t('auto.installClaude')}
                <CommandLine command={command} />
              </li>
            )}
            {steps.receiver !== 'done' && <li>{t('auto.receiver')}</li>}
            {steps.hooks !== 'done' && <li>{t('auto.hooks')}</li>}
            <li>{t('auto.login')}</li>
          </ul>
          <div className="mt-2.5 flex items-center gap-2">
            <Btn primary disabled={running} onClick={() => void s.runAuto()}>
              {running ? t('auto.running') : t('auto.start')}
            </Btn>
            <span className="text-[11px] text-faint">{t('auto.consent')}</span>
          </div>
        </div>
      )}

      <ol className="space-y-2.5">
        {row(
          'claude',
          isTauri && (
            <Btn disabled={running} onClick={() => void s.installClaude()}>
              {t('fix.installClaude')}
            </Btn>
          ),
          s.claude?.version ? <span className="block font-mono text-[11px] text-faint">claude {s.claude.version}</span> : null,
        )}
        {row(
          'login',
          isTauri && steps.claude === 'done' && <Btn onClick={() => void s.openTerminal()}>{t('fix.login')}</Btn>,
          steps.login !== 'done' && steps.claude === 'done' ? <span className="block text-[11.5px] text-amber">{t('step.login.how')}</span> : null,
        )}
        {row('receiver', isTauri && <Btn onClick={() => void s.startReceiver()}>{t('fix.receiver')}</Btn>)}
        {row(
          'hooks',
          link === 'online' && (
            <Btn primary onClick={() => void s.installHooks().then(setBackup).catch(() => {})}>
              {t('fix.hooks')}
            </Btn>
          ),
          backup ? <span className="selectable block text-[11px] text-leaf">{t('backup', { path: backup })}</span> : null,
        )}
        {row(
          'events',
          isTauri && steps.claude === 'done' && steps.hooks === 'done' && <Btn onClick={() => void s.openTerminal()}>{t('fix.tryIt')}</Btn>,
          <span className="block text-[11.5px] text-faint">
            {lastAt ? t('lastEvent', { time: formatRelative(lastAt, Date.now(), i18n.language, t('common:time.justNow')) }) : t('step.events.how')}
          </span>,
        )}
      </ol>

      {s.install && (
        <div className="rounded-md bg-ink/50 p-2.5 ring-1 ring-line" role="region" aria-label={t('installLog')}>
          <div className="flex items-center justify-between">
            <p className={`text-[12px] font-medium ${s.install.phase === 'done' ? 'text-leaf' : s.install.phase === 'failed' ? 'text-coral' : ''}`}>
              {s.install.phase === 'running' ? t('install.running') : s.install.phase === 'done' ? t('install.done') : t('install.failed', { code: s.install.code ?? '—' })}
            </p>
            {s.install.phase === 'running' && <Btn onClick={s.cancelInstall}>{t('install.stop')}</Btn>}
          </div>
          <pre ref={logRef} className="scroll-thin selectable mt-1.5 max-h-32 overflow-auto rounded bg-ink/80 p-2 font-mono text-[10.5px] leading-relaxed text-muted">
            {s.install.lines.join('\n') || '…'}
          </pre>
          {s.install.phase === 'failed' && (
            <p className="mt-1.5 text-[11.5px] text-muted">
              {t('install.manual')}{' '}
              <button className="underline decoration-dotted" onClick={() => void desktop.openLink('claude_docs')}>
                {t('install.docs')}
              </button>
            </p>
          )}
        </div>
      )}

      {s.auto === 'needs-login' && <p className="rounded-md bg-amber/10 p-2.5 text-[12px] text-amber ring-1 ring-amber/30">{t('auto.needsLogin')}</p>}
      {s.auto === 'done' && <p className="rounded-md bg-leaf/10 p-2.5 text-[12px] text-leaf ring-1 ring-leaf/30">{t('auto.done')}</p>}
      {s.error && <p className="text-[12px] text-coral">{errorText(s.error)}</p>}

      <p className="text-[11.5px] text-faint">
        {t('guideHint')}{' '}
        <button className="text-muted underline decoration-dotted hover:text-fg" onClick={() => useGuide.getState().open('start')}>
          {t('openGuide')}
        </button>
      </p>
    </section>
  );
}
