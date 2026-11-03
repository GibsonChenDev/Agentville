import { describe, expect, it } from 'vitest';
import type { LayoutDocWire, MemberView, ServerMessage } from '../../../packages/team-protocol/src/index.ts';
import { CLOSE, RoomCore, STALE_MS, random, sha256, type Conn, type RoomMeta, type RoomStore, type StoredMember } from './roomCore';

/**
 * Edge cases of a shared office, as teammates would ask them: what happens
 * when someone leaves or their laptop sleeps, whether arcade records, looks
 * and furniture are visible to everyone, and whether one person switching the
 * map affects the others.
 */

function memoryStore(): RoomStore {
  let meta: RoomMeta | null = null;
  const members = new Map<string, StoredMember>();
  const layouts = new Map<string, LayoutDocWire>();
  return {
    meta: () => meta,
    setMeta: (m) => (meta = m),
    members: () => [...members.values()],
    putMember: (m) => void members.set(m.id, m),
    deleteMember: (id) => void members.delete(id),
    layouts: () => Object.fromEntries(layouts),
    putLayout: (t, d) => (d ? layouts.set(t, d) : layouts.delete(t)),
    clear: () => {
      meta = null;
      members.clear();
      layouts.clear();
    },
  };
}

interface FakeConn extends Conn {
  inbox: ServerMessage[];
  closed?: number;
  pingAt?: number;
}

const look = { hairStyle: 'bob', top: 'hoodie', accessory: 'glasses' };

async function office(names: string[]) {
  let now = 1_000_000;
  const conns: FakeConn[] = [];
  const core = new RoomCore(memoryStore(), () => conns.filter((c) => c.closed === undefined), { random, sha256 }, () => now);
  core.create({ id: 'r'.repeat(32), name: 'Team', code: 'AGV-AAAA-BBBB', theme: 'loft' });
  const tokens: Record<string, { memberId: string; token: string }> = {};
  for (const [i, name] of names.entries()) {
    const m = await core.addMember(name, look, i === 0);
    if (typeof m === 'string') throw new Error(m);
    tokens[name] = m;
  }
  let n = 0;
  const connect = async (name: string) => {
    const c: FakeConn = {
      state: { connId: `c${n++}`, agents: 0, openedAt: now },
      inbox: [],
      save: () => {},
      send: (raw) => c.inbox.push(JSON.parse(raw) as ServerMessage),
      close: (code) => {
        c.closed = code;
        core.onClose(c);
      },
      lastPing: () => c.pingAt,
    };
    conns.push(c);
    await core.onMessage(c, JSON.stringify({ t: 'auth', token: tokens[name]!.token, v: 1 }));
    return c;
  };
  /** An open socket that hasn't sent anything yet. */
  const raw = () => {
    const c: FakeConn = { state: { connId: `c${n++}`, agents: 0, openedAt: now }, inbox: [], save: () => {}, send: () => {}, close: (code) => (c.closed = code) };
    conns.push(c);
    return c;
  };
  const send = (c: Conn, m: unknown) => core.onMessage(c, JSON.stringify(m));
  const id = (name: string) => tokens[name]!.memberId;
  const welcomeOf = (c: FakeConn) => c.inbox.find((m): m is Extract<ServerMessage, { t: 'welcome' }> => m.t === 'welcome')!;
  const memberIn = (c: FakeConn, name: string): MemberView | undefined => {
    let view = welcomeOf(c).members.find((m) => m.id === id(name));
    for (const m of c.inbox) if (m.t === 'member' && m.member.id === id(name)) view = m.member;
    return view;
  };
  return { core, connect, raw, send, id, memberIn, welcomeOf, tick: (ms: number) => (now += ms), now: () => now };
}

