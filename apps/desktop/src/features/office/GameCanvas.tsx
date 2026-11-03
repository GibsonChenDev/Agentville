import { appearanceFromSeed, sanitizeAppearance, type AgentRecord } from '@agentville/domain';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OfficeWorld, type CameraState, type HumanInfo, type PeerInfo, type WorldAgent } from '../../game/engine/OfficeWorld';
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

export function GameCanvas({ onCamera }: { onCamera: (c: CameraState) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const theme = useApp((s) => s.prefs.theme);
  const { t } = useTranslation('errors');

  useEffect(() => {
    if (!host.current) return;
    const world = new OfficeWorld({
      onSelect: (id) => useApp.getState().select(id),
      onCamera,
      onPresence: (p) => team.sendPresence(p),
      onPlayerClick: () => usePlayer.getState().openEditor(true),
    });
    let cancelled = false;
    const push = () => {
      const s = useApp.getState();
      const teamState = useTeam.getState();
      world.sync([...worldAgents(s), ...peerAgents(teamState)], s.selectedAgentId, { reduceMotion: s.prefs.reduceMotion, alwaysShowLabels: s.prefs.alwaysShowLabels });
      world.syncPeers(peers(teamState));
      world.setPlayer(playerInfo());
    };
    const initial = useApp.getState();
    world
      .init(host.current, initial.prefs.theme, sceneFor(initial, initial.prefs.theme))
      .then(() => {
        if (cancelled) return;
        worldApi.current = world;
        // A saved layout may have finished loading while the renderer was starting.
        const now = useApp.getState();
        const latest = sceneFor(now, now.prefs.theme);
        if (latest !== sceneFor(initial, initial.prefs.theme)) world.setScene(latest);
        push();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    const unsubs = [useApp.subscribe(push), useTeam.subscribe(push), usePlayer.subscribe(push)];
    // Renderer labels come from the same i18n source and refresh on language change.
    i18n.on('languageChanged', push);
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
      i18n.off('languageChanged', push);
      worldApi.current = null;
      world.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme switches re-frame the camera; layout edits (saved or draft) keep it in place.
  const savedScene = useApp((s) => sceneFor(s, theme));
  const editor = useEditor();
  const scene = editor.active && editor.draft ? editor.draft : savedScene;
  const lastTheme = useRef(theme);
  useEffect(() => {
    const world = worldApi.current;
    if (!world) return;
    if (lastTheme.current !== theme) {
      lastTheme.current = theme;
      world.setTheme(theme, scene);
      world.fitZoom();
    } else world.setScene(scene);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, scene]);

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
  }, [editor.active, editor.selectedId, editor.placing, scene]);

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
