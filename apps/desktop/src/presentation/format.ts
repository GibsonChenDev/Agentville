import type { DomainEvent } from '@agentville/domain';
import type { TFunction } from 'i18next';

export function formatTime(at: number, locale: string) {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(at);
}

export function formatRelative(at: number, now: number, locale: string, justNow: string) {
  const diff = Math.round((at - now) / 1000);
  if (Math.abs(diff) < 5) return justNow;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (Math.abs(diff) < 60) return rtf.format(diff, 'second');
  if (Math.abs(diff) < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  return rtf.format(Math.round(diff / 3600), 'hour');
}

/** Display-safe detail for an event. Returned as plain text; never rendered as HTML. */
export function eventDetail(e: DomainEvent, t: TFunction): string {
  const p = e.payload;
  switch (p.kind) {
    case 'tool.started':
      return p.target ? `${p.toolName} · ${p.target}` : p.toolName;
    case 'tool.finished':
      return p.toolName;
    case 'tool.failed':
      return p.error ? `${p.toolName} · ${p.error}` : p.toolName;
    case 'permission.requested':
      return p.target ? `${p.toolName} · ${p.target}` : p.toolName;
    case 'permission.resolved':
      return p.decision;
    case 'prompt.submitted':
      return p.preview ?? '';
    case 'assistant.message':
      return p.text;
    case 'run.failed':
      return p.error;
    case 'run.completed':
      return p.summary ?? '';
    case 'subagent.started':
      return p.agentType ?? p.subagentId;
    case 'subagent.stopped':
      return p.subagentId;
    case 'session.started':
      return p.cwd ?? '';
    case 'session.disconnected':
      return p.reason;
    case 'notification':
      return p.message ?? p.notificationType ?? '';
    case 'collaboration.started':
      return t(`agents:category.delegate`);
    case 'task.created':
      return p.teammateName ? `${p.subject} · ${p.teammateName}` : p.subject;
    case 'task.completed':
      return p.teammateName ? `${p.subject} · ${p.teammateName}` : p.subject;
    case 'teammate.idle':
      return p.teammateName;
    case 'location.changed':
      return p.cwd;
    default:
      return '';
  }
}

export type EventGroup = 'lifecycle' | 'tools' | 'permissions' | 'subagents' | 'messages';

export function eventGroup(e: DomainEvent): EventGroup {
  const k = e.payload.kind;
  if (k.startsWith('tool.')) return 'tools';
  if (k.startsWith('permission.')) return 'permissions';
  if (k.startsWith('subagent.') || k.startsWith('task.') || k === 'teammate.idle') return 'subagents';
  if (k === 'prompt.submitted' || k === 'assistant.message' || k === 'notification') return 'messages';
  return 'lifecycle';
}
