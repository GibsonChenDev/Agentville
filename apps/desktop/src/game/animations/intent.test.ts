import { describe, expect, it } from 'vitest';
import { IntentScheduler, SLACK_AFTER_MS, intentFor, isSlacking } from './intent';

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

describe('slacking off', () => {
  const idle = intentFor('idle');

  it('starts after a while idle at the desk and rotates through slack activities', () => {
    const s = new IntentScheduler(idle, 0, 900, 0);
    expect(s.tick(SLACK_AFTER_MS - 1).activity).toBe('idle');
    expect(s.tick(SLACK_AFTER_MS).activity).toBe('phone');
    expect(s.tick(SLACK_AFTER_MS + 30_000).activity).toBe('stretch');
    expect(s.tick(SLACK_AFTER_MS + 35_000).activity).toBe('nap');
    expect(isSlacking(s.current.activity)).toBe(true);
  });

  it('is not woken by the same status being proposed again, but is by real work', () => {
    const s = new IntentScheduler(idle, 0, 900, 2);
    s.tick(SLACK_AFTER_MS);
    expect(s.current.activity).toBe('nap');
    s.propose(intentFor('idle'), SLACK_AFTER_MS + 100);
    expect(s.current.activity).toBe('nap');
    s.propose(intentFor('writing', 'write'), SLACK_AFTER_MS + 200);
    expect(s.current.activity).toBe('type');
  });

  it('never slacks while working, away or in a meeting', () => {
    for (const intent of [intentFor('writing', 'write'), intentFor('collaborating'), intentFor('disconnected')]) {
      const s = new IntentScheduler(intent, 0);
      expect(s.tick(10 * SLACK_AFTER_MS).activity).toBe(intent.activity);
    }
  });

  it('does not restart a celebration when a completed agent is re-proposed', () => {
    const s = new IntentScheduler(idle, 0, 500);
    s.propose(intentFor('completed'), 1000);
    expect(s.tick(4000).activity).toBe('idle');
    s.propose(intentFor('completed'), 5000);
    expect(s.tick(5100).activity).toBe('idle');
  });
});
