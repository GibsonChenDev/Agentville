import { describe, expect, it } from 'vitest';
import type { ChatMessage, LayoutDocWire, ServerMessage } from '../../../packages/team-protocol/src/index.ts';
import { CLOSE, RoomCore, random, sha256, type Conn, type RoomMeta, type RoomStore, type StoredMember } from './roomCore';

function memoryStore(): RoomStore {
  let meta: RoomMeta | null = null;
  const members = new Map<string, StoredMember>();
  const layouts = new Map<string, LayoutDocWire>();
  let chat: ChatMessage[] = [];
  return {
    meta: () => meta,
    setMeta: (m) => (meta = m),
    members: () => [...members.values()],
    putMember: (m) => void members.set(m.id, m),
    deleteMember: (id) => void members.delete(id),
    layouts: () => Object.fromEntries(layouts),
    putLayout: (t, d) => (d ? layouts.set(t, d) : layouts.delete(t)),
    chat: () => chat,
    putChat: (m, keep, since) => {
      chat = [...chat, m].filter((x) => x.at > since).slice(-keep);
    },
    clear: () => {
      chat = [];
      meta = null;
      members.clear();
      layouts.clear();
    },
  };
}

interface FakeConn extends Conn {
  inbox: ServerMessage[];
  closed?: number;
}

function setup() {
  const conns: FakeConn[] = [];
  const core = new RoomCore(memoryStore(), () => conns.filter((c) => c.closed === undefined), { random, sha256 });
  core.create({ id: 'r'.repeat(32), name: 'App team', code: 'AGV-AAAA-BBBB', theme: 'loft' });
  let n = 0;
  const open = () => {
    const c: FakeConn = {
      state: { connId: `c${n++}`, agents: 0 },
      inbox: [],
      save: () => {},
      send: (raw) => c.inbox.push(JSON.parse(raw) as ServerMessage),
      close: (code) => {
        c.closed = code;
      },
    };
    conns.push(c);
    return c;
  };
  const send = (c: Conn, m: unknown) => core.onMessage(c, JSON.stringify(m));
  return { core, open, send };
}

const appearance = { hairStyle: 'bob', top: 'hoodie' };

