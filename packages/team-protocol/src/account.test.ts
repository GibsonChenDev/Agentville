import { describe, expect, it } from 'vitest';
import { CATALOG, DICE, EARN, buy, cleanRooms, cleanScores, dieFrom, playDice, earn, generateRecoveryCode, itemById, mergeScores, newAccount, normalizeRecoveryCode, ownedCount, recordScore } from './account';

const T0 = Date.UTC(2026, 10, 3, 9, 0, 0);

describe('recovery codes', () => {
  it('round-trips through sloppy typing', () => {
    let n = 7;
    const code = generateRecoveryCode((k) => Uint8Array.from({ length: k }, () => (n = (n * 131 + 17) % 251)));
    expect(code).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code);
    expect(normalizeRecoveryCode('short')).toBeNull();
  });
});

describe('earning', () => {
  it('starts new accounts with starter coins', () => {
    expect(newAccount('a', T0).coins).toBe(EARN.starter);
  });

  it('pays per turn plus a capped tool bonus', () => {
    const r = earn(newAccount('a', T0), 1, 4, T0);
    expect(r.credited).toBe(EARN.perTurn + 4);
    const big = earn(newAccount('a', T0), 1, 99, T0);
    expect(big.credited).toBe(EARN.perTurn + EARN.maxToolBonus);
  });

  it('limits bursts of turns, refilling over time', () => {
    let doc = newAccount('a', T0);
    const first = earn(doc, 50, 0, T0);
    expect(first.credited).toBe(EARN.turnBurst * EARN.perTurn);
    doc = first.doc;
    expect(earn(doc, 5, 0, T0 + 1000).credited).toBe(0);
    expect(earn(doc, 5, 0, T0 + 2 * EARN.turnEveryMs).credited).toBe(2 * EARN.perTurn);
  });

  it('stops at the daily cap and resets the next day', () => {
    let doc = newAccount('a', T0);
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const r = earn(doc, 1, 10, T0 + i * EARN.turnEveryMs);
      doc = r.doc;
      total += r.credited;
    }
    expect(total).toBe(EARN.dailyCap);
    expect(earn(doc, 1, 0, T0 + 24 * 3600_000).credited).toBe(EARN.perTurn);
  });
});

describe('shop', () => {
  it('buys once, with enough coins', () => {
    const doc = { ...newAccount('a', T0), coins: 1000 };
    const item = CATALOG.find((i) => i.price <= 1000)!;
    const r = buy(doc, item.id);
    expect(r.ok && r.doc.coins).toBe(1000 - item.price);
    expect(r.ok && buy(r.doc, item.id)).toEqual({ ok: false, error: 'owned' });
    expect(buy({ ...doc, coins: 0 }, item.id)).toEqual({ ok: false, error: 'insufficient_funds' });
    expect(buy(doc, 'nope')).toEqual({ ok: false, error: 'unknown_item' });
  });
});

describe('purchase limits', () => {
  it('every item has a sensible per-person limit: looks once, decorations a few copies', () => {
    for (const item of CATALOG) {
      expect(item.max, item.id).toBeGreaterThanOrEqual(1);
      expect(item.max, item.id).toBeLessThanOrEqual(5);
      if (item.kind !== 'furniture') expect(item.max, item.id).toBe(1);
      expect(item.value, item.id).toMatch(/^[a-z0-9_]{1,16}$/); // fits the relay's appearance/furniture shapes
    }
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
    expect(CATALOG.length).toBeGreaterThanOrEqual(40);
  });

  it('decorations can be bought up to their limit, then no more', () => {
    const item = itemById('deco.cactus')!;
    let doc = { ...newAccount('a', T0), coins: 100_000 };
    for (let i = 0; i < item.max; i++) {
      const r = buy(doc, item.id);
      if (!r.ok) throw new Error(r.error);
      doc = r.doc;
    }
    expect(ownedCount(doc.inventory, item.id)).toBe(item.max);
    expect(buy(doc, item.id)).toEqual({ ok: false, error: 'limit_reached' });
    expect(doc.coins).toBe(100_000 - item.max * item.price);
  });

  it('one-of-a-kind decorations and looks say "owned" on a second try', () => {
    let doc = { ...newAccount('a', T0), coins: 100_000 };
    for (const id of ['deco.piano', 'acc.halo', 'color.sakura']) {
      const r = buy(doc, id);
      if (!r.ok) throw new Error(r.error);
      doc = r.doc;
      expect(buy(doc, id)).toEqual({ ok: false, error: 'owned' });
    }
  });
});

