import type { TilePoint } from '@agentville/domain';
import { create } from 'zustand';
import { worldApi } from '../features/office/worldApi';
import { lobbyDoorTile } from '../game/scenes/layouts';
import { team, teamEvents } from '../team/teamClient';
import { useTeam } from '../team/teamStore';

/**
 * Where you are: the lobby hallway, your personal office, or one of your team
 * offices. Moving between them walks your character through a door, fades
 * out, and brings you in through the door on the other side.
 */
export type Place = { kind: 'lobby' } | { kind: 'personal' } | { kind: 'team'; roomId: string };

interface PlaceState {
  place: Place;
  /** Black screen between scenes. */
  fading: boolean;
  busy: boolean;
  go: (to: Place, opts?: { viaDoor?: string }) => Promise<void>;
}

const KEY = 'agentville.place.v1';
const FADE_MS = 260;

export const samePlace = (a: Place, b: Place) => a.kind === b.kind && (a.kind !== 'team' || (b.kind === 'team' && a.roomId === b.roomId));

/** Lobby doors in order: your office, each team office, then "new office". */
export function lobbyDoorIds(): string[] {
  return ['personal', ...useTeam.getState().rooms.map((r) => `team:${r.roomId}`), 'new'];
}

export const doorIdFor = (p: Place) => (p.kind === 'team' ? `team:${p.roomId}` : p.kind);

function loadPlace(): Place {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Place | null;
    if (raw?.kind === 'team' && useTeam.getState().rooms.some((r) => r.roomId === raw.roomId)) return raw;
  } catch {
    // fall through
  }
  return { kind: 'personal' };
}

function savePlace(p: Place) {
  if (p.kind === 'lobby') return; // reopen where you work, not in the hallway
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // not remembered across launches
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const usePlace = create<PlaceState>((set, get) => ({
  place: loadPlace(),
  fading: false,
  busy: false,
  go: async (to, opts) => {
    const from = get().place;
    if (get().busy || samePlace(from, to)) return;
    set({ busy: true });
    try {
      const world = worldApi.current;
      if (world && opts?.viaDoor) await world.enterDoor(opts.viaDoor);
      set({ fading: true });
      await sleep(FADE_MS);
      if (from.kind === 'team') team.close();
      if (to.kind === 'team') team.open(to.roomId);
      // Come in through the door on the other side: an office's own door, or in
      // the lobby the door of the office you just left.
      let arrival: TilePoint | 'office' = 'office';
      if (to.kind === 'lobby') arrival = lobbyDoorTile(Math.max(0, lobbyDoorIds().indexOf(doorIdFor(from))));
      worldApi.arrival = arrival;
      set({ place: to });
      savePlace(to);
      await sleep(60);
    } finally {
      set({ fading: false, busy: false });
    }
  },
}));

/** On launch: reconnect to the office you were in, and walk in through its door. */
export function startPlace() {
  const { place } = usePlace.getState();
  if (place.kind === 'team') team.open(place.roomId);
  worldApi.arrival = 'office';
  // Removed from (or left) the office you're in: back to the lobby.
  teamEvents.onLeft = (roomId) => {
    const p = usePlace.getState().place;
    if (p.kind === 'team' && p.roomId === roomId) {
      worldApi.arrival = lobbyDoorTile(0);
      usePlace.setState({ place: { kind: 'lobby' } });
      savePlace({ kind: 'personal' });
    }
  };
}
