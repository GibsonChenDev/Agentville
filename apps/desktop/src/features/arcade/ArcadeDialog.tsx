import type { GameId } from '@agentville/team-protocol';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { useAccount } from '../../account/accountStore';
import { usePlayer } from '../../team/playerStore';
import { useTeam } from '../../team/teamStore';
import { GAME_LIST, H, W, type Game, type Input } from './games';

export const useArcade = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

const SCALE = 2;

interface Rank {
  name: string;
  score: number;
  you: boolean;
}

/** Best scores in the team office you're in (you included), highest first. Empty outside a team office. */
function useTeamBoard(): (g: GameId) => Rank[] {
  const members = useTeam((s) => (s.membership ? s.members : undefined));
  const me = useTeam((s) => s.membership?.memberId);
  const mine = useAccount((s) => s.account?.scores);
  const myName = usePlayer((s) => s.name);
  return (g) => {
    if (!members) return [];
    const list: Rank[] = Object.values(members)
      .filter((m) => m.id !== me && (m.scores?.[g] ?? 0) > 0)
      .map((m) => ({ name: m.name, score: m.scores![g]!, you: false }));
    if ((mine?.[g] ?? 0) > 0) list.push({ name: myName, score: mine![g]!, you: true });
    return list.sort((a, b) => b.score - a.score);
  };
}
const GAME_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' ', 'enter']);
/** Letter keys by physical position, so WASD works with a Chinese input method or another layout on. */
const gameKey = (e: KeyboardEvent) => (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.code === 'Space' ? ' ' : e.key.toLowerCase());

/** The arcade cabinet's screen: pick a game, play with keyboard or mouse, best scores kept in your account. */
export function ArcadeDialog() {
  const { t } = useTranslation('arcade');
  const open = useArcade((s) => s.open);
  const scores = useAccount((s) => s.account?.scores);
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [gameId, setGameId] = useState<GameId>();
  const [over, setOver] = useState<{ score: number; best: boolean }>();
  const [round, setRound] = useState(0);
  const board = useTeamBoard();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setGameId(undefined);
      setOver(undefined);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  // Game loop: runs while a game is on screen.
  useEffect(() => {
    if (!open || !gameId) return;
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    const entry = GAME_LIST.find((g) => g.id === gameId);
    if (!c || !ctx || !entry) return;
    ctx.imageSmoothingEnabled = false;
    const game: Game = entry.make();
    const input: Input = { held: new Set(), pressed: new Set(), clicked: false };
    let last = performance.now();
    let raf = 0;
    let ended = false;
    const down = (e: KeyboardEvent) => {
      const k = gameKey(e);
      if (!GAME_KEYS.has(k)) return;
      e.preventDefault();
      if (!input.held.has(k)) input.pressed.add(k);
      input.held.add(k);
    };
    const up = (e: KeyboardEvent) => input.held.delete(gameKey(e));
    const move = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      input.pointerX = ((e.clientX - r.left) / r.width) * W;
    };
    const click = () => {
      input.clicked = true;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerdown', click);
    const frame = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      game.update(dt, input);
      input.pressed.clear();
      input.clicked = false;
      ctx.save();
      ctx.scale(SCALE, SCALE);
      game.draw(ctx, now);
      ctx.restore();
      if (game.over && !ended) {
        ended = true;
        const best = game.score > (useAccount.getState().account?.scores[game.id] ?? 0);
        useAccount.getState().reportScore(game.id, game.score);
        setOver({ score: game.score, best });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerdown', click);
    };
  }, [open, gameId, round]);

  // Enter/Space plays again after game over; Esc goes back to the menu, then closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (over && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        setOver(undefined);
        setRound((r) => r + 1);
      }
      if (e.key === 'Escape' && gameId) {
        e.preventDefault();
        setGameId(undefined);
        setOver(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, over, gameId]);

  const close = () => useArcade.getState().setOpen(false);

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onCancel={(e) => {
        if (gameId) e.preventDefault(); // Esc leaves the game first (handled above)
      }}
      className="m-auto rounded-2xl bg-[#2b1f4a] p-0 text-fg shadow-2xl ring-4 ring-[#5b3f8f] backdrop:bg-black/60"
      aria-labelledby="arcade-title"
    >
      {open && (
        <div className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="arcade-title" className="font-pixel text-[20px] tracking-wider text-amber">
              {gameId ? t(`game.${gameId}.name`) : t('title')}
            </h2>
            <div className="flex gap-2">
              {gameId && (
                <button onClick={() => (setGameId(undefined), setOver(undefined))} className="rounded-md px-2.5 py-1 text-[12px] text-muted ring-1 ring-white/15 hover:text-fg">
                  {t('menu')}
                </button>
              )}
              <button onClick={close} className="rounded-md px-2.5 py-1 text-[12px] text-muted ring-1 ring-white/15 hover:text-fg">
                {t('common:actions.close')}
              </button>
            </div>
          </div>

          {!gameId ? (
            <div className="grid w-[512px] grid-cols-2 gap-3">
              {GAME_LIST.map((g) => (
                <button key={g.id} onClick={() => setGameId(g.id)} className="rounded-xl bg-[#1a1330] p-4 text-left ring-1 ring-white/10 hover:ring-amber/70">
                  <div className="font-pixel text-[18px] text-fg">{t(`game.${g.id}.name`)}</div>
                  <div className="mt-1 text-[12px] text-muted">{t(`game.${g.id}.how`)}</div>
                  <div className="mt-3 text-[11.5px] text-amber">{t('best', { score: scores?.[g.id] ?? 0 })}</div>
                  {board(g.id).length > 0 && (
                    <ol className="mt-2 space-y-0.5 border-t border-white/10 pt-1.5 text-[11px]" aria-label={t('teamBoard')}>
                      {board(g.id)
                        .slice(0, 3)
                        .map((r, i) => (
                          <li key={`${r.name}-${i}`} className={`flex justify-between gap-2 ${r.you ? 'text-amber' : 'text-muted'}`}>
                            <span className="truncate">
                              {['🥇', '🥈', '🥉'][i]} {r.you ? t('you', { name: r.name }) : r.name}
                            </span>
                            <span className="tabular-nums">{r.score.toLocaleString()}</span>
                          </li>
                        ))}
                    </ol>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="relative">
              <canvas ref={canvas} width={W * SCALE} height={H * SCALE} className="pixelated block rounded-lg ring-2 ring-black/50" style={{ width: W * SCALE, height: H * SCALE, cursor: 'none' }} />
              {over && (
                <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/60">
                  <div className="text-center">
                    <div className="font-pixel text-[28px] text-coral">{t('gameOver')}</div>
                    <div className="mt-1 text-[14px]">{t('score', { score: over.score })}</div>
                    {over.best && <div className="mt-1 text-[13px] text-amber">★ {t('newBest')}</div>}
                    {gameId && board(gameId).length > 1 && (
                      <div className="mt-1 text-[12.5px] text-fg">{t('teamRank', { rank: board(gameId).filter((r) => !r.you && r.score > Math.max(over.score, scores?.[gameId] ?? 0)).length + 1, count: board(gameId).length })}</div>
                    )}
                    <div className="mt-3 text-[12px] text-muted">{t('again')}</div>
                  </div>
                </div>
              )}
              <p className="mt-2 text-center text-[11.5px] text-muted">{t(`game.${gameId}.how`)} · {t('escHint')}</p>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
