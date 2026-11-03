import { OFFICE_THEMES, type OfficeTheme } from '@agentville/domain';
import { PROTOCOL_VERSION, normalizeInviteCode, type ChatMessage, type ClientMessage, type MemberView, type Presence, type RoomView, type ServerMessage } from '@agentville/team-protocol';
import { useAccount } from '../account/accountStore';
import { worldApi } from '../features/office/worldApi';
import { fromLayoutDoc, toLayoutDoc } from '../game/scenes/editing';
import { DEFAULT_SCENES, type SceneDefinition } from '../game/scenes/layouts';
import { layoutSink, useApp, type AppState } from '../state/store';
import { TeamApiError, normalizeServer, socketUrl, teamApi } from './api';
import { usePlayer } from './playerStore';
import { cachedOffice, forgetOffice, rememberOffice } from './officeCache';
import { mergeChat, useTeam, type Membership, type TeamError } from './teamStore';

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
/** A teammate back within this long after dropping off (a network blip) isn't welcomed again. */
const REWELCOME_MS = 60_000;

let ws: WebSocket | undefined;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let keepalive: ReturnType<typeof setInterval> | undefined;
let agentsTimer: ReturnType<typeof setTimeout> | undefined;
let sentAgents = -1;
let started = false;
/** When each teammate last went offline, to tell a real arrival from a reconnect. */
const offlineAt = new Map<string, number>();

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

function teamLayouts(layouts: RoomView['layouts']): Partial<Record<OfficeTheme, SceneDefinition>> {
  const out: Partial<Record<OfficeTheme, SceneDefinition>> = {};
  for (const theme of OFFICE_THEMES) {
    const doc = layouts[theme];
    if (doc) out[theme] = fromLayoutDoc(doc, DEFAULT_SCENES[theme]);
  }
  return out;
}

/** The layouts the office is drawn with right now, to skip rebuilding it when nothing changed. */
let shownLayouts = '';

/** Draws the office with these layouts, unless they're the ones already shown (a rebuild re-seats everyone). */
function showLayouts(layouts: RoomView['layouts']) {
  const json = JSON.stringify(layouts);
  if (json === shownLayouts && useApp.getState().teamLayouts) return;
  shownLayouts = json;
  useApp.setState({ teamLayouts: teamLayouts(layouts) });
}

/** Remembers how the current office looks, so walking back in shows it straight away. */
function remember(room: RoomView | undefined) {
  if (room) rememberOffice(room.id, { theme: room.theme, layouts: room.layouts });
}

