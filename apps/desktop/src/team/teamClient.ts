import { OFFICE_THEMES, type OfficeTheme } from '@agentville/domain';
import { PROTOCOL_VERSION, normalizeInviteCode, type ClientMessage, type Presence, type RoomView, type ServerMessage } from '@agentville/team-protocol';
import { worldApi } from '../features/office/worldApi';
import { fromLayoutDoc, toLayoutDoc } from '../game/scenes/editing';
import { DEFAULT_SCENES, type SceneDefinition } from '../game/scenes/layouts';
import { layoutSink, useApp, type AppState } from '../state/store';
import { TeamApiError, normalizeServer, socketUrl, teamApi } from './api';
import { usePlayer } from './playerStore';
import { useTeam, type Membership, type TeamError } from './teamStore';

/**
 * Keeps this app in its team office: one WebSocket to the relay, reconnecting
 * with backoff. What it sends is limited to your avatar (position, look,
 * nickname), how many of your agents are in the office, and office edits.
 */

const CLOSE_UNAUTHORIZED = 4001;
const CLOSE_VERSION = 4002;
const CLOSE_REPLACED = 4003;
const CLOSE_REMOVED = 4004;
const KEEPALIVE_MS = 30_000;

let ws: WebSocket | undefined;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let keepalive: ReturnType<typeof setInterval> | undefined;
let agentsTimer: ReturnType<typeof setTimeout> | undefined;
let sentAgents = -1;
let started = false;

function send(m: ClientMessage) {
  if (ws?.readyState === WebSocket.OPEN && useTeam.getState().status === 'online') ws.send(JSON.stringify(m));
}

function closeSocket() {
  clearTimeout(retryTimer);
  clearInterval(keepalive);
  const old = ws;
  ws = undefined;
  if (old && old.readyState <= WebSocket.OPEN) old.close(1000, 'bye');
}

function connect() {
  const m = useTeam.getState().membership;
  if (!m) return;
  closeSocket();
  useTeam.setState({ status: retries ? 'reconnecting' : 'connecting' });
  let sock: WebSocket;
  try {
    sock = new WebSocket(socketUrl(m.server, m.roomId));
  } catch {
    scheduleReconnect();
    return;
  }
  ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ t: 'auth', token: m.token, v: PROTOCOL_VERSION } satisfies ClientMessage));
  sock.onmessage = (e) => {
    if (ws !== sock || typeof e.data !== 'string') return;
    try {
      handle(JSON.parse(e.data) as ServerMessage, m);
    } catch {
      // ignore malformed frames
    }
  };
  sock.onclose = (e) => {
    if (ws !== sock) return;
    ws = undefined;
    clearInterval(keepalive);
    if (e.code === CLOSE_UNAUTHORIZED) leaveLocally('unauthorized');
    else if (e.code === CLOSE_REMOVED) leaveLocally('removed');
    else if (e.code === CLOSE_VERSION) useTeam.setState({ status: 'idle', error: 'version' });
    else if (e.code === CLOSE_REPLACED) useTeam.setState({ status: 'idle' });
    else scheduleReconnect();
  };
}

function scheduleReconnect() {
  clearTimeout(retryTimer);
  if (!useTeam.getState().membership) return;
  const delay = Math.min(30_000, 1000 * 2 ** retries) * (0.75 + Math.random() * 0.5);
  retries = Math.min(retries + 1, 6);
  useTeam.setState({ status: 'reconnecting' });
  retryTimer = setTimeout(connect, delay);
}

function teamLayouts(room: RoomView): Partial<Record<OfficeTheme, SceneDefinition>> {
  const out: Partial<Record<OfficeTheme, SceneDefinition>> = {};
  for (const theme of OFFICE_THEMES) {
    const doc = room.layouts[theme];
    if (doc) out[theme] = fromLayoutDoc(doc, DEFAULT_SCENES[theme]);
  }
  return out;
}

/** Switches this app to the room's office (unknown future themes are ignored). */
function applyTheme(theme: string) {
  if ((OFFICE_THEMES as readonly string[]).includes(theme) && useApp.getState().prefs.theme !== theme) useApp.getState().setTheme(theme as OfficeTheme);
}

