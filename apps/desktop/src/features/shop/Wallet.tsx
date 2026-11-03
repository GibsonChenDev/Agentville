import { EARN } from '@agentville/team-protocol';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../../account/accountStore';

/** Coin balance in the office toolbar; flashes "+N" when your agents earn. Opens the shop. */
export function Wallet() {
  const { t } = useTranslation('shop');
  const account = useAccount((s) => s.account);
  const status = useAccount((s) => s.status);
  const gain = useAccount((s) => s.lastGain);
  const [flash, setFlash] = useState<number>();

  useEffect(() => {
    if (!gain || Date.now() - gain.at > 3000) return;
    setFlash(gain.amount);
    const id = setTimeout(() => setFlash(undefined), 1800);
    return () => clearTimeout(id);
  }, [gain]);

  const today = account?.earn.day === new Date().toISOString().slice(0, 10) ? account.earn.today : 0;
  return (
    <button
      data-tour="wallet"
      onClick={() => useAccount.getState().openShop(true)}
      title={account ? t('wallet.title', { today, cap: EARN.dailyCap }) : t('wallet.offline')}
      className="relative flex h-8 items-center gap-1.5 rounded-lg bg-panel/90 px-2.5 text-[12.5px] font-semibold shadow-lg ring-1 ring-line-strong backdrop-blur hover:ring-amber/60"
    >
      <span aria-hidden>🪙</span>
      <span className="tabular-nums">{account ? account.coins.toLocaleString() : status === 'loading' ? '…' : '—'}</span>
      <span className="text-[11px] font-normal text-muted">{t('wallet.shop')}</span>
      {flash !== undefined && <span className="pointer-events-none absolute -top-4 left-2 animate-bounce text-[12px] font-bold text-amber">+{flash}</span>}
    </button>
  );
}
