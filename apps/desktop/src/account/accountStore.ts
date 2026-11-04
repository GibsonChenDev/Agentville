import { appearanceFromSeed, sanitizeAppearance, type CharacterAppearance } from '@agentville/domain';
import { itemFor, normalizeRecoveryCode, ownedCount, type AccountView, type ApiErrorCode, type DiceGame, type DicePick, type DiceResult, type GameId, type ItemKind, type RoomRef } from '@agentville/team-protocol';
import { create } from 'zustand';
import { TeamApiError, normalizeServer } from '../team/api';
import { usePlayer } from '../team/playerStore';
import { useTeam } from '../team/teamStore';

/**
 * Your account on the relay: no sign-up, just a recovery code. It keeps your
 * character, coins, purchases, team offices and arcade best scores, so typing
 * the code on another computer brings everything back.
 */
export type AccountStatus = 'idle' | 'loading' | 'ready' | 'offline';

interface AccountState {
  code?: string;
  account?: AccountView;
  status: AccountStatus;
  error?: TeamApiError['code'];
  shopOpen: boolean;
  /** Last coin gain, for the wallet's "+N" flash. */
  lastGain?: { amount: number; at: number };
  start: () => Promise<void>;
  restore: (code: string) => Promise<void>;
  buy: (itemId: string) => Promise<void>;
  saveProfile: (name: string, appearance: CharacterAppearance) => void;
  saveRooms: (rooms: RoomRef[]) => void;
  reportScore: (game: GameId, score: number) => void;
  earn: (turns: number, tools: number) => Promise<number>;
  /** One round at the dice table; the server rolls and settles the coins. */
  playDice: (game: DiceGame, bet: number, pick?: DicePick) => Promise<DiceResult>;
  openShop: (open: boolean) => void;
}

const KEY = 'agentville.account.v1';

function loadCode(): string | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (normalizeRecoveryCode(raw) ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

function saveCode(code: string) {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // storage unavailable: the code is shown in Settings so it can be written down
  }
}

const server = () => normalizeServer(useTeam.getState().server);

async function request<T>(method: 'GET' | 'POST', path: string, code?: string, body?: unknown): Promise<T> {
  const base = server();
  if (!base) throw new TeamApiError('no_server');
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(code ? { Authorization: `Bearer ${code}` } : {}) },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new TeamApiError('network');
  }
  const data = (await res.json().catch(() => null)) as ({ error?: ApiErrorCode } & T) | null;
  if (!res.ok) throw new TeamApiError(data?.error ?? 'server');
  return data as T;
}

/** Brings the local character and team offices in line with the account (the account wins when it has data). */
function adopt(account: AccountView) {
  const player = usePlayer.getState();
  if (account.profile) {
    const appearance = sanitizeAppearance(account.profile.appearance, player.appearance ?? appearanceFromSeed(account.id));
    if (account.profile.name !== player.name || JSON.stringify(appearance) !== JSON.stringify(player.appearance)) usePlayer.getState().save(account.profile.name, appearance, { sync: false });
  } else if (player.name) useAccount.getState().saveProfile(player.name, player.appearance);
  const local = useTeam.getState().rooms;
  const merged = [...account.rooms, ...local.filter((r) => !account.rooms.some((a) => a.roomId === r.roomId))];
  if (merged.length !== local.length || merged.some((r, i) => r.roomId !== local[i]?.roomId)) useTeam.getState().setRooms(merged, { sync: false });
  if (merged.length !== account.rooms.length) useAccount.getState().saveRooms(merged);
}

/** The one in-flight start, so a double mount can't create two accounts. */
let starting: Promise<void> | undefined;

