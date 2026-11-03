import { LIMITS, type ChatMessage, type MemberView, type RoomRef, type RoomView } from '@agentville/team-protocol';
import { create } from 'zustand';
import { useAccount } from '../account/accountStore';
import { normalizeServer, type TeamApiError } from './api';

/**
 * Team offices you belong to, and the live state of the one you're in. The
 * list is kept on this computer and in your account; the room and its members
 * come live from the relay while you're inside.
 */
export interface Membership extends RoomRef {
  server: string;
}

export type TeamStatus = 'idle' | 'connecting' | 'online' | 'reconnecting';
/** Localized via `team:error.<code>`. */
export type TeamError = TeamApiError['code'] | 'removed' | 'version';

export interface TeamState {
  server: string;
  /** Team offices you've joined (doors in the lobby). */
  rooms: RoomRef[];
  /** The team office you're in; undefined = your personal office or the lobby. */
  membership?: Membership;
  status: TeamStatus;
  error?: TeamError;
  room?: RoomView;
  members: Record<string, MemberView>;
  /** The office's chat: recent history from the relay plus what arrived since, oldest first. */
  chat: ChatMessage[];
  chatOpen: boolean;
  /** Teammates' messages that arrived while the chat window was closed. */
  chatUnread: number;
  /** Why your last message didn't go out, until you send again. */
  chatNotice?: 'offline' | 'rate_limited';
  dialog?: 'create' | 'join';
  setServer: (server: string) => void;
  setRooms: (rooms: RoomRef[], opts?: { sync?: boolean }) => void;
  /** Makes `roomId` the current team office (undefined: none). */
  setActive: (roomId?: string) => void;
  openDialog: (dialog?: 'create' | 'join') => void;
  setChatOpen: (open: boolean) => void;
}

/** Built-in relay (server/relay, deployed from main by Cloudflare). Users can enter their own. */
export const DEFAULT_TEAM_SERVER = 'https://agentville-relay.gibson-backend.workers.dev';

const KEY = 'agentville.team.v1';

interface Saved {
  server: string;
  rooms: RoomRef[];
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { server?: unknown; rooms?: unknown; membership?: Partial<RoomRef> } | null;
    const server = typeof raw?.server === 'string' ? (normalizeServer(raw.server) ?? DEFAULT_TEAM_SERVER) : DEFAULT_TEAM_SERVER;
    const rooms = Array.isArray(raw?.rooms) ? (raw.rooms as RoomRef[]).filter((r) => r && typeof r.roomId === 'string' && typeof r.token === 'string') : [];
    // v0.1 kept a single membership.
    const m = raw?.membership;
    if (m && typeof m.roomId === 'string' && typeof m.memberId === 'string' && typeof m.token === 'string' && !rooms.some((r) => r.roomId === m.roomId))
      rooms.push({ roomId: m.roomId, memberId: m.memberId, token: m.token, owner: m.owner === true, name: typeof m.name === 'string' ? m.name : 'Team' });
    return { server, rooms };
  } catch {
    return { server: DEFAULT_TEAM_SERVER, rooms: [] };
  }
}

function persist(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ server: s.server, rooms: s.rooms }));
  } catch {
    // storage unavailable: the account still keeps the list
  }
}

export const useTeam = create<TeamState>((set, get) => ({
  ...load(),
  status: 'idle',
  members: {},
  chat: [],
  chatOpen: false,
  chatUnread: 0,
  setServer: (server) => {
    set({ server });
    persist(get());
  },
  setRooms: (rooms, opts) => {
    const active = get().membership;
    const still = active && rooms.find((r) => r.roomId === active.roomId);
    if (active && !still) set({ membership: undefined, room: undefined, members: {}, status: 'idle', chat: [], chatUnread: 0 });
    else if (active && still) set({ membership: { ...still, server: active.server } });
    set({ rooms });
    persist(get());
    if (opts?.sync !== false) useAccount.getState().saveRooms(rooms);
  },
  setActive: (roomId) => {
    const ref = roomId ? get().rooms.find((r) => r.roomId === roomId) : undefined;
    const server = normalizeServer(get().server) ?? DEFAULT_TEAM_SERVER;
    set(ref ? { membership: { ...ref, server }, chat: [], chatUnread: 0 } : { membership: undefined, room: undefined, members: {}, status: 'idle', chat: [], chatUnread: 0 });
  },
  openDialog: (dialog) => set({ dialog, error: undefined }),
  setChatOpen: (chatOpen) => set(chatOpen ? { chatOpen, chatUnread: 0 } : { chatOpen }),
}));

/** Adds messages to the chat list: no duplicates (a reconnect resends history), in time order, newest 50 kept. */
export function mergeChat(list: ChatMessage[], add: ChatMessage[]): ChatMessage[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of add) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1)).slice(-LIMITS.chatHistory);
}

/** Teammates (not you) who are in the office right now. */
export function onlinePeers(s: Pick<TeamState, 'members' | 'membership' | 'status'>): MemberView[] {
  if (s.status !== 'online') return [];
  return Object.values(s.members)
    .filter((m) => m.online && m.id !== s.membership?.memberId)
    .sort((a, b) => a.name.localeCompare(b.name));
}
