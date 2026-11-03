import { describe, expect, it } from 'vitest';
import { canTransition, dependenciesMet, transitionTask, type Task } from './types';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Fix login',
  description: '',
  priority: 'normal',
  status: 'ready',
  dependsOn: [],
  createdAt: 0,
  ...over,
});

describe('task lifecycle', () => {
  it('stamps start and completion', () => {
    const started = transitionTask(task(), 'in_progress', 10);
    expect(started.startedAt).toBe(10);
    const done = transitionTask(started, 'completed', 20);
    expect(done.completedAt).toBe(20);
  });
  it('rejects invalid transitions', () => {
    expect(canTransition('completed', 'in_progress')).toBe(false);
    expect(() => transitionTask(task({ status: 'backlog' }), 'completed', 1)).toThrow();
  });
  it('checks dependencies', () => {
    const dep = task({ id: 'd', status: 'completed' });
    const pending = task({ id: 'p', status: 'in_progress' });
    const map = new Map([dep, pending].map((t) => [t.id, t]));
    expect(dependenciesMet(task({ dependsOn: ['d'] }), map)).toBe(true);
    expect(dependenciesMet(task({ dependsOn: ['d', 'p'] }), map)).toBe(false);
  });
});
