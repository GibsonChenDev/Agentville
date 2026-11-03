import { appearanceFromSeed, sanitizeAppearance, type AgentRecord } from '@agentville/domain';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OfficeWorld, type CameraState, type HumanInfo, type PeerInfo, type SceneKey, type WorldAgent, type WorldDoor } from '../../game/engine/OfficeWorld';
import { lobbyDoorTile, lobbyScene, type SceneDefinition } from '../../game/scenes/layouts';
import { doorIdFor, lobbyDoorIds, usePlace } from '../../world/placeStore';
import { currentOfficeTheme } from '../../world/officeTheme';
import { useArcade } from '../arcade/ArcadeDialog';
import { i18n } from '../../i18n';
import { STATUS_TONE, currentCategory } from '../../presentation/status';
import { inMode, sceneFor, useApp, type AppState } from '../../state/store';
import { usePlayer } from '../../team/playerStore';
import { team } from '../../team/teamClient';
import { onlinePeers, useTeam, type TeamState } from '../../team/teamStore';
import { canPlace, useEditor } from './editorStore';
import { worldApi } from './worldApi';

/** Teammates' agents: anonymous characters at desks. Only their number is known. */
function peerAgents(team: TeamState): WorldAgent[] {
  const t = i18n.t.bind(i18n);
  const out: WorldAgent[] = [];
  for (const m of onlinePeers(team)) {
    for (let i = 0; i < m.agents; i++) {
      const id = `peer:${m.id}:${i}`;
      const record: AgentRecord = { id, name: t('team:agentOf', { name: m.name }), role: 'generalist', origin: 'external', kind: 'agent', appearance: appearanceFromSeed(id), createdAt: i };
      // Alternate screens so a row of teammates' agents doesn't look cloned; both read as "working".
      out.push({ record, status: i % 2 ? 'executing_tool' : 'writing', badge: { name: record.name, status: t('team:working'), tone: 'busy' } });
    }
  }
  return out;
}

function peers(team: TeamState): PeerInfo[] {
  const t = i18n.t.bind(i18n);
  return onlinePeers(team).map((m) => ({
    id: `peer:${m.id}`,
    name: m.name,
    appearance: sanitizeAppearance(m.appearance, appearanceFromSeed(m.id)),
    presence: m.presence,
    badge: {
      name: m.name,
      status: m.agents ? t('team:agentsWorking', { count: m.agents }) : t('team:noAgents'),
      tone: m.agents ? 'busy' : 'neutral',
      subtitle: m.agents ? t('team:agentsShort', { count: m.agents }) : undefined,
    },
  }));
}

function playerInfo(): HumanInfo {
  const t = i18n.t.bind(i18n);
  const p = usePlayer.getState();
  const name = p.name || t('team:you');
  return { name, appearance: p.appearance, badge: { name, status: t('team:youHint'), tone: 'neutral' } };
}

function worldAgents(s: AppState): WorldAgent[] {
  const t = i18n.t.bind(i18n);
  return Object.values(s.agents)
    .filter((a) => inMode(s.mode, a.origin))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((record) => {
      const r = s.runtime[record.id];
      const status = r?.status ?? 'disconnected';
      return {
        record,
        status,
        category: currentCategory(r),
        badge: {
          name: record.name,
          status: t(`agents:status.${status}`),
          tone: STATUS_TONE[status],
          subtitle: record.kind === 'subagent' ? t('agents:kind.subagent') : undefined,
        },
      };
    });
}

const PLATES = ['#4fb3a9', '#c7a3ff', '#e2705c', '#5cc77a', '#7fd1ff', '#ff8fb8'];

let lobbyCache: { rooms: unknown; scene: SceneDefinition } | undefined;
function lobbyFor(rooms: TeamState['rooms']): SceneDefinition {
  if (lobbyCache?.rooms !== rooms) {
    const doors = lobbyDoorIds().map((id, i) => ({ id, plate: id === 'personal' ? '#e0a93d' : id === 'new' ? '#8b93a7' : PLATES[(i - 1) % PLATES.length]! }));
    lobbyCache = { rooms, scene: lobbyScene(doors) };
  }
  return lobbyCache.scene;
}

/** What the world should show right now: the lobby, or the office you're in (with any layout draft). */
function currentScene(): { key: SceneKey; scene: SceneDefinition; placeKey: string } {
  const place = usePlace.getState().place;
  if (place.kind === 'lobby') return { key: 'lobby', scene: lobbyFor(useTeam.getState().rooms), placeKey: 'lobby' };
  const theme = currentOfficeTheme();
  const editor = useEditor.getState();
  const scene = editor.active && editor.draft ? editor.draft : sceneFor(useApp.getState(), theme);
  return { key: theme, scene, placeKey: doorIdFor(place) };
}

function doorsFor(key: SceneKey, scene: SceneDefinition): WorldDoor[] {
  const t = i18n.t.bind(i18n);
  if (key !== 'lobby') return [{ id: 'exit', tile: scene.door, label: t('team:place.toLobby') }];
  const rooms = useTeam.getState().rooms;
  return lobbyDoorIds().map((id, i) => ({
    id,
    tile: lobbyDoorTile(i),
    opens: true,
    label: id === 'personal' ? t('team:place.personal') : id === 'new' ? t('team:place.newOffice') : (rooms.find((r) => `team:${r.roomId}` === id)?.name ?? ''),
  }));
}

