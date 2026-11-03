import type { MemberView, RoomView } from '@agentville/team-protocol';
import { create } from 'zustand';
import { normalizeServer } from './api';

/**
 * Team office state. Only membership (server, room, member token) is stored
 * on this computer; the room and its members come live from the relay.
 */
export interface Membership {
  server: string;
  roomId: string;
  memberId: string;
  token: string;
  owner: boolean;
}

export type TeamStatus = 'idle' | 'connecting' | 'online' | 'reconnecting';
/** Localized via `team:error.<code>`. */
export type TeamError = 'network' | 'server' | 'invalid_code' | 'room_full' | 'rate_limited' | 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'removed' | 'version' | 'no_server';

export interface TeamState {
  server: string;
  membership?: Membership;
  status: TeamStatus;
  error?: TeamError;
  room?: RoomView;
  members: Record<string, MemberView>;
  dialog?: 'create' | 'join';
  setServer: (server: string) => void;
  setMembership: (m?: Membership) => void;
  openDialog: (dialog?: 'create' | 'join') => void;
}

/** Built-in relay. Empty until one is deployed; users can always enter their own. */
export const DEFAULT_TEAM_SERVER = '';

const KEY = 'agentville.team.v1';

function load(): { server: string; membership?: Membership } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { server?: unknown; membership?: Partial<Membership> } | null;
    const server = typeof raw?.server === 'string' ? (normalizeServer(raw.server) ?? DEFAULT_TEAM_SERVER) : DEFAULT_TEAM_SERVER;
    const m = raw?.membership;
    const membership =
      m && typeof m.server === 'string' && typeof m.roomId === 'string' && typeof m.memberId === 'string' && typeof m.token === 'string'
        ? { server: m.server, roomId: m.roomId, memberId: m.memberId, token: m.token, owner: m.owner === true }
        : undefined;
    return { server, membership };
  } catch {
    return { server: DEFAULT_TEAM_SERVER };
  }
}

function persist(s: { server: string; membership?: Membership }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ server: s.server, membership: s.membership }));
  } catch {
    // storage unavailable: membership lasts for this session
  }
}

export const useTeam = create<TeamState>((set, get) => ({
  ...load(),
  status: 'idle',
  members: {},
  setServer: (server) => {
    set({ server });
    persist(get());
  },
  setMembership: (membership) => {
    set(membership ? { membership } : { membership, room: undefined, members: {}, status: 'idle' });
    persist(get());
  },
  openDialog: (dialog) => set({ dialog, error: undefined }),
}));

/** Teammates (not you) who are in the office right now. */
export function onlinePeers(s: Pick<TeamState, 'members' | 'membership' | 'status'>): MemberView[] {
  if (s.status !== 'online') return [];
  return Object.values(s.members)
    .filter((m) => m.online && m.id !== s.membership?.memberId)
    .sort((a, b) => a.name.localeCompare(b.name));
}
