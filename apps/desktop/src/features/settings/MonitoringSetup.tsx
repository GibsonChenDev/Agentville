import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bridge, BridgeRpcError } from '../../integration/bridgeClient';
import { desktop, errorCode, isTauri } from '../../integration/platform';
import type { HooksPreview, ToolInfo } from '../../integration/types';
import { useApp } from '../../state/store';
import { SetupChecklist } from '../setup/SetupChecklist';
import { useSetup } from '../setup/setupStore';

/** Localized message for a stable error code from Rust or the receiver ("code" or "code: detail"). */
export function useErrorText() {
  const { t } = useTranslation('errors');
  return (e: unknown) => {
    const raw = typeof e === 'string' ? e : '';
    const code = e instanceof BridgeRpcError ? e.code : errorCode(e);
    const detail = e instanceof BridgeRpcError ? e.detail : raw.includes(':') ? raw.slice(raw.indexOf(':') + 1).trim() : undefined;
    return t(`code.${code}`, { detail: detail ?? '', code, defaultValue: t('code.unknown', { code }) });
  };
}

function Section({ title, hint, children, aside }: { title: string; hint?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-panel-2/60 p-3.5 ring-1 ring-line">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold">{title}</h3>
          {hint && <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{hint}</p>}
        </div>
        {aside}
      </div>
      <div className="mt-3 space-y-2.5">{children}</div>
    </section>
  );
}