function onDoor(id: string) {
  const { go } = usePlace.getState();
  if (id === 'exit') void go({ kind: 'lobby' }, { viaDoor: id });
  else if (id === 'personal') void go({ kind: 'personal' }, { viaDoor: id });
  else if (id.startsWith('team:')) void go({ kind: 'team', roomId: id.slice(5) }, { viaDoor: id });
  else if (id === 'new') useTeam.getState().openDialog('create');
}

export function GameCanvas({ onCamera }: { onCamera: (c: CameraState) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const { t } = useTranslation('errors');

  useEffect(() => {
    if (!host.current) return;
    const world = new OfficeWorld({
      onSelect: (id) => useApp.getState().select(id),
      onCamera,
      onPresence: (p) => team.sendPresence(p),
      onPlayerClick: () => usePlayer.getState().openEditor(true),
      onDoor,
      onArcade: () => useArcade.getState().setOpen(true),
    });
    let cancelled = false;
    let shown: { key: SceneKey; scene: SceneDefinition; placeKey: string } | undefined;
    /** Rebuilds the world when you move or the layout changes; re-frames only when you move. */
    const applyScene = () => {
      if (!worldApi.current) return;
      const next = currentScene();
      const arrival = worldApi.arrival;
      if (!shown || shown.placeKey !== next.placeKey || shown.key !== next.key) {
        if (arrival && shown?.placeKey !== next.placeKey) {
          worldApi.arrival = undefined;
          world.arriveVia(arrival === 'office' ? next.scene.door : arrival);
        }
        world.setTheme(next.key, next.scene);
        world.fitZoom();
      } else if (shown.scene !== next.scene) world.setScene(next.scene);
      else return;
      shown = next;
      world.setDoors(doorsFor(next.key, next.scene));
    };
    const push = () => {
      const s = useApp.getState();
      const teamState = useTeam.getState();
      const inLobby = usePlace.getState().place.kind === 'lobby';
      world.sync(inLobby ? [] : [...worldAgents(s), ...peerAgents(teamState)], s.selectedAgentId, { reduceMotion: s.prefs.reduceMotion, alwaysShowLabels: s.prefs.alwaysShowLabels });
      world.syncPeers(inLobby ? [] : peers(teamState));
      world.setPlayer(playerInfo());
    };
    const initial = currentScene();
    world
      .init(host.current, initial.key, initial.scene)
      .then(() => {
        if (cancelled) return;
        worldApi.current = world;
        shown = initial;
        const arrival = worldApi.arrival;
        worldApi.arrival = undefined;
        if (arrival) world.arriveVia(arrival === 'office' ? initial.scene.door : arrival);
        world.setDoors(doorsFor(initial.key, initial.scene));
        applyScene(); // a saved layout may have loaded while the renderer was starting
        push();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    const update = () => {
      applyScene();
      push();
    };
    const unsubs = [useApp.subscribe(update), useTeam.subscribe(update), usePlayer.subscribe(push), usePlace.subscribe(update), useEditor.subscribe(applyScene)];
    // Renderer labels come from the same i18n source and refresh on language change.
    const relabel = () => {
      push();
      if (shown) world.setDoors(doorsFor(shown.key, shown.scene));
    };
    i18n.on('languageChanged', relabel);
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
      i18n.off('languageChanged', relabel);
      worldApi.current = null;
      world.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editor = useEditor();
  useEffect(() => {
    worldApi.current?.setEditing(
      editor.active ? { selectedId: editor.selectedId, placingKind: editor.placing } : null,
      {
        onPick: (id) => useEditor.getState().select(id),
        onDrop: (id, x, y) => useEditor.getState().move(id, x, y),
        onPlace: (kind, x, y) => useEditor.getState().place(kind, x, y),
        validate: canPlace,
      },
    );
  }, [editor.active, editor.selectedId, editor.placing, editor.draft]);

  useEffect(() => {
    const s = useApp.subscribe((state, prev) => {
      if (state.followAgentId !== prev.followAgentId) worldApi.current?.follow(state.followAgentId);
      // Real coordination steps become visible handoffs in the office.
      if (state.events !== prev.events && state.events.length) {
        const fresh = state.events.slice(-Math.max(1, state.events.length - prev.events.length));
        for (const e of fresh) {
          if (Date.now() - e.receivedAt > 5000) continue; // replayed history: don't animate the past
          const p = e.payload;
          if (p.kind === 'subagent.stopped') worldApi.current?.handoff(`${e.agentId}/${p.subagentId}`, e.agentId, 'report');
          if (p.kind === 'task.completed') {
            const task = Object.values(state.collab.tasks).find((t) => t.taskId === p.taskId && t.status === 'completed' && t.completedAt === e.at);
            const lead = Object.values(state.agents).find((a) => a.team?.role === 'lead' && a.team.key === task?.teamKey);
            if (task && lead) worldApi.current?.handoff(task.completedByAgentId ?? e.agentId, lead.id, 'task');
          }
        }
      }
    });
    return s;
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-muted" role="alert">
        {t('rendererFailed', { message: error })}
      </div>
    );
  }
  return <div ref={host} className="absolute inset-0 overflow-hidden" />;
}
