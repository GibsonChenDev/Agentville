import { describe, expect, it } from 'vitest';
import { CATALOG, EARN, buy, cleanRooms, earn, generateRecoveryCode, newAccount, normalizeRecoveryCode, recordScore } from './account';

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

describe('rooms and scores', () => {
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