function handle(msg: ServerMessage, m: Membership) {
  const team = useTeam.getState();
  switch (msg.t) {
    case 'welcome': {
      retries = 0;
      useTeam.setState({ status: 'online', error: undefined, room: msg.room, members: Object.fromEntries(msg.members.map((x) => [x.id, x])), chat: mergeChat(team.chat, msg.chat ?? []) });
      // Joined with a code: the office's real name arrives here.
      const ref = team.rooms.find((r) => r.roomId === m.roomId);
      if (ref && ref.name !== msg.room.name) useTeam.getState().setRooms(team.rooms.map((r) => (r.roomId === m.roomId ? { ...r, name: msg.room.name } : r)));
      showLayouts(msg.room.layouts);
      remember(msg.room);
      useTeam.setState({ preview: undefined });
      keepalive = setInterval(() => send({ t: 'ping' }), KEEPALIVE_MS);
      sentAgents = -1;
      syncAgents(true);
      const me = msg.members.find((x) => x.id === m.memberId);
      const player = usePlayer.getState();
      if (player.name && (me?.name !== player.name || JSON.stringify(me?.appearance) !== JSON.stringify(player.appearance))) sendProfile();
      const p = worldApi.current?.presence();
      if (p) send({ t: 'presence', p });
      sendScores();
      return;
    }
    case 'member': {
      const before = team.members[msg.member.id];
      useTeam.setState({ members: { ...team.members, [msg.member.id]: msg.member } });
      const left = offlineAt.get(msg.member.id);
      if (msg.member.online && !before?.online && msg.member.id !== m.memberId && (left === undefined || Date.now() - left > REWELCOME_MS)) teamEvents.onArrive?.(msg.member);
      return;
    }
    case 'chat': {
      const mine = msg.m.from === m.memberId;
      useTeam.setState({ chat: mergeChat(team.chat, [msg.m]), chatUnread: team.chatOpen || mine ? team.chatUnread : team.chatUnread + 1 });
      teamEvents.onChat?.(msg.m, mine);
      return;
    }
    case 'offline': {
      offlineAt.set(msg.id, Date.now());
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
      if (team.room) {
        useTeam.setState({ room: { ...team.room, theme: msg.theme } });
        remember(useTeam.getState().room);
      }
      return;
    case 'layout': {
      if (!team.room) return;
      const layouts = { ...team.room.layouts };
      if (msg.doc) layouts[msg.theme] = msg.doc;
      else delete layouts[msg.theme];
      const room = { ...team.room, layouts };
      useTeam.setState({ room });
      showLayouts(layouts);
      remember(room);
      return;
    }
    case 'code':
      if (team.room) useTeam.setState({ room: { ...team.room, code: msg.code } });
      return;
    case 'error':
      if (msg.code === 'removed') leaveLocally('removed');
      // Chat is the only thing people send fast enough by hand to hit a limit.
      if (msg.code === 'rate_limited') useTeam.setState({ chatNotice: 'rate_limited' });
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

/** Your arcade best scores, so teammates can see them on the cabinet. */
function sendScores() {
  const scores = useAccount.getState().account?.scores;
  if (scores && Object.keys(scores).length) send({ t: 'scores', s: { ...scores } });
}

function sendProfile() {
  const { name, appearance } = usePlayer.getState();
  if (name) send({ t: 'profile', name, appearance: { ...appearance } });
}

/**
 * `onLeft`: you're no longer in the current team office (left, removed, or it was deleted).
 * `onArrive`: a teammate just came into the office you're in.
 * `onChat`: a chat message arrived (`mine`: you sent it).
 */
export const teamEvents: { onLeft?: (roomId: string) => void; onArrive?: (member: MemberView) => void; onChat?: (m: ChatMessage, mine: boolean) => void } = {};

/** Disconnects; with `forget`, also drops the office from your list (left or removed). */
function leaveLocally(error?: TeamError, forget = true) {
  const roomId = useTeam.getState().membership?.roomId;
  closeSocket();
  retries = 0;
  useTeam.getState().setActive(undefined);
  if (forget && roomId) useTeam.getState().setRooms(useTeam.getState().rooms.filter((r) => r.roomId !== roomId));
  useTeam.setState({ error, preview: undefined });
  useApp.setState({ teamLayouts: undefined });
  shownLayouts = '';
  if (forget && roomId) {
    forgetOffice(roomId);
    teamEvents.onLeft?.(roomId);
  }
}

function serverOrThrow() {
  const server = normalizeServer(useTeam.getState().server);
  if (!server) throw new TeamApiError('no_server');
  return server;
}

/** Creates or joins an office and adds it to your list; walking in is up to the caller. */
async function enter(run: (server: string) => Promise<{ roomId: string; memberId: string; token: string; owner: boolean }>, name: string, roomName: string): Promise<string> {
  const server = serverOrThrow();
  const res = await run(server);
  usePlayer.getState().save(name, usePlayer.getState().appearance);
  const rooms = useTeam.getState().rooms.filter((r) => r.roomId !== res.roomId);
  useTeam.getState().setRooms([...rooms, { roomId: res.roomId, memberId: res.memberId, token: res.token, owner: res.owner, name: roomName }]);
  return res.roomId;
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
        shownLayouts = JSON.stringify(layouts);
        remember(useTeam.getState().room);
      }
      send({ t: 'layout', theme, doc });
    };
    useApp.subscribe((s, prev) => {
      if (s.agents !== prev.agents || s.runtime !== prev.runtime) syncAgents();
    });
    usePlayer.subscribe((s, prev) => {
      if (s.name !== prev.name || s.appearance !== prev.appearance) sendProfile();
    });
    useAccount.subscribe((s, prev) => {
      if (JSON.stringify(s.account?.scores) !== JSON.stringify(prev.account?.scores)) sendScores();
    });
    window.addEventListener('online', () => {
      if (useTeam.getState().status === 'reconnecting') connect();
    });
  },

  /** Goes into one of your team offices (connects to it). */
  open(roomId: string) {
    if (useTeam.getState().membership?.roomId === roomId && ws) return;
    closeSocket();
    useTeam.getState().setActive(roomId);
    // Draw the office as it looked last time (never your own office's layout) until the relay answers.
    const cached = cachedOffice(roomId);
    useTeam.setState({ room: undefined, preview: cached });
    shownLayouts = '';
    showLayouts(cached?.layouts ?? {});
    retries = 0;
    connect();
  },

  /** Steps out of the current team office (you stay a member). */
  close() {
    if (!useTeam.getState().membership) return;
    leaveLocally(undefined, false);
  },

  create: (roomName: string, name: string) => enter((server) => teamApi.create(server, roomName, name, { ...usePlayer.getState().appearance }), name, roomName),

  join: (code: string, name: string) => {
    const normalized = normalizeInviteCode(code);
    if (!normalized) return Promise.reject(new TeamApiError('invalid_code'));
    return enter((server) => teamApi.join(server, normalized, name, { ...usePlayer.getState().appearance }), name, normalized);
  },

  /** Leaves the current team office for good. */
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

  /** Sends a chat message to the office; false when not connected (the message isn't queued). */
  sendChat(text: string): boolean {
    if (useTeam.getState().status !== 'online' || ws?.readyState !== WebSocket.OPEN) {
      useTeam.setState({ chatNotice: 'offline' });
      return false;
    }
    useTeam.setState({ chatNotice: undefined });
    send({ t: 'chat', text });
    return true;
  },
};
