import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MemberView } from '@agentville/team-protocol';
import { NAMESPACES, i18n, resources } from '../i18n';
import { useApp } from '../state/store';
import { chooseOfficeTheme, currentOfficeStyle, currentOfficeTheme, officeStyle, officeTheme } from '../world/officeTheme';
import { cachedOffice, forgetOffice, rememberOffice } from './officeCache';
import { peerAgents } from './peerAgents';
import { useTeam, type TeamState } from './teamStore';

/** Node has no usable localStorage in tests; a plain map stands in. */
beforeAll(async () => {
  await i18n.init({ resources, lng: 'zh-TW', ns: NAMESPACES, defaultNS: 'common', interpolation: { escapeValue: false } });
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), clear: () => data.clear() },
  });
});

const doc = { version: 1 as const, furniture: [{ id: 'desk-a', kind: 'desk', x: 3, y: 6 }], workstations: [{ id: 'ws-a', deskId: 'desk-a', facing: 'up' as const }] };

describe('entering an office shows its own look straight away (no flash)', () => {
  beforeEach(() => localStorage.clear());

  it("remembers each office's map and layouts, separately", () => {
    rememberOffice('room-a', { theme: 'garden', layouts: { garden: doc } });
    rememberOffice('room-b', { theme: 'seaside', layouts: {} });
    expect(cachedOffice('room-a')).toEqual({ theme: 'garden', layouts: { garden: doc } });
    expect(cachedOffice('room-b')?.theme).toBe('seaside');
    forgetOffice('room-a');
    expect(cachedOffice('room-a')).toBeUndefined();
    expect(cachedOffice('room-b')?.theme).toBe('seaside');
  });

  it('ignores a damaged saved entry instead of drawing it', () => {
    localStorage.setItem('agentville.offices.v1', JSON.stringify({ ok: { theme: 'loft', layouts: { loft: { version: 9 } } }, bad: { theme: '<script>' } }));
    expect(cachedOffice('ok')).toEqual({ theme: 'loft', layouts: {} });
    expect(cachedOffice('bad')).toBeUndefined();
  });

  it('while the relay is still answering, the map is the one last seen there, not your own office’s', () => {
    const entering = { membership: { roomId: 'room-a' } as TeamState['membership'], room: undefined, preview: { theme: 'garden', layouts: {} } };
    expect(officeTheme('loft', entering)).toBe('garden');
    // Once the relay answers, its map wins (someone may have changed it while you were away).
    expect(officeTheme('loft', { ...entering, room: { theme: 'seaside' } as TeamState['room'] })).toBe('seaside');
  });
});

describe('switching offices does not change anyone else’s map', () => {
  beforeEach(() => {
    useTeam.setState({ membership: undefined, room: undefined, preview: undefined, status: 'idle' });
    useApp.getState().setTheme('loft');
  });

  it('picking a map in your own office changes only your own office', () => {
    chooseOfficeTheme('studio');
    expect(useApp.getState().prefs.theme).toBe('studio');
    expect(useTeam.getState().room).toBeUndefined();
  });

  const inOffice = (roomId: string) =>
    useTeam.setState({ membership: { roomId, memberId: 'me', token: 't', owner: false, name: 'Team', server: 'x' }, room: { id: roomId, name: 'Team', code: 'AGV-AAAA-BBBB', theme: 'loft', layouts: {} }, status: 'online' });

  it('picking a map in a team office changes only how it looks to you; its shared layout stays', () => {
    inOffice('room-a');
    chooseOfficeTheme('midnight');
    expect(currentOfficeStyle()).toBe('midnight'); // what you see
    expect(currentOfficeTheme()).toBe('loft'); // the layout everyone shares
    expect(useTeam.getState().room?.theme).toBe('loft'); // nothing sent, nothing changed for others
    expect(useApp.getState().prefs.theme).toBe('loft'); // your own office untouched
  });

  it('remembers your look for each team office separately, across restarts', () => {
    inOffice('room-a');
    chooseOfficeTheme('seaside');
    inOffice('room-b');
    expect(currentOfficeStyle()).toBe('loft'); // not chosen here yet: the office's own look
    chooseOfficeTheme('garden');
    inOffice('room-a');
    expect(currentOfficeStyle()).toBe('seaside');
    expect(JSON.parse(localStorage.getItem('agentville.officeStyles.v1')!)).toMatchObject({ 'room-a': 'seaside', 'room-b': 'garden' });
  });

  it('two teammates see the same layout in different looks', () => {
    const room = { membership: { roomId: 'r' } as TeamState['membership'], room: { theme: 'garden' } as TeamState['room'], preview: undefined };
    const mine = officeStyle('loft', room, { r: 'midnight' });
    const theirs = officeStyle('studio', room, { r: 'seaside' });
    expect([mine, theirs]).toEqual(['midnight', 'seaside']);
    expect(officeTheme('loft', room)).toBe(officeTheme('studio', room));
  });
});

describe("teammates' agents on your screen", () => {
  const member = (id: string, agents: number): MemberView => ({ id, name: id === 'a' ? 'Alice' : id, appearance: {}, owner: false, online: true, agents, presence: { x: 1, y: 1, facing: 'down', pose: 'stand' } });

  it('appear as characters, one per agent, but carry nothing about their work', () => {
    const team = { status: 'online', membership: { memberId: 'me' }, members: { a: member('a', 2) } } as unknown as TeamState;
    const shown = peerAgents(team);
    expect(shown).toHaveLength(2);
    for (const a of shown) {
      expect(a.record.id).toMatch(/^peer:a:\d$/);
      expect(a.record.projectPath).toBeUndefined();
      expect(a.record.location).toBeUndefined();
      expect(a.record.team).toBeUndefined();
      expect(a.category).toBeUndefined();
      // The label is generic: whose agent it is and "working", never what it works on.
      expect(a.badge.status).toBe(shown[0]!.badge.status);
      expect(a.badge.name).toBe('Alice 的 agent');
      expect(a.badge.status).toBe('工作中');
    }
    // Clicking one selects an id the app has no record for, so the side panel shows nothing about it.
    expect(useApp.getState().agents[shown[0]!.record.id]).toBeUndefined();
  });
});
