/**
 * Wire protocol between the desktop app and the team relay.
 *
 * Privacy contract: nothing about a member's Claude Code activity crosses this
 * boundary except one number — how many of their agents are in the office.
 * Prompts, tools, files, project paths and session ids never appear here, and
 * the relay rejects any message that doesn't match these shapes exactly.
 */

export const PROTOCOL_VERSION = 1;

export const LIMITS = {
  /** Largest WebSocket frame the relay accepts (a full office layout fits comfortably). */
  messageBytes: 64 * 1024,
  membersPerRoom: 50,
  nameLength: 24,
  roomNameLength: 40,
  agentsPerMember: 32,
  furniture: 300,
  workstations: 150,
} as const;

export type Facing = 'up' | 'down' | 'left' | 'right';
const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right'];

/** What a member's avatar is doing; `seat` names the chair, sofa place or arcade it uses. */
export type PoseKind = 'stand' | 'walk' | 'sit' | 'sofa' | 'arcade';
const POSES: readonly PoseKind[] = ['stand', 'walk', 'sit', 'sofa', 'arcade'];

export interface Presence {
  /** Feet position in office art pixels. */
  x: number;
  y: number;
  facing: Facing;
  pose: PoseKind;
  seat?: string;
}

/** Character look as option ids; clients re-validate against their own option lists. */
export type Appearance = Record<string, string>;

export interface MemberView {
  id: string;
  name: string;
  appearance: Appearance;
  owner: boolean;
  online: boolean;
  /** Number of the member's agents currently in the office. */
  agents: number;
  presence?: Presence;
}

export interface LayoutDocWire {
  version: 1;
  furniture: { id: string; kind: string; x: number; y: number; variant?: number }[];
  workstations: { id: string; deskId: string; facing: 'up' | 'down'; seat?: { x: number; y: number } }[];
}

export interface RoomView {
  id: string;
  name: string;
  /** Current invite code; every member may see it to invite others. */
  code: string;
  theme: string;
  /** Saved layout per theme; themes without one use the built-in layout. */
  layouts: Record<string, LayoutDocWire>;
}

export type ClientMessage =
  | { t: 'auth'; token: string; v: number }
  | { t: 'presence'; p: Presence }
  | { t: 'agents'; n: number }
  | { t: 'profile'; name: string; appearance: Appearance }
  | { t: 'theme'; theme: string }
  | { t: 'layout'; theme: string; doc: LayoutDocWire | null }
  | { t: 'ping' };

export type ErrorCode = 'unauthorized' | 'bad_message' | 'too_large' | 'version' | 'rate_limited' | 'removed';

export type ServerMessage =
  | { t: 'welcome'; you: string; room: RoomView; members: MemberView[] }
  | { t: 'member'; member: MemberView }
  | { t: 'offline'; id: string }
  | { t: 'removed'; id: string }
  | { t: 'presence'; id: string; p: Presence }
  | { t: 'agents'; id: string; n: number }
  | { t: 'theme'; theme: string; by: string }
  | { t: 'layout'; theme: string; doc: LayoutDocWire | null; by: string }
  | { t: 'code'; code: string }
  | { t: 'error'; code: ErrorCode }
  | { t: 'pong' };

// ───────────────────────────────── HTTP API

export interface CreateRoomRequest {
  roomName: string;
  name: string;
  appearance: Appearance;
}
export interface JoinRoomRequest {
  code: string;
  name: string;
  appearance: Appearance;
}
export interface MembershipResponse {
  roomId: string;
  memberId: string;
  token: string;
  owner: boolean;
}
export type ApiErrorCode = 'invalid_code' | 'room_full' | 'rate_limited' | 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found';

// ───────────────────────────────── validation

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isNum = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const ID = /^[A-Za-z0-9_:-]{1,48}$/;
const THEME = /^[a-z0-9_-]{1,24}$/;
const APPEARANCE_KEY = /^[A-Za-z]{1,16}$/;
const APPEARANCE_VALUE = /^[a-z0-9_]{1,16}$/;
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const ROOM_ID = /^[a-f0-9]{32}$/;
export const MEMBER_ID = /^[a-f0-9]{16}$/;

/** Trims, strips control/format characters and collapses whitespace; null when empty. */
export function cleanName(v: unknown, max: number = LIMITS.nameLength): string | null {
  if (typeof v !== 'string') return null;
  const s = v
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  return [...s].slice(0, max).join('');
}

