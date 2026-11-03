import { describe, expect, it } from 'vitest';
import { IntentScheduler, intentFor } from './intent';

describe('intentFor', () => {
  it('maps tool categories to distinct activities', () => {
    expect(intentFor('reading', 'read').activity).toBe('read');
    expect(intentFor('writing', 'write').activity).toBe('type');
    expect(intentFor('executing_tool', 'test')).toMatchObject({ activity: 'debug', screen: 'terminal' });
    expect(intentFor('waiting_for_permission').activity).toBe('raise');
    expect(intentFor('disconnected').place).toBe('away');
    expect(intentFor('collaborating').place).toBe('meeting');
  });
});

describe('IntentScheduler', () => {
  const idle = intentFor('idle');
  const read = intentFor('reading', 'read');
  const write = intentFor('writing', 'write');

  it('holds an intent for the minimum dwell and coalesces to the latest', () => {
    const s = new IntentScheduler(idle, 0, 1000);
    s.propose(read, 1500);
    expect(s.current).toEqual(read);
    s.propose(write, 1600);
    s.propose(intentFor('thinking'), 1700);
    expect(s.tick(1800)).toEqual(read);
    expect(s.tick(2600)).toEqual(intentFor('thinking'));
  });

  it('applies permission requests immediately', () => {
    const s = new IntentScheduler(read, 0, 1000);
    s.propose(intentFor('waiting_for_permission'), 10);
    expect(s.current.activity).toBe('raise');
  });

  it('settles a celebration back to idle', () => {
    const s = new IntentScheduler(idle, 0, 500);
    s.propose(intentFor('completed'), 1000);
    expect(s.tick(1100).activity).toBe('cheer');
    expect(s.tick(4000).activity).toBe('idle');
    expect(s.current.screen).toBe('success');
  });

  it('drops a pending intent when the current one is proposed again', () => {
    const s = new IntentScheduler(read, 0, 1000);
    s.propose(write, 100);
    s.propose(read, 200);
    expect(s.tick(2000)).toEqual(read);
  });
});
