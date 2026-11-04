import { cleanAppearance, cleanName, type Appearance, type Scores } from './index';

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

export type ItemKind = 'accessory' | 'color' | 'furniture' | 'map';

export interface CatalogItem {
  id: string;
  kind: ItemKind;
  /** Accessory id, outfit colour id, furniture kind or office theme it unlocks. */
  value: string;
  price: number;
  /**
   * How many one person may own. Looks are worn, so one is enough; decorations
   * can be bought a few times (each copy is one piece placed in an office).
   */
  max: number;
}

const look = (kind: 'accessory' | 'color', value: string, price: number): CatalogItem => ({ id: `${kind === 'accessory' ? 'acc' : 'color'}.${value}`, kind, value, price, max: 1 });
const deco = (value: string, price: number, max: number): CatalogItem => ({ id: `deco.${value}`, kind: 'furniture', value, price, max });
const map = (value: string, price: number): CatalogItem => ({ id: `map.${value}`, kind: 'map', value, price, max: 1 });

/** Everything that can be bought. Basic looks and furniture stay free. */
export const CATALOG: readonly CatalogItem[] = [
  look('accessory', 'flower', 150),
  look('accessory', 'bow', 160),
  look('accessory', 'sunglasses', 220),
  look('accessory', 'party_hat', 240),
  look('accessory', 'heart_glasses', 280),
  look('accessory', 'cat_ears', 300),
  look('accessory', 'bunny_ears', 320),
  look('accessory', 'chef_hat', 360),
  look('accessory', 'santa_hat', 380),
  look('accessory', 'antenna', 420),
  look('accessory', 'cowboy_hat', 420),
  look('accessory', 'devil_horns', 450),
  look('accessory', 'pirate_hat', 480),
  look('accessory', 'wizard_hat', 500),
  look('accessory', 'top_hat', 550),
  look('accessory', 'viking', 650),
  look('accessory', 'halo', 750),
  look('accessory', 'crown', 900),
  look('color', 'sakura', 220),
  look('color', 'mint', 220),
  look('color', 'sky', 240),
  look('color', 'lavender', 260),
  look('color', 'neon', 300),
  look('color', 'ruby', 320),
  look('color', 'onyx', 350),
  look('color', 'gold', 450),
  deco('cactus', 80, 5),
  deco('sunflower', 90, 5),
  deco('bonsai', 110, 5),
  deco('lava_lamp', 120, 5),
  deco('gumball', 140, 3),
  deco('globe', 180, 3),
  deco('guitar', 220, 2),
  deco('trophy', 250, 3),
  deco('popcorn', 260, 2),
  deco('telescope', 260, 2),
  deco('dino', 280, 3),
  deco('cat', 350, 2),
  deco('dog', 380, 2),
  deco('christmas_tree', 400, 2),
  deco('fridge', 420, 2),
  deco('vending', 480, 2),
  deco('jukebox', 500, 1),
  deco('robot', 600, 2),
  deco('claw_machine', 600, 1),
  deco('aquarium', 650, 2),
  deco('treadmill', 700, 2),
  deco('hammock', 750, 1),
  deco('fireplace', 800, 1),
  deco('ping_pong', 900, 1),
  deco('piano', 1200, 1),
  deco('dice_table', 300, 2),
  map('sakura', 2000),
  map('space', 2500),
];

/** How many of `itemId` this inventory holds (decorations can be owned more than once). */
export const ownedCount = (inventory: readonly string[] | undefined, itemId: string) => inventory?.filter((i) => i === itemId).length ?? 0;

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

// ───────────────────────────────── dice table

/**
 * Small-stakes dice games at the dice table. The server rolls. Bets are tiny and
 * each day's net result is capped both ways, so nobody gets rich or goes broke
 * at the table — it's a toy, and the coins only buy things in this app.
 */
export const DICE = {
  bets: [1, 2, 5, 10] as readonly number[],
  /** Stop playing for the day once up this much... */
  dailyWinCap: 100,
  /** ...or down this much. */
  dailyLossCap: 100,
  /** One roll per this many ms. */
  everyMs: 1200,
} as const;

/** `bigsmall` (壓大小): three dice, 4–10 small, 11–17 big, any triple goes to the house. `duel` (比點數): two dice each against the dealer, higher wins, a tie is a push. */
export const DICE_GAMES = ['bigsmall', 'duel'] as const;
export type DiceGame = (typeof DICE_GAMES)[number];
export type DicePick = 'big' | 'small';