function handle(msg: ServerMessage, m: Membership) {
  const team = useTeam.getState();
  switch (msg.t) {
    case 'welcome': {
      retries = 0;
      useTeam.setState({ status: 'online', error: undefined, room: msg.room, members: Object.fromEntries(msg.members.map((x) => [x.id, x])) });
      useApp.setState({ teamLayouts: teamLayouts(msg.room) });
      applyTheme(msg.room.theme);
      keepalive = setInterval(() => send({ t: 'ping' }), KEEPALIVE_MS);
      sentAgents = -1;
      syncAgents(true);
      const me = msg.members.find((x) => x.id === m.memberId);
      const player = usePlayer.getState();
      if (player.name && (me?.name !== player.name || JSON.stringify(me?.appearance) !== JSON.stringify(player.appearance))) sendProfile();
      const p = worldApi.current?.presence();
      if (p) send({ t: 'presence', p });
      return;
    }
    case 'member':
      useTeam.setState({ members: { ...team.members, [msg.member.id]: msg.member } });
      return;
    case 'offline': {
      const x = team.members[msg.id];
      if (x) useTeam.setState({ members: { ...team.members, [msg.id]: { ...x, online: false, agents: 0, presence: undefined } } });
      return;
    }
    case 'removed': {
      if (msg.id === m.memberId) return leaveLocally('removed');
      const { [msg.id]: _gone, ...members } = team.members;
      useTeam.setState({ members });
      return;
    }
    case 'presence': {
      const x = team.members[msg.id];
      if (x) useTeam.setState({ members: { ...team.members, [msg.id]: { ...x, presence: msg.p } } });
      return;
    }
    case 'agents': {
      const x = team.members[msg.id];
      if (x) useTeam.setState({ members: { ...team.members, [msg.id]: { ...x, agents: msg.n } } });
      return;
    }
    case 'theme':
      if (team.room) useTeam.setState({ room: { ...team.room, theme: msg.theme } });
      applyTheme(msg.theme);
      return;
    case 'layout': {
      if (!team.room) return;
      const layouts = { ...team.room.layouts };
      if (msg.doc) layouts[msg.theme] = msg.doc;
      else delete layouts[msg.theme];
      const room = { ...team.room, layouts };
      useTeam.setState({ room });
      useApp.setState({ teamLayouts: teamLayouts(room) });
      return;
    }
    case 'code':
      if (team.room) useTeam.setState({ room: { ...team.room, code: msg.code } });
      return;
    case 'error':
      if (msg.code === 'removed') leaveLocally('removed');
      return;
    case 'pong':
      return;
  }
}

/** Number of your live agents in the office — the only thing teammates learn about your Claude Code activity. */
export function liveAgentCount(s: Pick<AppState, 'agents' | 'runtime'>) {
  return Object.values(s.agents).filter((a) => a.origin !== 'demo' && (s.runtime[a.id]?.status ?? 'disconnected') !== 'disconnected').length;
}

function syncAgents(now = false) {
  clearTimeout(agentsTimer);
  const push = () => {
    const n = Math.min(32, liveAgentCount(useApp.getState()));
    if (n === sentAgents || useTeam.getState().status !== 'online') return;
    sentAgents = n;
    send({ t: 'agents', n });
  };
  if (now) push();
  else agentsTimer = setTimeout(push, 400);
}

function sendProfile() {
  const { name, appearance } = usePlayer.getState();
  if (name) send({ t: 'profile', name, appearance: { ...appearance } });
}

function leaveLocally(error?: TeamError) {
  closeSocket();
  retries = 0;
  useTeam.getState().setMembership(undefined);
  useTeam.setState({ error });
  useApp.setState({ teamLayouts: undefined });
}

function serverOrThrow() {
  const server = normalizeServer(useTeam.getState().server);
  if (!server) throw new TeamApiError('no_server');
  return server;
}

async function enter(run: (server: string) => Promise<{ roomId: string; memberId: string; token: string; owner: boolean }>, name: string) {
  const server = serverOrThrow();
  const res = await run(server);
  usePlayer.getState().save(name, usePlayer.getState().appearance);
  leaveLocally();
  useTeam.getState().setMembership({ server, roomId: res.roomId, memberId: res.memberId, token: res.token, owner: res.owner });
  connect();
}

export const team = {
  /** Installs the store subscriptions once and reconnects to a saved team office. */
  start() {
    if (started) return;
    started = true;
    layoutSink.current = (theme, scene) => {
      const room = useTeam.getState().room;
      const doc = scene ? toLayoutDoc(scene) : null;
      if (room) {
        const layouts = { ...room.layouts };
        if (doc) layouts[theme] = doc;
        else delete layouts[theme];
        useTeam.setState({ room: { ...room, layouts } });
      }
      send({ t: 'layout', theme, doc });
    };
    useApp.subscribe((s, prev) => {
      if (s.agents !== prev.agents || s.runtime !== prev.runtime) syncAgents();
      const room = useTeam.getState().room;
      if (s.prefs.theme !== prev.prefs.theme && room && useTeam.getState().status === 'online' && room.theme !== s.prefs.theme) {
        useTeam.setState({ room: { ...room, theme: s.prefs.theme } });
        send({ t: 'theme', theme: s.prefs.theme });
      }
    });
    usePlayer.subscribe((s, prev) => {
      if (s.name !== prev.name || s.appearance !== prev.appearance) sendProfile();
    });
    window.addEventListener('online', () => {
      if (useTeam.getState().status === 'reconnecting') connect();
    });
    if (useTeam.getState().membership) connect();
  },

  create: (roomName: string, name: string) => enter((server) => teamApi.create(server, roomName, name, { ...usePlayer.getState().appearance }), name),

  join: (code: string, name: string) => {
    const normalized = normalizeInviteCode(code);
    if (!normalized) return Promise.reject(new TeamApiError('invalid_code'));
    return enter((server) => teamApi.join(server, normalized, name, { ...usePlayer.getState().appearance }), name);
  },

  async leave() {
    const m = useTeam.getState().membership;
    if (m) await teamApi.leave(m.server, m.roomId, m.token).catch(() => undefined);
    leaveLocally();
  },

  async rotateCode() {
    const m = useTeam.getState().membership;
    if (!m) return;
    const { code } = await teamApi.rotate(m.server, m.roomId, m.token);
    const room = useTeam.getState().room;
    if (room) useTeam.setState({ room: { ...room, code } });
  },

  retry() {
    retries = 0;
    connect();
  },

  sendPresence(p: Presence) {
    send({ t: 'presence', p });
  },
};
