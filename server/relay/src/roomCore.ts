import {
  LIMITS,
  PROTOCOL_VERSION,
  parseClientMessage,
  type Appearance,
  type LayoutDocWire,
  type MemberView,
  type Presence,
  type ServerMessage,
} from '../../../packages/team-protocol/src/index.ts';

/**
 * One team office, independent of Cloudflare: the Durable Object adapts its
 * SQLite storage and hibernatable WebSockets to these interfaces, and the tests
 * drive it with in-memory fakes.
 */

export interface RoomMeta {
  id: string;
  name: string;
  code: string;
  theme: string;
  createdAt: number;
}

export interface StoredMember {
  id: string;
  name: string;
  appearance: Appearance;
  owner: boolean;
  tokenHash: string;
  joinedAt: number;
}

export interface RoomStore {
  meta(): RoomMeta | null;
  setMeta(meta: RoomMeta): void;
  members(): StoredMember[];
  putMember(m: StoredMember): void;
  deleteMember(id: string): void;
  layouts(): Record<string, LayoutDocWire>;
  putLayout(theme: string, doc: LayoutDocWire | null): void;
  /** Removes everything (last member left). */
  clear(): void;
}

/** Per-socket state; survives hibernation as the socket's attachment. */
export interface ConnState {
  connId: string;
  memberId?: string;
  presence?: Presence;
  agents: number;
}

export interface Conn {
  readonly state: ConnState;
  /** Persists `state` after a change. */
  save(): void;
  send(raw: string): void;
  close(code: number, reason: string): void;
}

export const CLOSE = { unauthorized: 4001, version: 4002, replaced: 4003, removed: 4004 } as const;

const RATE = { perSecond: 30, burst: 60 };

