import {
  LIMITS,
  PROTOCOL_VERSION,
  mergeScores,
  parseClientMessage,
  type Appearance,
  type ChatMessage,
  type LayoutDocWire,
  type MemberView,
  type Presence,
  type Scores,
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
  /** Arcade best scores shared with the office; kept while the member is offline. */
  scores?: Scores;
}

export interface RoomStore {
  meta(): RoomMeta | null;
  setMeta(meta: RoomMeta): void;
  members(): StoredMember[];
  putMember(m: StoredMember): void;
  deleteMember(id: string): void;
  layouts(): Record<string, LayoutDocWire>;
  putLayout(theme: string, doc: LayoutDocWire | null): void;
  /** Recent chat, oldest first. */
  chat(): ChatMessage[];
  /** Adds a message, then keeps only the newest `keep` sent after `since`. */
  putChat(m: ChatMessage, keep: number, since: number): void;
  /** Removes everything (last member left). */
  clear(): void;
}

/** Per-socket state; survives hibernation as the socket's attachment. */
export interface ConnState {
  connId: string;
  memberId?: string;
  presence?: Presence;
  agents: number;
  /** When the socket opened and when it last sent a message (keep-alive pings are tracked by the runtime). */
  openedAt?: number;
  seenAt?: number;
}

export interface Conn {
  readonly state: ConnState;
  /** Persists `state` after a change. */
  save(): void;
  send(raw: string): void;
  close(code: number, reason: string): void;
  /** Last keep-alive ping answered for this socket without waking the room, if any. */
  lastPing?(): number | undefined;
}

export const CLOSE = { unauthorized: 4001, version: 4002, replaced: 4003, removed: 4004, stale: 4005 } as const;

/**
 * A socket silent this long is a ghost: the app pings every 30 s, so a laptop
 * that went to sleep or lost its network never said goodbye. Its member is
 * shown offline and the socket closed (the app reconnects when it wakes).
 */
export const STALE_MS = 100_000;
/** A socket that never authenticated is dropped much sooner. */
const AUTH_GRACE_MS = 30_000;

const RATE = { perSecond: 30, burst: 60 };
/** Chat on top of that: about one message a second, a few in a row. */
const CHAT_RATE = { perSecond: 1, burst: 5 };

export class RoomCore {
  /** In-memory only: limits simply reset if the object hibernates. */
  private buckets = new Map<string, { tokens: number; at: number }>();
  private chatBuckets = new Map<string, { tokens: number; at: number }>();

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
    const now = this.now();
    if (!conn.state.seenAt || now - conn.state.seenAt > 10_000) {
      conn.state.seenAt = now;
      conn.save();
    }
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
      conn.send(json({ t: 'welcome', you: member.id, room: { id: meta.id, name: meta.name, code: meta.code, theme: meta.theme, layouts: this.store.layouts() }, members, chat: this.recentChat() }));
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
      case 'chat': {
        const m = this.store.members().find((x) => x.id === id);
        if (!m) return;
        if (!take(this.chatBuckets, id, CHAT_RATE, this.now())) {
          conn.send(json({ t: 'error', code: 'rate_limited' }));
          return;
        }
        const now = this.now();
        const message: ChatMessage = { id: hex(this.crypto.random(8)), from: id, name: m.name, text: msg.text, at: now };
        this.store.putChat(message, LIMITS.chatHistory, now - LIMITS.chatKeepMs);
        // Back to the sender too, so everyone's list has the same ids, times and order.
        this.broadcast({ t: 'chat', m: message });
        return;
      }
      case 'scores': {
        const m = this.store.members().find((x) => x.id === id);
        if (!m) return;
        const scores = mergeScores(m.scores, msg.s);
        if (JSON.stringify(scores) === JSON.stringify(m.scores ?? {})) return;
        const next = { ...m, scores };
        this.store.putMember(next);
        this.broadcast({ t: 'member', member: this.view(next) });
        return;
      }
      case 'theme':
        // How an office looks is each person's own choice (kept in their app); nobody can switch
        // it for everyone. Older apps still send this message, so it's accepted and ignored.
        return;
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

  /** Closes ghost connections; returns how many connections remain open. */
  sweep(): number {
    const now = this.now();
    let open = 0;
    for (const c of this.conns()) {
      const last = Math.max(c.state.seenAt ?? 0, c.lastPing?.() ?? 0, c.state.openedAt ?? 0);
      const limit = c.state.memberId ? STALE_MS : AUTH_GRACE_MS;
      if (last && now - last > limit) {
        this.onClose(c);
        c.close(CLOSE.stale, 'stale');
      } else open++;
    }
    return open;
  }

  // ───────────────────────────────── helpers

  /** Chat still within the keep window. */
  private recentChat(): ChatMessage[] {
    const since = this.now() - LIMITS.chatKeepMs;
    return this.store.chat().filter((m) => m.at > since);
  }

  private view(m: StoredMember): MemberView {
    const conn = this.conns().find((c) => c.state.memberId === m.id);
    const v: MemberView = { id: m.id, name: m.name, appearance: m.appearance, owner: m.owner, online: !!conn, agents: conn?.state.agents ?? 0 };
    if (conn?.state.presence) v.presence = conn.state.presence;
    if (m.scores && Object.keys(m.scores).length) v.scores = m.scores;
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
    return take(this.buckets, connId, RATE, this.now());
  }
}

/** Token bucket: takes one token for `key` if there is one. */
function take(buckets: Map<string, { tokens: number; at: number }>, key: string, rate: { perSecond: number; burst: number }, now: number) {
  const b = buckets.get(key) ?? { tokens: rate.burst, at: now };
  b.tokens = Math.min(rate.burst, b.tokens + ((now - b.at) / 1000) * rate.perSecond);
  b.at = now;
  buckets.set(key, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
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