describe('RoomCore', () => {
  it('authenticates with the member token and sends a welcome', async () => {
    const { core, open, send } = setup();
    const alice = await core.addMember('Alice', appearance, true);
    if (typeof alice === 'string') throw new Error(alice);
    const c = open();
    await send(c, { t: 'auth', token: alice.token, v: 1 });
    const welcome = c.inbox.find((m) => m.t === 'welcome');
    expect(welcome).toMatchObject({ t: 'welcome', you: alice.memberId, room: { name: 'App team', code: 'AGV-AAAA-BBBB', theme: 'loft' } });
    expect(welcome?.t === 'welcome' && welcome.members[0]).toMatchObject({ name: 'Alice', online: true, owner: true });
  });

  it('rejects bad tokens and messages before auth', async () => {
    const { open, send } = setup();
    const c = open();
    await send(c, { t: 'auth', token: 'A'.repeat(43), v: 1 });
    expect(c.closed).toBe(CLOSE.unauthorized);
    const d = open();
    await send(d, { t: 'agents', n: 1 });
    expect(d.closed).toBe(CLOSE.unauthorized);
  });

  it('relays presence and agent counts to teammates only', async () => {
    const { core, open, send } = setup();
    const a = await core.addMember('Alice', appearance, true);
    const b = await core.addMember('Bob', appearance, false);
    if (typeof a === 'string' || typeof b === 'string') throw new Error();
    const ca = open();
    const cb = open();
    await send(ca, { t: 'auth', token: a.token, v: 1 });
    await send(cb, { t: 'auth', token: b.token, v: 1 });
    ca.inbox.length = 0;
    cb.inbox.length = 0;
    await send(ca, { t: 'presence', p: { x: 100, y: 120, facing: 'left', pose: 'walk' } });
    await send(ca, { t: 'agents', n: 3 });
    expect(cb.inbox).toEqual([
      { t: 'presence', id: a.memberId, p: { x: 100, y: 120, facing: 'left', pose: 'walk' } },
      { t: 'agents', id: a.memberId, n: 3 },
    ]);
    expect(ca.inbox).toEqual([]);
  });

  it('includes live presence and counts in a late joiner\'s welcome', async () => {
    const { core, open, send } = setup();
    const a = await core.addMember('Alice', appearance, true);
    const b = await core.addMember('Bob', appearance, false);
    if (typeof a === 'string' || typeof b === 'string') throw new Error();
    const ca = open();
    await send(ca, { t: 'auth', token: a.token, v: 1 });
    await send(ca, { t: 'agents', n: 2 });
    await send(ca, { t: 'presence', p: { x: 1, y: 2, facing: 'up', pose: 'sit', seat: 'ws-b1' } });
    const cb = open();
    await send(cb, { t: 'auth', token: b.token, v: 1 });
    const welcome = cb.inbox.find((m) => m.t === 'welcome');
    const alice = welcome?.t === 'welcome' ? welcome.members.find((m) => m.id === a.memberId) : undefined;
    expect(alice).toMatchObject({ online: true, agents: 2, presence: { pose: 'sit', seat: 'ws-b1' } });
    const bob = welcome?.t === 'welcome' ? welcome.members.find((m) => m.id === b.memberId) : undefined;
    expect(bob).toMatchObject({ online: true, agents: 0 });
  });

  it('shares layout changes from any member and stores them; map changes are ignored', async () => {
    const { core, open, send } = setup();
    const a = await core.addMember('Alice', appearance, true);
    const b = await core.addMember('Bob', appearance, false);
    if (typeof a === 'string' || typeof b === 'string') throw new Error();
    const ca = open();
    const cb = open();
    await send(ca, { t: 'auth', token: a.token, v: 1 });
    await send(cb, { t: 'auth', token: b.token, v: 1 });
    const doc = { version: 1, furniture: [{ id: 'desk-x', kind: 'desk', x: 3, y: 6 }], workstations: [{ id: 'ws-x', deskId: 'desk-x', facing: 'up' }] };
    await send(cb, { t: 'layout', theme: 'studio', doc });
    await send(cb, { t: 'theme', theme: 'studio' });
    expect(ca.inbox.at(-1)).toEqual({ t: 'layout', theme: 'studio', doc, by: b.memberId });
    const late = open();
    await send(late, { t: 'auth', token: a.token, v: 1 });
    const w = late.inbox.find((m) => m.t === 'welcome');
    expect(w?.t === 'welcome' && w.room).toMatchObject({ theme: 'loft', layouts: { studio: doc } });
  });

  it('replaces an older connection of the same member without announcing them offline', async () => {
    const { core, open, send } = setup();
    const a = await core.addMember('Alice', appearance, true);
    const b = await core.addMember('Bob', appearance, false);
    if (typeof a === 'string' || typeof b === 'string') throw new Error();
    const cb = open();
    await send(cb, { t: 'auth', token: b.token, v: 1 });
    const first = open();
    await send(first, { t: 'auth', token: a.token, v: 1 });
    const second = open();
    await send(second, { t: 'auth', token: a.token, v: 1 });
    expect(first.closed).toBe(CLOSE.replaced);
    core.onClose(first);
    expect(cb.inbox.some((m) => m.t === 'offline')).toBe(false);
    core.onClose(second);
    expect(cb.inbox.at(-1)).toEqual({ t: 'offline', id: a.memberId });
  });

  it('removes a member and clears the room when the last one leaves', async () => {
    const { core } = setup();
    const a = await core.addMember('Alice', appearance, true);
    const b = await core.addMember('Bob', appearance, false);
    if (typeof a === 'string' || typeof b === 'string') throw new Error();
    expect(core.removeMember(b.memberId)).toBe(false);
    expect(await core.memberFor(b.token)).toBeNull();
    expect(core.removeMember(a.memberId)).toBe(true);
    expect(core.meta).toBeNull();
  });

  it('rate limits floods', async () => {
    let t = 0;
    const conns: Conn[] = [];
    const core = new RoomCore(memoryStore(), () => conns, { random, sha256 }, () => t);
    core.create({ id: 'r'.repeat(32), name: 'x', code: 'AGV-AAAA-BBBB', theme: 'loft' });
    const a = await core.addMember('Alice', appearance, true);
    if (typeof a === 'string') throw new Error();
    const inbox: ServerMessage[] = [];
    const c: Conn = { state: { connId: 'c', agents: 0 }, save: () => {}, send: (r) => inbox.push(JSON.parse(r)), close: () => {} };
    conns.push(c);
    await core.onMessage(c, JSON.stringify({ t: 'auth', token: a.token, v: 1 }));
    for (let i = 0; i < 80; i++) await core.onMessage(c, JSON.stringify({ t: 'ping' }));
    expect(inbox.filter((m) => m.t === 'error' && m.code === 'rate_limited').length).toBeGreaterThan(0);
    t += 5000;
    inbox.length = 0;
    await core.onMessage(c, JSON.stringify({ t: 'ping' }));
    expect(inbox).toEqual([{ t: 'pong' }]);
  });
});