export class RoomCore {
  /** In-memory only: limits simply reset if the object hibernates. */
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly store: RoomStore,
    private readonly conns: () => Conn[],
    private readonly crypto: { random: (n: number) => Uint8Array; sha256: (s: string) => Promise<string> },
    private readonly now: () => number = Date.now,
  ) {}

  get meta() {
    return this.store.meta();
  }

  create(meta: Omit<RoomMeta, 'createdAt'>) {
    if (this.store.meta()) throw new Error('room exists');
    this.store.setMeta({ ...meta, createdAt: this.now() });
  }

  async addMember(name: string, appearance: Appearance, owner: boolean): Promise<{ memberId: string; token: string } | 'room_full' | 'not_found'> {
    if (!this.store.meta()) return 'not_found';
    if (this.store.members().length >= LIMITS.membersPerRoom) return 'room_full';
    const memberId = hex(this.crypto.random(8));
    const token = base64url(this.crypto.random(32));
    const member: StoredMember = { id: memberId, name, appearance, owner, tokenHash: await this.crypto.sha256(token), joinedAt: this.now() };
    this.store.putMember(member);
    this.broadcast({ t: 'member', member: this.view(member) });
    return { memberId, token };
  }

  async memberFor(token: string): Promise<StoredMember | null> {
    const hash = await this.crypto.sha256(token);
    return this.store.members().find((m) => m.tokenHash === hash) ?? null;
  }

  setCode(code: string) {
    const meta = this.store.meta();
    if (!meta) return;
    this.store.setMeta({ ...meta, code });
    this.broadcast({ t: 'code', code });
  }

  /** Removes a member; returns true when the room is now empty and was cleared. */
  removeMember(id: string): boolean {
    this.store.deleteMember(id);
    for (const c of this.conns()) {
      if (c.state.memberId === id) {
        c.send(json({ t: 'error', code: 'removed' }));
        c.close(CLOSE.removed, 'removed');
      }
    }
    this.broadcast({ t: 'removed', id });
    if (this.store.members().length) return false;
    this.store.clear();
    return true;
  }

  // ───────────────────────────────── sockets

  async onMessage(conn: Conn, raw: string) {
    const msg = parseClientMessage(raw);
    if (!msg) {
      conn.send(json({ t: 'error', code: raw.length > LIMITS.messageBytes ? 'too_large' : 'bad_message' }));
      return;
    }
    if (!conn.state.memberId) {
      if (msg.t !== 'auth') {
        conn.send(json({ t: 'error', code: 'unauthorized' }));
        conn.close(CLOSE.unauthorized, 'unauthorized');
        return;
      }
      if (msg.v !== PROTOCOL_VERSION) {
        conn.send(json({ t: 'error', code: 'version' }));
        conn.close(CLOSE.version, 'version');
        return;
      }
      const member = await this.memberFor(msg.token);
      const meta = this.store.meta();
      if (!member || !meta) {
        conn.send(json({ t: 'error', code: 'unauthorized' }));
        conn.close(CLOSE.unauthorized, 'unauthorized');
        return;
      }
      // One live connection per member: a newer window replaces the older one.
      for (const other of this.conns()) {
        if (other.state.connId !== conn.state.connId && other.state.memberId === member.id) {
          other.state.memberId = undefined;
          other.save();
          other.close(CLOSE.replaced, 'replaced');
        }
      }
      conn.state.memberId = member.id;
      conn.state.agents = 0;
      conn.state.presence = undefined;
      conn.save();
      const members = this.store.members().map((m) => this.view(m));
      conn.send(json({ t: 'welcome', you: member.id, room: { id: meta.id, name: meta.name, code: meta.code, theme: meta.theme, layouts: this.store.layouts() }, members }));
      this.broadcast({ t: 'member', member: this.view(member) }, conn);
      return;
    }
    if (!this.allow(conn.state.connId)) {
      conn.send(json({ t: 'error', code: 'rate_limited' }));
      return;
    }
    const id = conn.state.memberId;
    switch (msg.t) {
      case 'auth':
        return; // already authenticated
      case 'ping':
        conn.send(json({ t: 'pong' }));
        return;
      case 'presence':
        conn.state.presence = msg.p;
        conn.save();
        this.broadcast({ t: 'presence', id, p: msg.p }, conn);
        return;
      case 'agents':
        if (conn.state.agents === msg.n) return;
        conn.state.agents = msg.n;
        conn.save();
        this.broadcast({ t: 'agents', id, n: msg.n }, conn);
        return;
      case 'profile': {
        const m = this.store.members().find((x) => x.id === id);
        if (!m) return;
        const next = { ...m, name: msg.name, appearance: msg.appearance };
        this.store.putMember(next);
        this.broadcast({ t: 'member', member: this.view(next) });
        return;
      }
      case 'theme': {
        const meta = this.store.meta();
        if (!meta || meta.theme === msg.theme) return;
        this.store.setMeta({ ...meta, theme: msg.theme });
        this.broadcast({ t: 'theme', theme: msg.theme, by: id });
        return;
      }
      case 'layout':
        this.store.putLayout(msg.theme, msg.doc);
        this.broadcast({ t: 'layout', theme: msg.theme, doc: msg.doc, by: id }, conn);
        return;
    }
  }

  onClose(conn: Conn) {
    const id = conn.state.memberId;
    if (!id) return;
    conn.state.memberId = undefined;
    this.buckets.delete(conn.state.connId);
    const stillOnline = this.conns().some((c) => c.state.connId !== conn.state.connId && c.state.memberId === id);
    if (!stillOnline) this.broadcast({ t: 'offline', id });
  }

  // ───────────────────────────────── helpers

  private view(m: StoredMember): MemberView {
    const conn = this.conns().find((c) => c.state.memberId === m.id);
    const v: MemberView = { id: m.id, name: m.name, appearance: m.appearance, owner: m.owner, online: !!conn, agents: conn?.state.agents ?? 0 };
    if (conn?.state.presence) v.presence = conn.state.presence;
    return v;
  }

  private broadcast(msg: ServerMessage, except?: Conn) {
    const raw = json(msg);
    for (const c of this.conns()) {
      if (!c.state.memberId || c.state.connId === except?.state.connId) continue;
      try {
        c.send(raw);
      } catch {
        // A socket closing mid-broadcast is cleaned up by its close handler.
      }
    }
  }

  private allow(connId: string) {
    const now = this.now();
    const b = this.buckets.get(connId) ?? { tokens: RATE.burst, at: now };
    b.tokens = Math.min(RATE.burst, b.tokens + ((now - b.at) / 1000) * RATE.perSecond);
    b.at = now;
    if (b.tokens < 1) {
      this.buckets.set(connId, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(connId, b);
    return true;
  }
}

const json = (m: ServerMessage) => JSON.stringify(m);

export function hex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function base64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(s: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return base64url(new Uint8Array(digest));
}

export const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