export const useAccount = create<AccountState>((set, get) => {
  /** Fire-and-forget account write; the response is the new account. */
  const write = (path: string, body: unknown) => {
    const { code } = get();
    if (!code) return;
    request<{ account: AccountView }>('POST', `/v1/me/${path}`, code, body)
      .then((r) => set({ account: r.account, status: 'ready' }))
      .catch(() => set({ status: 'offline' }));
  };

  return {
    code: loadCode(),
    status: 'idle',
    shopOpen: false,

    start: () => {
      if (get().status === 'ready') return Promise.resolve();
      starting ??= (async () => {
        set({ status: 'loading', error: undefined });
        try {
          let { code } = get();
          if (!code) {
            const created = await request<{ code: string; account: AccountView }>('POST', '/v1/accounts');
            code = created.code;
            saveCode(code);
            set({ code });
          }
          const { account } = await request<{ account: AccountView }>('GET', '/v1/me', code);
          set({ account, status: 'ready' });
          adopt(account);
        } catch (e) {
          set({ status: 'offline', error: e instanceof TeamApiError ? e.code : 'network' });
          // Try again in a minute; everything keeps working locally meanwhile.
          setTimeout(() => {
            if (get().status !== 'ready') void get().start();
          }, 60_000);
        } finally {
          starting = undefined;
        }
      })();
      return starting;
    },

    restore: async (input) => {
      const code = normalizeRecoveryCode(input);
      if (!code) throw new TeamApiError('unauthorized');
      const { account } = await request<{ account: AccountView }>('GET', '/v1/me', code);
      saveCode(code);
      set({ code, account, status: 'ready', error: undefined });
      // A different account: its team offices replace this computer's.
      useTeam.getState().setRooms(account.rooms, { sync: false });
      adopt(account);
    },

    buy: async (itemId) => {
      const { code } = get();
      if (!code) throw new TeamApiError('unauthorized');
      const { account } = await request<{ account: AccountView }>('POST', '/v1/me/buy', code, { item: itemId });
      set({ account });
    },

    saveProfile: (name, appearance) => {
      if (name) write('profile', { name, appearance: { ...appearance } });
    },

    saveRooms: (rooms) => write('rooms', { rooms }),

    reportScore: (game, score) => {
      const best = get().account?.scores[game] ?? 0;
      if (score > best) write('score', { game, score });
    },

    earn: async (turns, tools) => {
      const { code } = get();
      if (!code || get().status !== 'ready') return 0;
      const r = await request<{ account: AccountView; credited: number }>('POST', '/v1/me/earn', code, { turns, tools });
      set({ account: r.account, ...(r.credited ? { lastGain: { amount: r.credited, at: Date.now() } } : {}) });
      return r.credited;
    },

    playDice: async (game, bet, pick) => {
      const { code } = get();
      if (!code) throw new TeamApiError('unauthorized');
      const r = await request<{ account: AccountView; result: DiceResult }>('POST', '/v1/me/dice', code, { game, bet, pick });
      set({ account: r.account });
      return r.result;
    },

    openShop: (shopOpen) => set({ shopOpen }),
  };
});

/** Is this look option or furniture free, or already bought? */
export function owns(inventory: readonly string[] | undefined, kind: ItemKind, value: string): boolean {
  const item = itemFor(kind, value);
  return !item || !!inventory?.includes(item.id);
}

/**
 * How many copies of a shop decoration you may still put in the office you're
 * editing: owned copies minus the ones already placed. In your own office every
 * copy is yours; in a team office only the pieces tagged with your account count,
 * so teammates' purchases don't use up yours. Null for free furniture.
 */
export function placementAllowance(inventory: readonly string[] | undefined, kind: string, placed: (owner?: string) => number, shared: boolean, owner?: string) {
  const item = itemFor('furniture', kind);
  if (!item) return null;
  const owned = ownedCount(inventory, item.id);
  const used = shared ? (owner ? placed(owner) : owned) : placed();
  return { owned, used, left: Math.max(0, owned - used) };
}

/** Short, non-secret tag for furniture you place (the start of your account id). */
export const ownerTag = (accountId: string | undefined) => (accountId ? accountId.slice(0, 8) : undefined);

/** Appearance fields whose options are sold in the shop. */
export function lockedOption(inventory: readonly string[] | undefined, field: keyof CharacterAppearance, value: string): boolean {
  if (field === 'accessory' || field === 'eyewear' || field === 'neckwear') return !owns(inventory, 'accessory', value);
  if (field === 'topColor' || field === 'bottomColor' || field === 'shoesColor') return !owns(inventory, 'color', value);
  return false;
}
