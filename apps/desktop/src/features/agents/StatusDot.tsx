import type { AgentStatus } from '@agentville/domain';
import { STATUS_TONE, TONE_CLASS } from '../../presentation/status';

export function StatusDot({ status, className = '' }: { status: AgentStatus; className?: string }) {
  const tone = STATUS_TONE[status];
  return (
    <span className={`relative inline-flex h-2 w-2 shrink-0 ${className}`} aria-hidden>
      {tone === 'attention' && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${TONE_CLASS[tone]}`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${TONE_CLASS[tone]}`} />
    </span>
  );
}