describe('someone leaves the office or closes the app', () => {
  it('teammates see them go offline and their agents disappear (count drops to 0)', async () => {
    const o = await office(['Alice', 'Bob']);
    const a = await o.connect('Alice');
    const b = await o.connect('Bob');
    await o.send(a, { t: 'agents', n: 5 });
    expect(b.inbox.at(-1)).toEqual({ t: 'agents', id: o.id('Alice'), n: 5 });
    // Closing the app closes the socket.
    o.core.onClose(a);
    expect(b.inbox.at(-1)).toEqual({ t: 'offline', id: o.id('Alice') });
    // Bob's next welcome (e.g. after his own reconnect) shows Alice offline with no agents.
    const b2 = await o.connect('Bob');
    expect(o.memberIn(b2, 'Alice')).toMatchObject({ online: false, agents: 0 });
    expect(o.memberIn(b2, 'Alice')?.presence).toBeUndefined();
  });

  it('coming back starts from zero agents until the app reports its count again', async () => {
    const o = await office(['Alice', 'Bob']);
    const a = await o.connect('Alice');
    const b = await o.connect('Bob');
    await o.send(a, { t: 'agents', n: 4 });
    o.core.onClose(a);
    const a2 = await o.connect('Alice');
    expect(b.inbox.at(-1)).toMatchObject({ t: 'member', member: { id: o.id('Alice'), online: true, agents: 0 } });
    await o.send(a2, { t: 'agents', n: 4 });
    expect(b.inbox.at(-1)).toEqual({ t: 'agents', id: o.id('Alice'), n: 4 });
  });

  it('a laptop that sleeps without closing its socket is dropped as a ghost', async () => {
    const o = await office(['Alice', 'Bob']);
    const a = await o.connect('Alice');
    const b = await o.connect('Bob');
    await o.send(a, { t: 'agents', n: 2 });
    // Bob keeps pinging (answered by the runtime), Alice goes silent.
    o.tick(STALE_MS / 2);
    b.pingAt = o.now();
    expect(o.core.sweep()).toBe(2);
    o.tick(STALE_MS / 2 + 1);
    b.pingAt = o.now();
    expect(o.core.sweep()).toBe(1);
    expect(a.closed).toBe(CLOSE.stale);
    expect(b.closed).toBeUndefined();
    expect(b.inbox.at(-1)).toEqual({ t: 'offline', id: o.id('Alice') });
  });

  it('a socket that never authenticates is closed quickly', async () => {
    const o = await office(['Alice']);
    const stray = o.raw();
    o.tick(20_000);
    expect(o.core.sweep()).toBe(1);
    o.tick(11_000);
    expect(o.core.sweep()).toBe(0);
    expect(stray.closed).toBe(CLOSE.stale);
  });

  it('leaving for good removes them; the last one out deletes the office', async () => {
    const o = await office(['Alice', 'Bob']);
    const b = await o.connect('Bob');
    expect(o.core.removeMember(o.id('Alice'))).toBe(false);
    expect(b.inbox.at(-1)).toEqual({ t: 'removed', id: o.id('Alice') });
    expect(o.core.removeMember(o.id('Bob'))).toBe(true);
    expect(o.core.meta).toBeNull();
  });
});

describe('arcade best scores', () => {
  it('are shared with everyone in the office, including people who arrive later', async () => {
    const o = await office(['Alice', 'Bob', 'Carol']);
    const a = await o.connect('Alice');
    const b = await o.connect('Bob');
    await o.send(a, { t: 'scores', s: { snake: 120, g2048: 4096 } });
    expect(o.memberIn(b, 'Alice')?.scores).toEqual({ snake: 120, g2048: 4096 });
    o.core.onClose(a);
    // Alice is offline, but her records stay on the board for Carol.
    const c = await o.connect('Carol');
    expect(o.memberIn(c, 'Alice')).toMatchObject({ online: false, scores: { snake: 120, g2048: 4096 } });
  });

  it('only ever go up, and nonsense is rejected', async () => {
    const o = await office(['Alice', 'Bob']);
    const a = await o.connect('Alice');
    const b = await o.connect('Bob');
    await o.send(a, { t: 'scores', s: { snake: 120 } });
    const seen = b.inbox.length;
    await o.send(a, { t: 'scores', s: { snake: 80 } });
    expect(b.inbox.length).toBe(seen); // nothing new to tell anyone
    await o.send(a, { t: 'scores', s: { snake: 150, flappy: 9 } });
    expect(o.memberIn(b, 'Alice')?.scores).toEqual({ snake: 150, flappy: 9 });
    for (const bad of [{ chess: 1 }, { snake: -1 }, { snake: 1.5 }, { snake: 1e9 }, [1, 2], 'lots']) {
      a.inbox.length = 0;
      await o.send(a, { t: 'scores', s: bad });
      expect(a.inbox).toEqual([{ t: 'error', code: 'bad_message' }]);
    }
    expect(o.memberIn(b, 'Alice')?.scores).toEqual({ snake: 150, flappy: 9 });
  });
});