describe('rooms and scores', () => {
  it('shares only valid scores, keeping the better one per game', () => {
    expect(cleanScores({ snake: 3, g2048: 0 })).toEqual({ snake: 3, g2048: 0 });
    expect(cleanScores({ snake: -1 })).toBeNull();
    expect(cleanScores({ tetris: 1 })).toBeNull();
    expect(cleanScores(null)).toBeNull();
    expect(mergeScores({ snake: 10, flappy: 4 }, { snake: 7, breakout: 2 })).toEqual({ snake: 10, flappy: 4, breakout: 2 });
  });

  it('validates stored team offices', () => {
    const ok = { roomId: 'a'.repeat(32), memberId: 'b'.repeat(16), token: 'C'.repeat(43), owner: true, name: 'App team' };
    expect(cleanRooms([ok])).toEqual([ok]);
    expect(cleanRooms([{ ...ok, token: 'short' }])).toBeNull();
  });

  it('keeps best scores only', () => {
    const doc = newAccount('a', T0);
    const a = recordScore(doc, 'snake', 30)!;
    expect(recordScore(a, 'snake', 10)!.scores.snake).toBe(30);
    expect(recordScore(a, 'chess', 10)).toBeNull();
    expect(recordScore(a, 'snake', 1.5)).toBeNull();
  });
});

describe('dice table', () => {
  const fixed = (...faces: number[]) => {
    let i = 0;
    return () => faces[i++ % faces.length]!;
  };
  const rich = () => ({ ...newAccount('a', T0), coins: 1000 });

  it('big/small pays 1:1, and any triple goes to the house', () => {
    const big = playDice(rich(), 'bigsmall', 10, 'big', fixed(6, 5, 1), T0);
    expect(big.ok && big.result).toMatchObject({ dice: [6, 5, 1], outcome: 'win', delta: 10 });
    expect(big.ok && big.doc.coins).toBe(1010);
    const small = playDice(rich(), 'bigsmall', 5, 'big', fixed(1, 2, 3), T0);
    expect(small.ok && small.result).toMatchObject({ outcome: 'lose', delta: -5 });
    const triple = playDice(rich(), 'bigsmall', 5, 'big', fixed(5, 5, 5), T0);
    expect(triple.ok && triple.result.outcome).toBe('lose');
  });

  it('dice duel: higher total wins, a tie is a push', () => {
    expect(playDice(rich(), 'duel', 2, undefined, fixed(6, 6, 1, 1), T0)).toMatchObject({ ok: true, result: { outcome: 'win', delta: 2 } });
    expect(playDice(rich(), 'duel', 2, undefined, fixed(1, 1, 6, 6), T0)).toMatchObject({ ok: true, result: { outcome: 'lose', delta: -2 } });
    expect(playDice(rich(), 'duel', 2, undefined, fixed(3, 4, 5, 2), T0)).toMatchObject({ ok: true, result: { outcome: 'push', delta: 0 }, doc: { coins: 1000 } });
  });

  it('only allows tiny bets', () => {
    for (const bet of [0, 3, 11, 100, -5, 1.5, '10']) expect(playDice(rich(), 'duel', bet, undefined, fixed(1), T0)).toEqual({ ok: false, error: 'bad_request' });
    expect(playDice(rich(), 'bigsmall', 1, 'huge', fixed(1), T0)).toEqual({ ok: false, error: 'bad_request' });
    expect(playDice(rich(), 'roulette', 1, 'big', fixed(1), T0)).toEqual({ ok: false, error: 'bad_request' });
    expect(playDice({ ...rich(), coins: 4 }, 'duel', 5, undefined, fixed(1), T0)).toEqual({ ok: false, error: 'insufficient_funds' });
  });

  it('caps a day of winning and a day of losing, then resets the next day', () => {
    const play = (lucky: boolean) => {
      let doc = rich();
      let t = T0;
      let rounds = 0;
      for (;;) {
        const r = playDice(doc, 'duel', 10, undefined, lucky ? fixed(6, 6, 1, 1) : fixed(1, 1, 6, 6), (t += DICE.everyMs));
        if (!r.ok) return { doc, rounds, error: r.error, t };
        doc = r.doc;
        rounds++;
      }
    };
    const won = play(true);
    expect(won).toMatchObject({ error: 'daily_limit', rounds: DICE.dailyWinCap / 10 });
    expect(won.doc.coins).toBe(1000 + DICE.dailyWinCap);
    const lost = play(false);
    expect(lost.doc.coins).toBe(1000 - DICE.dailyLossCap);
    expect(playDice(lost.doc, 'duel', 10, undefined, fixed(6, 6, 1, 1), lost.t + 24 * 3600_000).ok).toBe(true);
  });

  it('limits how fast you can roll', () => {
    const first = playDice(rich(), 'duel', 1, undefined, fixed(3, 4, 5, 2), T0);
    if (!first.ok) throw new Error(first.error);
    expect(playDice(first.doc, 'duel', 1, undefined, fixed(1), T0 + 100)).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('server dice are fair faces 1–6', () => {
    let n = 0;
    const die = dieFrom((k) => Uint8Array.from({ length: k }, () => n++ % 256));
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 252 * 4; i++) counts[die() - 1]!++;
    expect(counts.every((c) => c === counts[0])).toBe(true);
  });
});