export function cleanAppearance(v: unknown): Appearance | null {
  if (!isObj(v)) return null;
  const entries = Object.entries(v);
  if (entries.length > 16) return null;
  const out: Appearance = {};
  for (const [k, val] of entries) {
    if (!APPEARANCE_KEY.test(k) || typeof val !== 'string' || !APPEARANCE_VALUE.test(val)) return null;
    out[k] = val;
  }
  return out;
}

export function cleanPresence(v: unknown): Presence | null {
  if (!isObj(v)) return null;
  const { x, y, facing, pose, seat } = v;
  if (!isNum(x, 0, 4096) || !isNum(y, 0, 4096)) return null;
  if (!FACINGS.includes(facing as Facing) || !POSES.includes(pose as PoseKind)) return null;
  if (seat !== undefined && (typeof seat !== 'string' || !ID.test(seat))) return null;
  const p: Presence = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, facing: facing as Facing, pose: pose as PoseKind };
  if (seat !== undefined) p.seat = seat;
  return p;
}

/** Shape check only; the app applies the full furniture and reachability rules. */
export function cleanLayoutDoc(v: unknown): LayoutDocWire | null {
  if (!isObj(v) || v.version !== 1 || !Array.isArray(v.furniture) || !Array.isArray(v.workstations)) return null;
  if (v.furniture.length > LIMITS.furniture || v.workstations.length > LIMITS.workstations) return null;
  const furniture: LayoutDocWire['furniture'] = [];
  for (const f of v.furniture) {
    if (!isObj(f) || typeof f.id !== 'string' || !ID.test(f.id) || typeof f.kind !== 'string' || !THEME.test(f.kind)) return null;
    if (!isInt(f.x, 0, 255) || !isInt(f.y, 0, 255)) return null;
    if (f.variant !== undefined && !isInt(f.variant, 0, 64)) return null;
    furniture.push(f.variant === undefined ? { id: f.id, kind: f.kind, x: f.x, y: f.y } : { id: f.id, kind: f.kind, x: f.x, y: f.y, variant: f.variant });
  }
  const workstations: LayoutDocWire['workstations'] = [];
  for (const w of v.workstations) {
    if (!isObj(w) || typeof w.id !== 'string' || !ID.test(w.id) || typeof w.deskId !== 'string' || !ID.test(w.deskId)) return null;
    if (w.facing !== 'up' && w.facing !== 'down') return null;
    workstations.push({ id: w.id, deskId: w.deskId, facing: w.facing });
  }
  return { version: 1, furniture, workstations };
}

/** Parses and validates one client frame; null means "reject". */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > LIMITS.messageBytes) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m) || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'auth':
      return typeof m.token === 'string' && TOKEN.test(m.token) && isInt(m.v, 0, 1000) ? { t: 'auth', token: m.token, v: m.v } : null;
    case 'presence': {
      const p = cleanPresence(m.p);
      return p ? { t: 'presence', p } : null;
    }
    case 'agents':
      return isInt(m.n, 0, LIMITS.agentsPerMember) ? { t: 'agents', n: m.n } : null;
    case 'profile': {
      const name = cleanName(m.name);
      const appearance = cleanAppearance(m.appearance);
      return name && appearance ? { t: 'profile', name, appearance } : null;
    }
    case 'theme':
      return typeof m.theme === 'string' && THEME.test(m.theme) ? { t: 'theme', theme: m.theme } : null;
    case 'layout': {
      if (typeof m.theme !== 'string' || !THEME.test(m.theme)) return null;
      if (m.doc === null) return { t: 'layout', theme: m.theme, doc: null };
      const doc = cleanLayoutDoc(m.doc);
      return doc ? { t: 'layout', theme: m.theme, doc } : null;
    }
    case 'ping':
      return { t: 'ping' };
    default:
      return null;
  }
}

// ───────────────────────────────── invite codes

/** Crockford base32: no I, L, O or U, so codes survive being read aloud or retyped. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE = /^AGV-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** 8 random symbols = 40 bits, formatted as AGV-XXXX-XXXX. Joins are rate limited server-side. */
export function generateInviteCode(random: (n: number) => Uint8Array): string {
  const bytes = random(8);
  let s = '';
  for (const b of bytes) s += ALPHABET[b & 31];
  return `AGV-${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Accepts sloppy input (lowercase, spaces, missing dashes or prefix, O/I/L look-alikes). */
export function normalizeInviteCode(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s_-]/g, '');
  if (s.startsWith('AGV')) s = s.slice(3);
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 8) return null;
  const code = `AGV-${s.slice(0, 4)}-${s.slice(4)}`;
  return CODE.test(code) ? code : null;
}

export function isInviteCode(v: unknown): v is string {
  return typeof v === 'string' && CODE.test(v);
}