describe('looks and office decorations', () => {
  it('a new outfit (including bought items) shows for everyone', async () => {
    const o = await office(['Alice', 'Bob']);
    const a = await o.connect('Alice');
    const b = await o.connect('Bob');
    const outfit = { ...look, accessory: 'viking', topColor: 'sakura' };
    await o.send(a, { t: 'profile', name: 'Alice', appearance: outfit });
    expect(o.memberIn(b, 'Alice')?.appearance).toEqual(outfit);
    // and it's remembered for the next welcome
    const b2 = await o.connect('Bob');
    expect(o.memberIn(b2, 'Alice')?.appearance).toEqual(outfit);
  });

  it('furniture edits, including shop decorations tagged with their buyer, reach everyone unchanged', async () => {
    const o = await office(['Alice', 'Bob']);
    const a = await o.connect('Alice');
    const b = await o.connect('Bob');
    const doc: LayoutDocWire = {
      version: 1,
      furniture: [
        { id: 'desk-a', kind: 'desk', x: 3, y: 6 },
        { id: 'item-1a2b3c4d-u7', kind: 'piano', x: 10, y: 10 },
        { id: 'item-1a2b3c4d-u8', kind: 'ping_pong', x: 14, y: 12 },
      ],
      workstations: [{ id: 'ws-a', deskId: 'desk-a', facing: 'up' }],
    };
    await o.send(a, { t: 'layout', theme: 'garden', doc });
    expect(b.inbox.at(-1)).toEqual({ t: 'layout', theme: 'garden', doc, by: o.id('Alice') });
    expect(a.inbox.some((m) => m.t === 'layout')).toBe(false); // the editor already has it
  });
});

describe('switching the map (場地)', () => {
  it('in a team office, the map is shared: one person switching changes it for everyone, now and later', async () => {
    const o = await office(['Alice', 'Bob', 'Carol']);
    const a = await o.connect('Alice');
    const b = await o.connect('Bob');
    await o.send(b, { t: 'theme', theme: 'seaside' });
    expect(a.inbox.at(-1)).toEqual({ t: 'theme', theme: 'seaside', by: o.id('Bob') });
    expect(b.inbox.at(-1)).toEqual({ t: 'theme', theme: 'seaside', by: o.id('Bob') });
    const c = await o.connect('Carol');
    expect(o.welcomeOf(c).room.theme).toBe('seaside');
  });

  it('picking the map that is already shown sends nothing', async () => {
    const o = await office(['Alice', 'Bob']);
    const a = await o.connect('Alice');
    const b = await o.connect('Bob');
    const seen = b.inbox.length;
    await o.send(a, { t: 'theme', theme: 'loft' });
    expect(b.inbox.length).toBe(seen);
  });

  it('walking out to the lobby or into another office just shows you offline here; nothing else changes', async () => {
    const o = await office(['Alice', 'Bob']);
    const a = await o.connect('Alice');
    const b = await o.connect('Bob');
    await o.send(a, { t: 'theme', theme: 'garden' });
    o.core.onClose(a); // the app closes this office's socket when you leave the room
    expect(b.inbox.at(-1)).toEqual({ t: 'offline', id: o.id('Alice') });
    const b2 = await o.connect('Bob');
    expect(o.welcomeOf(b2).room.theme).toBe('garden');
  });
});
