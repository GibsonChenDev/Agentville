import { EARN } from '@agentville/team-protocol';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../../account/accountStore';
import { TeamApiError } from '../../team/api';
import { usePlace } from '../../world/placeStore';

/** Your account: the recovery code that brings everything back, and restoring one on this computer. */
export function AccountSection() {
  const { t } = useTranslation('shop');
  const code = useAccount((s) => s.code);
  const account = useAccount((s) => s.account);
  const status = useAccount((s) => s.status);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'ok' | string>();
  const today = account?.earn.day === new Date().toISOString().slice(0, 10) ? account.earn.today : 0;

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setShown(true);
    }
  };

  const restore = async () => {
    setBusy(true);
    setResult(undefined);
    try {
      await useAccount.getState().restore(input);
      setResult('ok');
      setInput('');
      void usePlace.getState().go({ kind: 'personal' });
    } catch (e) {
      setResult(e instanceof TeamApiError ? e.code : 'server');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-lg bg-panel-2 p-3.5 ring-1 ring-line">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[12.5px] font-semibold">{t('account.coins')}</h3>
          <span className="text-[16px] font-bold tabular-nums">🪙 {account ? account.coins.toLocaleString() : '—'}</span>
        </div>
        <p className="mt-1 text-[11.5px] text-muted">{t('howToEarn', { perTurn: EARN.perTurn, cap: EARN.dailyCap })}</p>
        <p className="mt-0.5 text-[11.5px] text-faint">{t('today', { today, cap: EARN.dailyCap })}</p>
        {status !== 'ready' && <p className="mt-2 text-[11.5px] text-coral">{t('offline')}</p>}
      </section>

      <section>
        <h3 className="text-[12.5px] font-semibold">{t('account.codeTitle')}</h3>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{t('account.codeBody')}</p>
        <div className="mt-2 flex items-center gap-1.5">
          <code className="selectable flex-1 rounded-md bg-ink/60 px-2.5 py-1.5 font-mono text-[12.5px] tracking-wider ring-1 ring-line">
            {code ? (shown ? code : code.replace(/[0-9A-Z]/g, '•')) : t('account.creating')}
          </code>
          <button onClick={() => setShown(!shown)} disabled={!code} className="rounded-md px-2.5 py-1.5 text-[12px] ring-1 ring-line hover:bg-panel-3 disabled:opacity-40">
            {shown ? t('account.hide') : t('account.show')}
          </button>
          <button onClick={() => void copy()} disabled={!code} className="rounded-md px-2.5 py-1.5 text-[12px] ring-1 ring-line hover:bg-panel-3 disabled:opacity-40">
            {copied ? t('account.copied') : t('account.copy')}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-amber">⚠ {t('account.codeWarning')}</p>
      </section>

      <section>
        <h3 className="text-[12.5px] font-semibold">{t('account.restoreTitle')}</h3>
        <p className="mt-0.5 text-[11.5px] text-muted">{t('account.restoreBody')}</p>
        <div className="mt-2 flex gap-1.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
            className="selectable flex-1 rounded-md bg-ink/60 px-2.5 py-1.5 font-mono text-[12.5px] tracking-wider uppercase ring-1 ring-line outline-none focus:ring-amber/60"
          />
          <button onClick={() => void restore()} disabled={busy || input.trim().length < 25} className="rounded-md bg-amber px-3 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-40">
            {t('account.restore')}
          </button>
        </div>
        {result && <p className={`mt-1.5 text-[11.5px] ${result === 'ok' ? 'text-leaf' : 'text-coral'}`}>{result === 'ok' ? t('account.restored') : t(`error.${result}`)}</p>}
      </section>
    </div>
  );
}
