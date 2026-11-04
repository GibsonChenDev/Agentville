import type { AgentRecord } from '@agentville/domain';
import { hookProvider, providerOf } from '@agentville/integrations';

/**
 * Small tag naming the coding agent behind a character ("CC" Claude Code,
 * "CX" Codex). Pass a provider id, or an agent (demo characters get none).
 */
export function ProviderBadge({ provider, agent, className = '' }: { provider?: string; agent?: Pick<AgentRecord, 'origin' | 'provider'>; className?: string }) {
  const p = agent ? providerOf(agent) : provider ? hookProvider(provider) : undefined;
  if (!p) return null;
  return (
    <span
      title={p.label}
      aria-label={p.label}
      className={`inline-flex shrink-0 items-center rounded px-1 font-mono text-[9.5px] leading-[14px] font-bold text-white ${className}`}
      style={{ backgroundColor: p.color }}
    >
      {p.badge}
    </span>
  );
}
