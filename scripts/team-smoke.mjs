#!/usr/bin/env node
// Two-client smoke test for the team relay: create → join → presence/agents/layout → rotate → leave.
// Usage: node scripts/team-smoke.mjs [server]   (default http://127.0.0.1:8787)
const server = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const ws = server.replace(/^http/, 'ws');
const look = { hairStyle: 'bob', top: 'hoodie' };

async function post(path, body, token) {
  const res = await fetch(server + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
  return { status: res.status, body: await res.json() };
}

function connect(m) {
  const sock = new WebSocket(`${ws}/v1/rooms/${m.roomId}/ws`);
  const inbox = [];
  const waiters = [];
  sock.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    inbox.push(msg);
    for (const w of [...waiters]) if (w.test(msg)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(msg));
  };
  const opened = new Promise((r) => (sock.onopen = r));
  return {
    sock,
    inbox,
    send: (msg) => sock.send(JSON.stringify(msg)),
    wait: (test, ms = 3000) => {
      const hit = inbox.find(test);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        waiters.push({ test, resolve });
        setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      });
    },
    opened,
  };
}

const check = (cond, label) => {
  if (!cond) throw new Error(`FAIL: ${label}`);
  console.log(`✓ ${label}`);
};

const created = await post('/v1/rooms', { roomName: 'App team', name: 'Alice', appearance: look });
check(created.status === 200 && created.body.owner, 'create room');
const alice = created.body;

const a = connect(alice);
await a.opened;
a.send({ t: 'auth', token: alice.token, v: 1 });
const welcomeA = await a.wait((m) => m.t === 'welcome');
const code = welcomeA.room.code;
check(/^AGV-.{4}-.{4}$/.test(code), `welcome carries invite code ${code}`);

const bad = await post('/v1/join', { code: 'AGV-0000-0000', name: 'Mallory', appearance: look });
check(bad.status === 404 && bad.body.error === 'invalid_code', 'wrong code rejected');

const joined = await post('/v1/join', { code: code.toLowerCase().replace(/-/g, ' '), name: 'Bob', appearance: look });
check(joined.status === 200 && !joined.body.owner, 'join with sloppy code');
const bob = joined.body;
await a.wait((m) => m.t === 'member' && m.member.name === 'Bob');
check(true, 'owner sees Bob join');

const b = connect(bob);
await b.opened;
b.send({ t: 'auth', token: bob.token, v: 1 });
const welcomeB = await b.wait((m) => m.t === 'welcome');
check(welcomeB.members.length === 2, 'Bob sees both members');

a.send({ t: 'agents', n: 3 });
a.send({ t: 'presence', p: { x: 120, y: 140, facing: 'up', pose: 'sit', seat: 'ws-b1', secret: 'x' } });
const agents = await b.wait((m) => m.t === 'agents');
const presence = await b.wait((m) => m.t === 'presence');
check(agents.n === 3 && agents.id === alice.memberId, 'agent count relayed');
check(presence.p.seat === 'ws-b1' && !('secret' in presence.p), 'presence relayed without extra fields');

const doc = { version: 1, furniture: [{ id: 'desk-x', kind: 'desk', x: 3, y: 6 }], workstations: [{ id: 'ws-x', deskId: 'desk-x', facing: 'up' }] };
b.send({ t: 'layout', theme: 'loft', doc });
b.send({ t: 'theme', theme: 'midnight' });
await a.wait((m) => m.t === 'layout');
const theme = await a.wait((m) => m.t === 'theme');
check(theme.theme === 'midnight', 'non-owner can change theme and layout');

const notOwner = await post(`/v1/rooms/${bob.roomId}/rotate`, {}, bob.token);
check(notOwner.status === 403, 'only the creator can rotate the code');
const rotated = await post(`/v1/rooms/${alice.roomId}/rotate`, {}, alice.token);
check(rotated.status === 200 && rotated.body.code !== code, `code rotated to ${rotated.body.code}`);
await b.wait((m) => m.t === 'code' && m.code === rotated.body.code);
check(true, 'members get the new code');
const old = await post('/v1/join', { code, name: 'Late', appearance: look });
check(old.status === 404, 'old code no longer works');

const left = await post(`/v1/rooms/${bob.roomId}/leave`, {}, bob.token);
check(left.status === 200, 'Bob leaves');
await a.wait((m) => m.t === 'removed' && m.id === bob.memberId);
check(true, 'owner sees Bob removed');

a.sock.close();
await post(`/v1/rooms/${alice.roomId}/leave`, {}, alice.token);
const gone = await post('/v1/join', { code: rotated.body.code, name: 'Late', appearance: look });
check(gone.status === 404, 'empty room is deleted');
// ── accounts
const acct = await post('/v1/accounts', {});
check(acct.status === 200 && acct.body.account.coins > 0, `account created with ${acct.body.account.coins} starter coins`);
const recovery = acct.body.code;
const me = async (path, body, c = recovery) => {
  const res = await fetch(`${server}/v1/me${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${c}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const prof = await me('/profile', { name: 'Alice', appearance: look });
check(prof.status === 200 && prof.body.account.profile.name === 'Alice', 'profile saved');
const restored = await me('', undefined, recovery.toLowerCase().replace(/-/g, ''));
check(restored.status === 200 && restored.body.account.profile.name === 'Alice', 'recovery code (retyped) restores the account');
const earned = await me('/earn', { turns: 2, tools: 3 });
check(earned.body.credited === 23, `2 turns + 3 tools credited ${earned.body.credited} coins`);
const bought = await me('/buy', { item: 'deco.lava_lamp' });
check(bought.status === 200 && bought.body.account.inventory.includes('deco.lava_lamp'), 'bought a lava lamp');
const again = await me('/buy', { item: 'deco.lava_lamp' });
check(again.status === 400 && again.body.error === 'owned', 'cannot buy twice');
const poor = await me('/buy', { item: 'acc.crown' });
check(poor.body.error === 'insufficient_funds', 'cannot buy without enough coins');
const score = await me('/score', { game: 'snake', score: 42 });
check(score.body.account.scores.snake === 42, 'arcade best score saved');
const wrong = await me('', undefined, 'AAAAA-AAAAA-AAAAA-AAAAA-AAAAA');
check(wrong.status === 401, 'unknown recovery code rejected');

console.log('\nAll relay checks passed.');
process.exit(0);
