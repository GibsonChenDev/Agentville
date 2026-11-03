import { DICE, type DiceGame, type DicePick, type DiceResult } from '@agentville/team-protocol';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { useAccount } from '../../account/accountStore';
import { TeamApiError } from '../../team/api';

export const useDice = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

/** Shortest time the dice tumble, so a fast server still feels like a roll. */
const ROLL_MS = 700;
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function Die({ face, tumbling }: { face: number; tumbling?: boolean }) {
  return (
    <div className={`grid h-11 w-11 grid-cols-3 grid-rows-3 gap-0.5 rounded-lg bg-[#fbf7ef] p-1.5 shadow ring-1 ring-black/30 ${tumbling ? 'rotate-12' : ''}`} aria-label={String(face)}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`m-auto h-2 w-2 rounded-full ${PIPS[face]?.includes(i) ? (face === 1 || face === 4 ? 'bg-[#d33a3a]' : 'bg-[#231d2b]') : ''}`} />
      ))}
    </div>
  );
}

const randomFace = () => 1 + Math.floor(Math.random() * 6);
const total = (d: number[]) => d.reduce((a, b) => a + b, 0);

/** The dice table: big/small or a dice duel against the dealer, for a coin or ten at a time. */
export function DiceDialog() {
  const { t } = useTranslation('arcade');
  const open = useDice((s) => s.open);
  const account = useAccount((s) => s.account);
  const status = useAccount((s) => s.status);
  const dialog = useRef<HTMLDialogElement>(null);
  const [game, setGame] = useState<DiceGame>('bigsmall');
  const [bet, setBet] = useState<number>(DICE.bets[0]!);
  const [pick, setPick] = useState<DicePick>('big');
  const [rolling, setRolling] = useState(false);
  const [faces, setFaces] = useState<number[]>([3, 4, 5]);
  const [dealer, setDealer] = useState<number[]>([2, 6]);
  const [result, setResult] = useState<DiceResult>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setResult(undefined);
      setError(undefined);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => useDice.getState().setOpen(false);
  const today = new Date().toISOString().slice(0, 10);
  const net = account?.dice?.day === today ? account.dice.net : 0;
  const count = game === 'bigsmall' ? 3 : 2;

  const roll = async () => {
    setRolling(true);
    setResult(undefined);
    setError(undefined);
    const tumble = setInterval(() => {
      setFaces(Array.from({ length: count }, randomFace));
      setDealer([randomFace(), randomFace()]);
    }, 80);
    try {
      const [r] = await Promise.all([useAccount.getState().playDice(game, bet, game === 'bigsmall' ? pick : undefined), new Promise((ok) => setTimeout(ok, ROLL_MS))]);
      clearInterval(tumble);
      setFaces(r.dice);
      if (r.dealer) setDealer(r.dealer);
      setResult(r);
    } catch (e) {
      clearInterval(tumble);
      setError(e instanceof TeamApiError ? e.code : 'server');
    } finally {
      setRolling(false);
    }
  };

  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  const choose = (g: DiceGame) => {
    setGame(g);
    setResult(undefined);
    setFaces(Array.from({ length: g === 'bigsmall' ? 3 : 2 }, (_, i) => i + 3));
  };

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onClick={(e) => e.target === dialog.current && close()}
      className="m-auto w-[440px] max-w-[95vw] rounded-2xl bg-[#173d2b] p-0 text-fg shadow-2xl ring-4 ring-[#6e3f26] backdrop:bg-black/60"
      aria-labelledby="dice-title"
    >
      {open && (
        <div className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="dice-title" className="font-pixel text-[20px] tracking-wider text-amber">
              🎲 {t('dice.title')}
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-bold tabular-nums">🪙 {account ? account.coins.toLocaleString() : '—'}</span>
              <button onClick={close} className="rounded-md px-2.5 py-1 text-[12px] text-muted ring-1 ring-white/15 hover:text-fg">
                {t('common:actions.close')}
              </button>
            </div>
          </div>

          <div className="mb-3 flex gap-1" role="tablist">
            {(['bigsmall', 'duel'] as const).map((g) => (
              <button
                key={g}
                role="tab"
                aria-selected={game === g}
                disabled={rolling}
                onClick={() => choose(g)}
                className={`flex-1 rounded-md px-3 py-1.5 text-[13px] ${game === g ? 'bg-[#0f2a1d] text-amber ring-1 ring-amber/60' : 'text-muted ring-1 ring-white/10 hover:text-fg'}`}
              >
                {t(`dice.${g}`)}
              </button>
            ))}
          </div>
          <p className="mb-3 text-[12px] text-muted">{t(game === 'bigsmall' ? 'dice.bigsmallHow' : 'dice.duelHow')}</p>

          <div className="mb-3 rounded-xl bg-[#0f2a1d] p-3 ring-1 ring-white/10">
            {game === 'duel' && (
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] text-muted">{t('dice.dealer')}</span>
                <div className="flex gap-2">
                  {dealer.map((f, i) => (
                    <Die key={i} face={f} tumbling={rolling} />
                  ))}
                </div>
                <span className="w-8 text-right text-[13px] tabular-nums">{result ? total(dealer) : ''}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-muted">{t('dice.you')}</span>
              <div className="flex gap-2">
                {faces.map((f, i) => (
                  <Die key={i} face={f} tumbling={rolling} />
                ))}
              </div>
              <span className="w-8 text-right text-[13px] tabular-nums">{result ? total(faces) : ''}</span>
            </div>
            <div className="mt-2 h-5 text-center text-[14px] font-semibold" role="status">
              {rolling ? (
                <span className="text-muted">{t('dice.rolling')}</span>
              ) : result ? (
                <span className={result.outcome === 'win' ? 'text-[#7dff9a]' : result.outcome === 'lose' ? 'text-coral' : 'text-fg'}>
                  {result.outcome === 'push' ? t('dice.push') : t(`dice.${result.outcome}`, { n: Math.abs(result.delta) })}
                </span>
              ) : null}
            </div>
          </div>

          {game === 'bigsmall' && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              {(['small', 'big'] as const).map((p) => (
                <button
                  key={p}
                  disabled={rolling}
                  onClick={() => setPick(p)}
                  aria-pressed={pick === p}
                  className={`rounded-lg py-2 text-[18px] font-bold ${pick === p ? 'bg-amber text-ink' : 'bg-[#0f2a1d] text-fg ring-1 ring-white/15 hover:ring-amber/50'}`}
                >
                  {t(`dice.${p}`)}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted">{t('dice.bet')}</span>
            {DICE.bets.map((b) => (
              <button
                key={b}
                disabled={rolling}
                onClick={() => setBet(b)}
                aria-pressed={bet === b}
                className={`h-9 w-9 rounded-full text-[12px] font-bold ring-2 ${bet === b ? 'bg-amber text-ink ring-amber' : 'bg-[#0f2a1d] text-fg ring-white/20 hover:ring-amber/50'}`}
              >
                {b}
              </button>
            ))}
            <button
              onClick={() => void roll()}
              disabled={rolling || status !== 'ready' || !account || account.coins < bet}
              className="ml-auto rounded-lg bg-coral px-4 py-2 text-[14px] font-bold text-ink disabled:bg-panel-3 disabled:text-faint"
            >
              {t('dice.roll')}
            </button>
          </div>

          <div className="mt-3 text-[12px] tabular-nums text-fg">{t('dice.today', { net: signed(net), cap: DICE.dailyWinCap })}</div>
          {error && (
            <p className="mt-1 text-[12px] text-coral" role="alert">
              {t(`dice.error.${error}`, { defaultValue: t('dice.error.server') })}
            </p>
          )}
          {status !== 'ready' && <p className="mt-1 text-[12px] text-coral">{t('dice.offline')}</p>}
          <p className="mt-2 text-[11px] leading-snug text-faint">{t('dice.note', { bets: DICE.bets.join(' / '), cap: DICE.dailyWinCap })}</p>
        </div>
      )}
    </dialog>
  );
}