export interface DiceResult {
  game: DiceGame;
  bet: number;
  pick?: DicePick;
  dice: number[];
  /** The dealer's dice in a duel. */
  dealer?: number[];
  outcome: 'win' | 'lose' | 'push';
  /** Coins won (positive) or lost (negative). */
  delta: number;
}

export type DiceError = 'bad_request' | 'insufficient_funds' | 'daily_limit' | 'rate_limited';

const sum = (d: number[]) => d.reduce((a, b) => a + b, 0);

/** Plays one round. `roll` returns a fair die face 1–6. */
export function playDice(doc: AccountDoc, game: unknown, bet: unknown, pick: unknown, roll: () => number, now: number): { ok: true; doc: AccountDoc; result: DiceResult } | { ok: false; error: DiceError } {
  if (!(DICE_GAMES as readonly unknown[]).includes(game) || !DICE.bets.includes(bet as number)) return { ok: false, error: 'bad_request' };
  if (game === 'bigsmall' && pick !== 'big' && pick !== 'small') return { ok: false, error: 'bad_request' };
  const stake = bet as number;
  const today = day(now);
  const d = doc.dice?.day === today ? doc.dice : { day: today, net: 0, at: 0 };
  if (now - d.at < DICE.everyMs) return { ok: false, error: 'rate_limited' };
  if (d.net + stake > DICE.dailyWinCap || -d.net + stake > DICE.dailyLossCap) return { ok: false, error: 'daily_limit' };
  if (doc.coins < stake) return { ok: false, error: 'insufficient_funds' };
  let result: DiceResult;
  if (game === 'bigsmall') {
    const dice = [roll(), roll(), roll()];
    const triple = dice[0] === dice[1] && dice[1] === dice[2];
    const big = sum(dice) >= 11;
    const win = !triple && (pick === 'big') === big;
    result = { game, bet: stake, pick: pick as DicePick, dice, outcome: win ? 'win' : 'lose', delta: win ? stake : -stake };
  } else {
    const dice = [roll(), roll()];
    const dealer = [roll(), roll()];
    const diff = sum(dice) - sum(dealer);
    result = { game: 'duel', bet: stake, dice, dealer, outcome: diff > 0 ? 'win' : diff < 0 ? 'lose' : 'push', delta: Math.sign(diff) * stake };
  }
  return { ok: true, doc: { ...doc, coins: doc.coins + result.delta, dice: { day: today, net: d.net + result.delta, at: now } }, result };
}

/** A fair die face from random bytes (rejection sampling, so every face is equally likely). */
export function dieFrom(random: (n: number) => Uint8Array): () => number {
  return () => {
    for (;;) {
      const b = random(1)[0]!;
      if (b < 252) return (b % 6) + 1;
    }
  };
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
  /** Today's net result at the dice table and when the last roll was (absent until first played). */
  dice?: { day: string; net: number; at: number };
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

export type BuyResult = { ok: true; doc: AccountDoc } | { ok: false; error: 'unknown_item' | 'owned' | 'limit_reached' | 'insufficient_funds' };

export function buy(doc: AccountDoc, itemId: string): BuyResult {
  const item = itemById(itemId);
  if (!item) return { ok: false, error: 'unknown_item' };
  if (ownedCount(doc.inventory, item.id) >= item.max) return { ok: false, error: item.max === 1 ? 'owned' : 'limit_reached' };
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

const MAX_SCORE = 10_000_000;
const isScore = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_SCORE;

/** Best scores as shared with a team office: known games only, whole numbers in range. */
export function cleanScores(v: unknown): Scores | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Scores = {};
  for (const [game, score] of Object.entries(v)) {
    if (!(GAMES as readonly string[]).includes(game) || !isScore(score)) return null;
    out[game as GameId] = score;
  }
  return out;
}

/** The better of two sets of best scores, game by game. */
export function mergeScores(a: Scores | undefined, b: Scores): Scores {
  const out: Scores = { ...a };
  for (const [game, score] of Object.entries(b) as [GameId, number][]) if (score > (out[game] ?? 0)) out[game] = score;
  return out;
}

/** Keeps a better score; rejects impossible ones. */
export function recordScore(doc: AccountDoc, game: string, score: unknown): AccountDoc | null {
  if (!(GAMES as readonly string[]).includes(game) || !isScore(score)) return null;
  const best = doc.scores[game as GameId] ?? 0;
  if ((score as number) <= best) return doc;
  return { ...doc, scores: { ...doc.scores, [game]: score as number } };
}
