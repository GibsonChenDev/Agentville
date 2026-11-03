import { cleanAppearance, cleanName, type Appearance } from './index';

/**
 * Accounts without sign-up: the server creates an account and hands back a
 * recovery code, which is also the account's only credential. Typing the code
 * on another computer restores everything: character, coins, purchases, team
 * offices and arcade best scores.
 */

// ───────────────────────────────── recovery codes

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY = /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/;

/** 25 symbols = 125 bits, e.g. `7K3PQ-9M2XA-...`. Unguessable, so no rate limit is needed to protect it. */
export function generateRecoveryCode(random: (n: number) => Uint8Array): string {
  const bytes = random(25);
  let s = '';
  for (const b of bytes) s += ALPHABET[b & 31];
  return s.match(/.{5}/g)!.join('-');
}

export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s_-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 25) return null;
  const code = s.match(/.{5}/g)!.join('-');
  return RECOVERY.test(code) ? code : null;
}

// ───────────────────────────────── shop

export type ItemKind = 'accessory' | 'color' | 'furniture';

export interface CatalogItem {
  id: string;
  kind: ItemKind;
  /** Accessory id, outfit colour id or furniture kind it unlocks. */
  value: string;
  price: number;
}

/** Everything that can be bought. Basic looks and furniture stay free. */
export const CATALOG: readonly CatalogItem[] = [
  { id: 'acc.flower', kind: 'accessory', value: 'flower', price: 150 },
  { id: 'acc.cat_ears', kind: 'accessory', value: 'cat_ears', price: 300 },
  { id: 'acc.wizard_hat', kind: 'accessory', value: 'wizard_hat', price: 500 },
  { id: 'acc.crown', kind: 'accessory', value: 'crown', price: 900 },
  { id: 'color.neon', kind: 'color', value: 'neon', price: 300 },
  { id: 'color.gold', kind: 'color', value: 'gold', price: 450 },
  { id: 'deco.lava_lamp', kind: 'furniture', value: 'lava_lamp', price: 120 },
  { id: 'deco.trophy', kind: 'furniture', value: 'trophy', price: 250 },
  { id: 'deco.cat', kind: 'furniture', value: 'cat', price: 350 },
  { id: 'deco.jukebox', kind: 'furniture', value: 'jukebox', price: 500 },
  { id: 'deco.aquarium', kind: 'furniture', value: 'aquarium', price: 650 },
];

export const itemById = (id: string) => CATALOG.find((i) => i.id === id);
/** The catalog item that unlocks a given accessory / colour / furniture, if it isn't free. */
export const itemFor = (kind: ItemKind, value: string) => CATALOG.find((i) => i.kind === kind && i.value === value);

// ───────────────────────────────── earning

export const EARN = {
  /** Coins for each completed agent turn (Claude Code's Stop event). */
  perTurn: 10,
  /** Bonus per tool the agent used during the turn, up to `maxToolBonus`. */
  perTool: 1,
  maxToolBonus: 10,
  dailyCap: 500,
  /** Turns are credited at most this often on average (token bucket), so forged events can't farm coins. */
  turnEveryMs: 15_000,
  turnBurst: 10,
  starter: 200,
} as const;

export const GAMES = ['snake', 'breakout', 'flappy', 'g2048'] as const;
export type GameId = (typeof GAMES)[number];

export interface RoomRef {
  roomId: string;
  memberId: string;
  token: string;
  owner: boolean;
  name: string;
}

export interface Profile {
  name: string;
  appearance: Appearance;
}

export interface AccountDoc {
  id: string;
  createdAt: number;
  profile: Profile | null;
  coins: number;
  inventory: string[];
  rooms: RoomRef[];
  scores: Partial<Record<GameId, number>>;
  earn: { day: string; today: number; bucket: number; at: number };
}

/** What the app sees; the same as the stored document minus nothing secret (the code isn't stored). */
export type AccountView = AccountDoc;

const day = (now: number) => new Date(now).toISOString().slice(0, 10);

export function newAccount(id: string, now: number): AccountDoc {
  return { id, createdAt: now, profile: null, coins: EARN.starter, inventory: [], rooms: [], scores: {}, earn: { day: day(now), today: 0, bucket: EARN.turnBurst, at: now } };
}

/** Credits completed turns (and their tool use), within the spacing and daily limits. */
export function earn(doc: AccountDoc, turns: number, tools: number, now: number): { doc: AccountDoc; credited: number } {
  const e = { ...doc.earn };
  if (e.day !== day(now)) {
    e.day = day(now);
    e.today = 0;
  }
  e.bucket = Math.min(EARN.turnBurst, e.bucket + Math.max(0, now - e.at) / EARN.turnEveryMs);
  e.at = now;
  const t = Math.max(0, Math.min(Math.floor(turns), Math.floor(e.bucket)));
  e.bucket -= t;
  const bonus = t ? Math.min(Math.max(0, Math.floor(tools)), EARN.maxToolBonus * t) * EARN.perTool : 0;
  const credited = Math.max(0, Math.min(t * EARN.perTurn + bonus, EARN.dailyCap - e.today));
  e.today += credited;
  return { doc: { ...doc, coins: doc.coins + credited, earn: e }, credited };
}

export type BuyResult = { ok: true; doc: AccountDoc } | { ok: false; error: 'unknown_item' | 'owned' | 'insufficient_funds' };

export function buy(doc: AccountDoc, itemId: string): BuyResult {
  const item = itemById(itemId);
  if (!item) return { ok: false, error: 'unknown_item' };
  if (doc.inventory.includes(item.id)) return { ok: false, error: 'owned' };
  if (doc.coins < item.price) return { ok: false, error: 'insufficient_funds' };
  return { ok: true, doc: { ...doc, coins: doc.coins - item.price, inventory: [...doc.inventory, item.id] } };
}

export function cleanProfile(v: unknown): Profile | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const name = cleanName(r.name);
  const appearance = cleanAppearance(r.appearance);
  return name !== null && appearance ? { name, appearance } : null;
}

const HEX = (n: number) => new RegExp(`^[a-f0-9]{${n}}$`);

export function cleanRooms(v: unknown): RoomRef[] | null {
  if (!Array.isArray(v) || v.length > 20) return null;
  const out: RoomRef[] = [];
  for (const r of v) {
    if (!r || typeof r !== 'object') return null;
    const x = r as Record<string, unknown>;
    const name = cleanName(x.name, 40);
    if (typeof x.roomId !== 'string' || !HEX(32).test(x.roomId) || typeof x.memberId !== 'string' || !HEX(16).test(x.memberId)) return null;
    if (typeof x.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(x.token) || !name) return null;
    out.push({ roomId: x.roomId, memberId: x.memberId, token: x.token, owner: x.owner === true, name });
  }
  return out;
}

/** Keeps a better score; rejects impossible ones. */
export function recordScore(doc: AccountDoc, game: string, score: unknown): AccountDoc | null {
  if (!(GAMES as readonly string[]).includes(game) || !Number.isInteger(score) || (score as number) < 0 || (score as number) > 10_000_000) return null;
  const best = doc.scores[game as GameId] ?? 0;
  if ((score as number) <= best) return doc;
  return { ...doc, scores: { ...doc.scores, [game]: score as number } };
}
