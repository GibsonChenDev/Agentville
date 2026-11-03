export type TaskStatus =
  | 'backlog'
  | 'ready'
  | 'in_progress'
  | 'blocked'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Task {
  id: string;
  title: string;
  description: string;
  projectPath?: string;
  assigneeId?: string;
  priority: TaskPriority;
  status: TaskStatus;
  dependsOn: string[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  /** Session that executed this task, when one is linked. */
  sessionId?: string;
  resultSummary?: string;
}

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ['ready', 'cancelled'],
  ready: ['in_progress', 'backlog', 'blocked', 'cancelled'],
  in_progress: ['waiting_for_approval', 'blocked', 'completed', 'failed', 'cancelled'],
  blocked: ['ready', 'in_progress', 'cancelled'],
  waiting_for_approval: ['in_progress', 'failed', 'cancelled'],
  completed: [],
  failed: ['ready'],
  cancelled: ['ready'],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTaskTransition extends Error {
  constructor(
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    super(`Invalid task transition ${from} -> ${to}`);
  }
}

export function transitionTask(task: Task, to: TaskStatus, at: number): Task {
  if (!canTransition(task.status, to)) throw new InvalidTaskTransition(task.status, to);
  const next: Task = { ...task, status: to };
  if (to === 'in_progress' && task.startedAt === undefined) next.startedAt = at;
  if (to === 'completed' || to === 'failed' || to === 'cancelled') next.completedAt = at;
  if (to === 'ready') next.completedAt = undefined;
  return next;
}

/** A task is startable when every dependency has completed. */
export function dependenciesMet(task: Task, all: ReadonlyMap<string, Task>): boolean {
  return task.dependsOn.every((id) => all.get(id)?.status === 'completed');
}
