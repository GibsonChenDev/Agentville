import { describe, expect, it } from 'vitest';
import { cleanLayoutDoc, cleanName, generateInviteCode, isInviteCode, normalizeInviteCode, parseClientMessage } from './index';

describe('invite codes', () => {
  it('generates well-formed codes', () => {
    let seed = 1;
    const random = (n: number) => Uint8Array.from({ length: n }, () => (seed = (seed * 75 + 74) % 65537) & 255);
    for (let i = 0; i < 50; i++) expect(isInviteCode(generateInviteCode(random))).toBe(true);
  });

  it('normalizes sloppy input and look-alike letters', () => {
    expect(normalizeInviteCode('agv-7k3p-q9m2')).toBe('AGV-7K3P-Q9M2');
    expect(normalizeInviteCode(' 7K3P Q9M2 ')).toBe('AGV-7K3P-Q9M2');
    expect(normalizeInviteCode('AGV7K3PQ9M')).toBeNull(); // wrong length
    expect(normalizeInviteCode('AGV7K3PQ9MO')).toBe('AGV-7K3P-Q9M0');
    expect(normalizeInviteCode('AGV-OOOO-IIII')).toBe('AGV-0000-1111');
    expect(normalizeInviteCode('AGV-UUUU-0000')).toBeNull(); // U is not in the alphabet
  });
});

describe('client messages', () => {
  it('accepts only the documented shapes', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'agents', n: 3 }))).toEqual({ t: 'agents', n: 3 });
    expect(parseClientMessage(JSON.stringify({ t: 'agents', n: -1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'agents', n: 999 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'prompt', text: 'secret' }))).toBeNull();
    expect(parseClientMessage('not json')).toBeNull();
  });

  it('strips unknown fields so nothing extra is relayed', () => {
    const m = parseClientMessage(JSON.stringify({ t: 'presence', p: { x: 10, y: 20, facing: 'up', pose: 'sit', seat: 'ws-b1', cwd: '/secret' }, extra: 1 }));
    expect(m).toEqual({ t: 'presence', p: { x: 10, y: 20, facing: 'up', pose: 'sit', seat: 'ws-b1' } });
  });

  it('validates profile names and appearance', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'profile', name: '  Alice\u0000 ', appearance: { hairStyle: 'bob' } }))).toEqual({ t: 'profile', name: 'Alice', appearance: { hairStyle: 'bob' } });
    expect(parseClientMessage(JSON.stringify({ t: 'profile', name: 'A', appearance: { hairStyle: '<script>' } }))).toBeNull();
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('x'.repeat(60))).toHaveLength(24);
  });

  it('checks layout document shape', () => {
    const doc = { version: 1, furniture: [{ id: 'desk-b1', kind: 'desk', x: 2, y: 4 }], workstations: [{ id: 'ws-b1', deskId: 'desk-b1', facing: 'up', seat: { x: 2, y: 5 } }] };
    expect(cleanLayoutDoc(doc)).toEqual({ version: 1, furniture: [{ id: 'desk-b1', kind: 'desk', x: 2, y: 4 }], workstations: [{ id: 'ws-b1', deskId: 'desk-b1', facing: 'up' }] });
    expect(cleanLayoutDoc({ ...doc, version: 2 })).toBeNull();
    expect(cleanLayoutDoc({ ...doc, furniture: [{ id: 'x', kind: 'desk', x: 1.5, y: 0 }] })).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'layout', theme: 'loft', doc: null }))).toEqual({ t: 'layout', theme: 'loft', doc: null });
  });
});
