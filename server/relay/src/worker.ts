import { DurableObject } from 'cloudflare:workers';
import {
  ROOM_ID,
  TOKEN,
  cleanAppearance,
  cleanName,
  generateInviteCode,
  normalizeInviteCode,
  LIMITS,
  type ApiErrorCode,
  type Appearance,
  type LayoutDocWire,
  type MembershipResponse,
  buy,
  cleanProfile,
  cleanRooms,
  earn,
  generateRecoveryCode,
  newAccount,
  normalizeRecoveryCode,
  recordScore,
  type AccountDoc,
} from '../../../packages/team-protocol/src/index.ts';
import { RoomCore, hex, random, sha256, type Conn, type ConnState, type RoomMeta, type RoomStore, type StoredMember } from './roomCore.ts';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  ACCOUNT: DurableObjectNamespace<Account>;
}

const VERSION = '0.2.0';
const DEFAULT_THEME = 'loft';
/** Wrong invite codes allowed per client IP per window before joins are refused. */
const JOIN_FAILURES = { max: 10, windowMs: 10 * 60_000 };
/** New accounts per client IP per hour. */
const ACCOUNT_CREATES = { max: 30, windowMs: 60 * 60_000 };

// ───────────────────────────────── HTTP entry

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (parts[0] !== 'v1') return error('not_found', 404);
      if (req.method === 'GET' && parts[1] === 'health') return ok({ ok: true, version: VERSION });
      if (req.method === 'POST' && parts[1] === 'rooms' && parts.length === 2) return await createRoom(req, env);
      if (req.method === 'POST' && parts[1] === 'join' && parts.length === 2) return await joinRoom(req, env);
      if (req.method === 'POST' && parts[1] === 'accounts' && parts.length === 2) return await createAccount(req, env);
      if (parts[1] === 'me') return await me(req, env, parts.slice(2));
      if (parts[1] === 'rooms' && parts[2] && ROOM_ID.test(parts[2])) {
        const roomId = parts[2];
        const stub = roomStub(env, roomId);
        if (req.method === 'GET' && parts[3] === 'ws') {
          if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return error('bad_request', 426);
          return stub.fetch(req);
        }
        const token = bearer(req);
        if (!token) return error('unauthorized', 401);
        if (req.method === 'POST' && parts[3] === 'rotate') {
          const who = await stub.whoIs(token);
          if (!who) return error('unauthorized', 401);
          if (!who.owner) return error('forbidden', 403);
          const code = await registerNewCode(env, roomId);
          await stub.setCode(code);
          await directory(env).unregister(who.code);
          return ok({ code });
        }
        if (req.method === 'POST' && parts[3] === 'leave') {
          const left = await stub.leave(token);
          if (!left) return error('unauthorized', 401);
          if (left.emptied) await directory(env).unregister(left.code);
          return ok({ ok: true });
        }
      }
      return error('not_found', 404);
    } catch (e) {
      console.error('relay error', e);
      return new Response(JSON.stringify({ error: 'internal' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
  },
} satisfies ExportedHandler<Env>;

async function createRoom(req: Request, env: Env) {
  const body = await readJson(req);
  const roomName = cleanName(body?.roomName, LIMITS.roomNameLength);
  const name = cleanName(body?.name);
  const appearance = cleanAppearance(body?.appearance);
  if (!roomName || !name || !appearance) return error('bad_request', 400);
  const roomId = hex(random(16));
  const code = await registerNewCode(env, roomId);
  const stub = roomStub(env, roomId);
  await stub.init({ id: roomId, name: roomName, code, theme: DEFAULT_THEME });
  const member = await stub.join(name, appearance, true);
  if (typeof member === 'string') return error('bad_request', 400);
  return ok({ roomId, memberId: member.memberId, token: member.token, owner: true } satisfies MembershipResponse);
}

async function joinRoom(req: Request, env: Env) {
  const body = await readJson(req);
  const code = typeof body?.code === 'string' ? normalizeInviteCode(body.code) : null;
  const name = cleanName(body?.name);
  const appearance = cleanAppearance(body?.appearance);
  if (!name || !appearance || typeof body?.code !== 'string') return error('bad_request', 400);
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  const found = await directory(env).resolve(code, ip);
  if (found === 'rate_limited') return error('rate_limited', 429);
  if (!found) return error('invalid_code', 404);
  const member = await roomStub(env, found).join(name, appearance, false);
  if (member === 'room_full') return error('room_full', 409);
  if (member === 'not_found') return error('invalid_code', 404);
  return ok({ roomId: found, memberId: member.memberId, token: member.token, owner: false } satisfies MembershipResponse);
}

// ───────────────────────────────── accounts

async function createAccount(req: Request, env: Env) {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  if (!(await directory(env).allowAccountCreate(ip))) return error('rate_limited', 429);
  const code = generateRecoveryCode(random);
  const account = await accountStub(env, await accountIdFor(code)).create();
  return ok({ code, account });
}

/** `/v1/me…` — everything about the account whose recovery code is the bearer token. */
async function me(req: Request, env: Env, rest: string[]) {
  const raw = /^Bearer (.+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  const code = raw ? normalizeRecoveryCode(raw) : null;
  if (!code) return error('unauthorized', 401);
  const stub = accountStub(env, await accountIdFor(code));
  const action = rest.join('/');
  if (req.method === 'GET' && action === '') {
    const account = await stub.get();
    return account ? ok({ account }) : error('unauthorized', 401);
  }
  if (req.method !== 'POST') return error('not_found', 404);
  const body = await readJson(req);
  const r = await stub.act(action, body);
  if (typeof r === 'string') return error(r as ApiErrorCode, r === 'unauthorized' ? 401 : r === 'not_found' ? 404 : 400);
  return ok(r);
}

async function accountIdFor(code: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`agentville-account:${code}`));
  return hex(new Uint8Array(digest)).slice(0, 32);
}

const accountStub = (env: Env, id: string) => env.ACCOUNT.get(env.ACCOUNT.idFromName(id));

async function registerNewCode(env: Env, roomId: string) {
  for (let i = 0; i < 8; i++) {
    const code = generateInviteCode(random);
    if (await directory(env).register(code, roomId)) return code;
  }
  throw new Error('could not allocate an invite code');
}

const roomStub = (env: Env, roomId: string) => env.ROOM.get(env.ROOM.idFromName(roomId));
const directory = (env: Env) => env.DIRECTORY.get(env.DIRECTORY.idFromName('global'));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function error(code: ApiErrorCode, status: number) {
  return new Response(JSON.stringify({ error: code }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function bearer(req: Request) {
  const m = /^Bearer (\S+)$/.exec(req.headers.get('Authorization') ?? '');
  return m && TOKEN.test(m[1]!) ? m[1]! : null;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > 8 * 1024) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ───────────────────────────────── invite-code directory

/** Maps invite codes to rooms and throttles code guessing. A single global instance. */
export class Directory extends DurableObject<Env> {
  private failures = new Map<string, { count: number; since: number }>();
  private creates = new Map<string, { count: number; since: number }>();

  allowAccountCreate(ip: string): boolean {
    const now = Date.now();
    const c = this.creates.get(ip);
    if (c && now - c.since < ACCOUNT_CREATES.windowMs) {
      if (c.count >= ACCOUNT_CREATES.max) return false;
      c.count += 1;
    } else this.creates.set(ip, { count: 1, since: now });
    if (this.creates.size > 10_000) this.creates.clear();
    return true;
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, room_id TEXT NOT NULL)');
  }

  register(code: string, roomId: string): boolean {
    const taken = this.ctx.storage.sql.exec('SELECT 1 FROM codes WHERE code = ?', code).toArray().length > 0;
    if (taken) return false;
    this.ctx.storage.sql.exec('INSERT INTO codes (code, room_id) VALUES (?, ?)', code, roomId);
    return true;
  }

  unregister(code: string) {
    this.ctx.storage.sql.exec('DELETE FROM codes WHERE code = ?', code);
  }

  resolve(code: string | null, ip: string): string | null | 'rate_limited' {
    const now = Date.now();
    const f = this.failures.get(ip);
    if (f && now - f.since < JOIN_FAILURES.windowMs && f.count >= JOIN_FAILURES.max) return 'rate_limited';
    const row = code ? this.ctx.storage.sql.exec<{ room_id: string }>('SELECT room_id FROM codes WHERE code = ?', code).toArray()[0] : undefined;
    if (row) return row.room_id;
    const fresh = !f || now - f.since >= JOIN_FAILURES.windowMs;
    this.failures.set(ip, fresh ? { count: 1, since: now } : { count: f.count + 1, since: f.since });
    if (this.failures.size > 10_000) this.failures.clear();
    return null;
  }
}

// ───────────────────────────────── account

/** One account: character, coins, purchases, team offices and best scores. */
export class Account extends DurableObject<Env> {
  private async load() {
    return (await this.ctx.storage.get<AccountDoc>('account')) ?? null;
  }

  async create(): Promise<AccountDoc> {
    const existing = await this.load();
    if (existing) return existing;
    const doc = newAccount(this.ctx.id.toString().slice(0, 32), Date.now());
    await this.ctx.storage.put('account', doc);
    return doc;
  }

  get() {
    return this.load();
  }

  /** Applies one change; returns the response body or an error code. */
  async act(action: string, body: Record<string, unknown> | null): Promise<Record<string, unknown> | string> {
    const doc = await this.load();
    if (!doc) return 'unauthorized';
    let next: AccountDoc = doc;
    let extra: Record<string, unknown> = {};
    switch (action) {
      case 'profile': {
        const profile = cleanProfile(body);
        if (!profile) return 'bad_request';
        next = { ...doc, profile };
        break;
      }
      case 'earn': {
        const turns = Number(body?.turns);
        const tools = Number(body?.tools ?? 0);
        if (!Number.isInteger(turns) || turns < 1 || turns > 50 || !Number.isInteger(tools) || tools < 0 || tools > 5000) return 'bad_request';
        const r = earn(doc, turns, tools, Date.now());
        next = r.doc;
        extra = { credited: r.credited };
        break;
      }
      case 'buy': {
        const r = buy(doc, String(body?.item ?? ''));
        if (!r.ok) return r.error;
        next = r.doc;
        break;
      }
      case 'rooms': {
        const rooms = cleanRooms(body?.rooms);
        if (!rooms) return 'bad_request';
        next = { ...doc, rooms };
        break;
      }
      case 'score': {
        const r = recordScore(doc, String(body?.game ?? ''), body?.score);
        if (!r) return 'bad_request';
        next = r;
        break;
      }
      default:
        return 'not_found';
    }
    if (next !== doc) await this.ctx.storage.put('account', next);
    return { account: next, ...extra };
  }
}

// ───────────────────────────────── room

/** One team office: members, shared layout and live presence over hibernatable WebSockets. */
export class Room extends DurableObject<Env> {
  private core: RoomCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS layouts (theme TEXT PRIMARY KEY, doc TEXT NOT NULL)`);
    const store: RoomStore = {
      meta: () => {
        const row = sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'room'").toArray()[0];
        return row ? (JSON.parse(row.v) as RoomMeta) : null;
      },
      setMeta: (m) => void sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('room', ?)", JSON.stringify(m)),
      members: () => sql.exec<{ doc: string }>('SELECT doc FROM members').toArray().map((r) => JSON.parse(r.doc) as StoredMember),
      putMember: (m) => void sql.exec('INSERT OR REPLACE INTO members (id, doc) VALUES (?, ?)', m.id, JSON.stringify(m)),
      deleteMember: (id) => void sql.exec('DELETE FROM members WHERE id = ?', id),
      layouts: () => Object.fromEntries(sql.exec<{ theme: string; doc: string }>('SELECT theme, doc FROM layouts').toArray().map((r) => [r.theme, JSON.parse(r.doc) as LayoutDocWire])),
      putLayout: (theme, doc) => {
        if (doc) sql.exec('INSERT OR REPLACE INTO layouts (theme, doc) VALUES (?, ?)', theme, JSON.stringify(doc));
        else sql.exec('DELETE FROM layouts WHERE theme = ?', theme);
      },
      clear: () => void sql.exec('DELETE FROM meta; DELETE FROM members; DELETE FROM layouts'),
    };
    this.core = new RoomCore(store, () => ctx.getWebSockets().map(adapt), { random, sha256 });
    // Keep-alive pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  init(meta: Omit<RoomMeta, 'createdAt'>) {
    this.core.create(meta);
  }

  join(name: string, appearance: Appearance, owner: boolean) {
    return this.core.addMember(name, appearance, owner);
  }

  async whoIs(token: string) {
    const m = await this.core.memberFor(token);
    const meta = this.core.meta;
    return m && meta ? { id: m.id, owner: m.owner, code: meta.code } : null;
  }

  setCode(code: string) {
    this.core.setCode(code);
  }

  async leave(token: string) {
    const m = await this.core.memberFor(token);
    const meta = this.core.meta;
    if (!m || !meta) return null;
    return { emptied: this.core.removeMember(m.id), code: meta.code };
  }

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connId: hex(random(8)), agents: 0 } satisfies ConnState);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') {
      ws.close(1003, 'text only');
      return;
    }
    await this.core.onMessage(adapt(ws), message);
  }

  webSocketClose(ws: WebSocket) {
    this.core.onClose(adapt(ws));
  }

  webSocketError(ws: WebSocket) {
    this.core.onClose(adapt(ws));
  }
}

function adapt(ws: WebSocket): Conn {
  const state = (ws.deserializeAttachment() as ConnState | null) ?? { connId: 'unknown', agents: 0 };
  return {
    state,
    save: () => ws.serializeAttachment(state),
    send: (raw) => ws.send(raw),
    close: (code, reason) => {
      try {
        ws.close(code, reason);
      } catch {
        // already closing
      }
    },
  };
}