export function MonitoringSetup() {
  const { t } = useTranslation('integration');
  const errorText = useErrorText();
  const bridgeState = useApp((s) => s.bridge);
  const link = useApp((s) => s.link);
  const status = useApp((s) => s.bridgeStatus);
  const hooks = useApp((s) => s.hooks);
  const view = useSetup((s) => s.view);
  const git = view?.git;
  const platform = useSetup((s) => s.platform);

  const [form, setForm] = useState({ claudePath: '', hookPort: 47821, autoStart: true });
  const [claude, setClaude] = useState<ToolInfo>();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [preview, setPreview] = useState<HooksPreview>();
  const [logs, setLogs] = useState<string[] | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (view) setForm({ claudePath: view.config.claudePath ?? '', hookPort: view.config.hookPort, autoStart: view.config.autoStart });
  }, [view]);
  useEffect(() => {
    if (!logs || !isTauri) return;
    const id = setInterval(() => void desktop.bridgeLogs().then(setLogs), 2000);
    return () => clearInterval(id);
  }, [logs]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setMessage(undefined);
    try {
      const text = await fn();
      if (text) setMessage({ tone: 'ok', text });
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(undefined);
    }
  };

  const dirty = view && (form.claudePath !== (view.config.claudePath ?? '') || Number(form.hookPort) !== view.config.hookPort || form.autoStart !== view.config.autoStart);
  const receiverRunning = bridgeState.state === 'running';

  return (
    <div className="space-y-3.5">
      <p className="text-[12.5px] leading-relaxed text-muted">{t('intro')}</p>
      <SetupChecklist />
      {!isTauri && <p className="rounded-md bg-amber/10 px-3 py-2 text-[11.5px] text-amber ring-1 ring-amber/30">{t('desktopOnly')}</p>}
      {isTauri && platform === 'windows' && git === false && (
        <p className="rounded-md bg-panel-2 px-3 py-2 text-[11.5px] leading-relaxed text-muted ring-1 ring-line">
          {t('gitWindows')}{' '}
          <button className="underline decoration-dotted" onClick={() => void desktop.openLink('git_windows')}>
            git-scm.com
          </button>
        </p>
      )}

      <button onClick={() => setAdvanced(!advanced)} className="text-[12px] text-muted hover:text-fg" aria-expanded={advanced}>
        {advanced ? '▾' : '▸'} {t('advanced')}
      </button>

      {advanced && (
        <>
          {isTauri && view && (
            <Section title={t('claude.label')} hint={t('claude.hint')}>
              <div className="flex gap-1.5">
                <input
                  value={form.claudePath}
                  onChange={(e) => setForm({ ...form, claudePath: e.target.value })}
                  placeholder={claude?.path ?? view.claude.path ?? t('tool.placeholder')}
                  spellCheck={false}
                  className="selectable min-w-0 flex-1 rounded-md bg-ink/60 px-2.5 py-1.5 font-mono text-[11.5px] ring-1 ring-line outline-none focus:ring-amber/60"
                />
                <button onClick={() => void run('detect', async () => setClaude(await desktop.detectClaude(form.claudePath)))} className="rounded-md px-2.5 text-[12px] text-muted ring-1 ring-line hover:bg-panel-3">
                  {t('tool.auto')}
                </button>
                <button
                  onClick={() =>
                    void run('choose', async () => {
                      const p = await desktop.pickFile(t('claude.label'));
                      if (p) {
                        setForm({ ...form, claudePath: p });
                        setClaude(await desktop.detectClaude(p));
                      }
                    })
                  }
                  className="rounded-md px-2.5 text-[12px] text-muted ring-1 ring-line hover:bg-panel-3"
                >
                  {t('tool.choose')}
                </button>
              </div>
              {claude && <p className={`text-[11.5px] ${claude.ok ? 'text-leaf' : 'text-coral'}`}>{claude.ok ? t('tool.found', { version: claude.version }) : t('tool.notFound')}</p>}
            </Section>
          )}

          {isTauri && view && (
            <Section
              title={t('receiver.title')}
              hint={t('receiver.hint')}
              aside={
                <span className={`flex shrink-0 items-center gap-1.5 text-[11.5px] ${receiverRunning ? 'text-leaf' : bridgeState.state === 'failed' ? 'text-coral' : 'text-muted'}`}>
                  <span className={`h-2 w-2 rounded-full ${receiverRunning ? 'bg-leaf' : bridgeState.state === 'failed' ? 'bg-coral' : 'bg-faint'}`} />
                  {t(`receiver.state.${bridgeState.state}`, { port: bridgeState.state === 'running' ? bridgeState.port : '' })}
                </span>
              }
            >
              {bridgeState.state === 'failed' && <p className="text-[12px] text-coral">{errorText(bridgeState.detail ? `${bridgeState.code}: ${bridgeState.detail}` : bridgeState.code)}</p>}
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="block text-[12.5px] font-medium">{t('receiver.port')}</span>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={form.hookPort}
                    onChange={(e) => setForm({ ...form, hookPort: Number(e.target.value) })}
                    className="mt-1 w-28 rounded-md bg-ink/60 px-2.5 py-1.5 font-mono text-[12px] ring-1 ring-line outline-none focus:ring-amber/60"
                  />
                </label>
                <label className="mb-1.5 flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={form.autoStart} onChange={(e) => setForm({ ...form, autoStart: e.target.checked })} className="accent-teal" />
                  {t('receiver.autoStart')}
                </label>
              </div>
              <p className="text-[11.5px] text-faint">{t('receiver.portHint')}</p>
              {status && (
                <p className="font-mono text-[11px] text-muted">
                  {t('receiver.received', { count: status.hooks.received })} · {t('receiver.rejected', { count: status.hooks.rejected })}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={!dirty || !!busy}
                  onClick={() =>
                    void run('save', async () => {
                      await desktop.integrationSave({ ...view.config, claudePath: form.claudePath || null, hookPort: Number(form.hookPort), autoStart: form.autoStart });
                      await useSetup.getState().load();
                      return t('saved');
                    })
                  }
                  className="rounded-md bg-teal px-3 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-40"
                >
                  {busy === 'save' ? t('saving') : t('save')}
                </button>
                <button onClick={() => (logs ? setLogs(null) : void desktop.bridgeLogs().then(setLogs))} className="rounded-md px-3 py-1.5 text-[12px] text-muted ring-1 ring-line hover:bg-panel-3 hover:text-fg">
                  {logs ? t('receiver.hideLogs') : t('receiver.showLogs')}
                </button>
              </div>
              {logs && (
                <pre className="scroll-thin selectable max-h-36 overflow-auto rounded-md bg-ink/70 p-2 font-mono text-[10.5px] leading-relaxed text-muted ring-1 ring-line">
                  {logs.length ? logs.slice(-80).join('\n') : t('receiver.noLogs')}
                </pre>
              )}
            </Section>
          )}

          <Section title={t('hooks.title')} hint={t('hooks.hint')}>
            {link !== 'online' ? (
              <p className="text-[12px] text-muted">{t('hooks.needsReceiver')}</p>
            ) : (
              <>
                {hooks && (
                  <p className="text-[11.5px] text-faint">
                    {t('hooks.file')}: <span className="selectable font-mono text-muted">{hooks.settingsPath}</span>
                  </p>
                )}
                {hooks?.stale && <p className="text-[12px] text-amber">{t('hooks.stale')}</p>}
                <div className="flex flex-wrap gap-2">
                  {hooks?.installed && (
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        void run('uninstall', async () => {
                          useApp.getState().setHooks(await bridge.rpc({ method: 'hooks.uninstall' }));
                          setPreview(undefined);
                          return t('hooks.removed');
                        })
                      }
                      className="rounded-md px-3 py-1.5 text-[12px] ring-1 ring-line-strong hover:bg-panel-3 disabled:opacity-50"
                    >
                      {t('hooks.uninstall')}
                    </button>
                  )}
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      void run('preview', async () => {
                        if (preview) return setPreview(undefined);
                        setPreview(await bridge.rpc({ method: 'hooks.preview', params: { action: hooks?.installed && !hooks.stale ? 'uninstall' : 'install' } }));
                      })
                    }
                    className="rounded-md px-3 py-1.5 text-[12px] text-muted ring-1 ring-line hover:bg-panel-3 hover:text-fg disabled:opacity-50"
                  >
                    {preview ? t('hooks.hidePreview') : t('hooks.preview')}
                  </button>
                </div>
                {preview && (
                  <div className="grid grid-cols-2 gap-2">
                    {(['before', 'after'] as const).map((k) => (
                      <div key={k} className="min-w-0">
                        <div className="mb-1 text-[11px] font-medium text-faint">{t(`hooks.${k}`)}</div>
                        <pre className="scroll-thin selectable max-h-56 overflow-auto rounded-md bg-ink/70 p-2 font-mono text-[10.5px] leading-relaxed text-muted ring-1 ring-line">
                          {preview[k] || t('hooks.empty')}
                        </pre>
                      </div>
                    ))}
                    {!preview.changed && <p className="col-span-2 text-[11.5px] text-faint">{t('hooks.noChanges')}</p>}
                  </div>
                )}
              </>
            )}
          </Section>
        </>
      )}

      <p className="text-[11.5px] leading-relaxed text-faint">{t('observeOnly')}</p>
      {message && (
        <p role="status" className={`text-[12px] ${message.tone === 'ok' ? 'text-leaf' : 'text-coral'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
