import { HOOK_PROVIDERS, type HookProvider } from '@agentville/integrations';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bridge } from '../../integration/bridgeClient';
import { lastHookAt } from '../../integration/protocol';
import type { AgentDetection } from '../../integration/types';
import { formatRelative } from '../../presentation/format';
import { forgetConnection } from '../alerts/alerts';
import { useApp } from '../../state/store';
import { useErrorText } from './MonitoringSetup';
import { ProviderBadge } from '../agents/ProviderBadge';

/** Claude Code has the full setup checklist; every other agent gets a connect card here. */
const CARD_PROVIDERS = HOOK_PROVIDERS.filter((p) => p.id !== 'claude');

export type ConnectionState = 'off' | 'stale' | 'trust' | 'live';

/** off → (connect) → trust, for agents that must trust new hooks → live once a hook arrives. */
export function useConnectionState(provider: HookProvider): ConnectionState {
  const hooks = useApp((s) => s.hooks[provider.id]);
  const lastAt = useApp((s) => lastHookAt(s.bridgeStatus, provider.id));
  const seen = useApp((s) => Object.values(s.agents).some((a) => a.provider === provider.id));
  if (!hooks?.installed) return 'off';
  if (hooks.stale) return 'stale';
  // Characters restored from history mean hooks have run before, so they are trusted.
  return lastAt || seen || !provider.needsTrust ? 'live' : 'trust';
}

export function AgentConnections() {
  const { t } = useTranslation('integration');
  if (!CARD_PROVIDERS.length) return null;
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="text-[13px] font-semibold">{t('agents.title')}</h3>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{t('agents.hint')}</p>
      </div>
      {CARD_PROVIDERS.map((p) => (
        <ProviderCard key={p.id} provider={p} />
      ))}
    </section>
  );
}

function ProviderCard({ provider }: { provider: HookProvider }) {
  const { t, i18n } = useTranslation('integration');
  const errorText = useErrorText();
  const link = useApp((s) => s.link);
  const lastAt = useApp((s) => lastHookAt(s.bridgeStatus, provider.id));
  const state = useConnectionState(provider);
  const [detected, setDetected] = useState<AgentDetection>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const name = provider.label;

  useEffect(() => {
    if (link !== 'online') return;
    void bridge.rpc({ method: 'agent.detect', params: { provider: provider.id } }).then(setDetected, () => setDetected(undefined));
  }, [link, provider.id]);

  const act = async (method: 'hooks.install' | 'hooks.uninstall') => {
    setBusy(true);
    setMessage(undefined);
    try {
      const r = await bridge.rpc({ method, params: { provider: provider.id } });
      useApp.getState().setHooks(provider.id, r);
      if (method === 'hooks.uninstall') forgetConnection(provider.id);
      setMessage({ tone: 'ok', text: method === 'hooks.install' ? t('agents.connected', { name }) : t('agents.disconnected', { name }) });
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const tone = { off: 'text-muted', stale: 'text-amber', trust: 'text-amber', live: 'text-leaf' }[state];
  const dot = { off: 'bg-faint', stale: 'bg-amber', trust: 'bg-amber animate-pulse', live: 'bg-leaf' }[state];

  return (
    <div className="rounded-lg bg-panel-2/60 p-3.5 ring-1 ring-line">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ProviderBadge provider={provider.id} />
          <span className="text-[13px] font-semibold">{name}</span>
        </div>
        <span className={`flex shrink-0 items-center gap-1.5 text-[11.5px] ${tone}`}>
          <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
          {t(`agents.state.${state}`, { name })}
        </span>
      </div>

      {detected && (
        <p className={`mt-1.5 text-[11.5px] ${detected.installed ? 'text-faint' : 'text-amber'}`}>
          {detected.installed ? (detected.version ? t('agents.detectedVersion', { name, version: detected.version }) : t('agents.detected', { name })) : t('agents.notDetected', { name })}
        </p>
      )}

      {state === 'stale' && <p className="mt-2 text-[12px] text-amber">{t('agents.stale')}</p>}

      {state === 'trust' && (
        <div className="mt-2.5 rounded-md bg-amber/10 p-2.5 ring-1 ring-amber/30" role="status">
          <p className="text-[12px] font-semibold text-amber">{t('agents.trustTitle', { name })}</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11.5px] leading-relaxed text-muted">
            <li>{t(`agents.${provider.id}.trustCli`)}</li>
            <li>{t(`agents.${provider.id}.trustApp`)}</li>
          </ol>
          <p className="mt-1.5 text-[11px] leading-relaxed text-faint">{t('agents.trustAfter', { name })}</p>
        </div>
      )}

      {state === 'live' && (
        <p className="mt-2 text-[11.5px] text-faint">
          {lastAt ? t('agents.lastEvent', { time: formatRelative(lastAt, Date.now(), i18n.language, t('common:time.justNow')) }) : t('agents.liveIdle', { name })}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {link !== 'online' ? (
          <p className="text-[12px] text-muted">{t('hooks.needsReceiver')}</p>
        ) : (
          <>
            {(state === 'off' || state === 'stale') && (
              <button disabled={busy} onClick={() => void act('hooks.install')} className="rounded-md bg-amber px-3 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-50">
                {state === 'off' ? t('agents.connect', { name }) : t('agents.update')}
              </button>
            )}
            {state !== 'off' && (
              <button disabled={busy} onClick={() => void act('hooks.uninstall')} className="rounded-md px-3 py-1.5 text-[12px] ring-1 ring-line-strong hover:bg-panel-3 disabled:opacity-50">
                {t('agents.disconnect')}
              </button>
            )}
          </>
        )}
      </div>
      {message && <p className={`mt-2 text-[12px] ${message.tone === 'ok' ? 'text-leaf' : 'text-coral'}`}>{message.text}</p>}
    </div>
  );
}
