import { appearanceFromSeed, sanitizeAppearance } from '@agentville/domain';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../state/store';
import { useTeam } from '../../team/teamStore';
import { Portrait } from '../agents/Portrait';

/** Inspector content for a teammate or one of their agents: who, and how many agents — nothing more. */
export function PeerCard({ worldId, width }: { worldId: string; width: number }) {
  const { t } = useTranslation('team');
  const memberId = worldId.split(':')[1] ?? '';
  const member = useTeam((s) => s.members[memberId]);
  const isAgent = worldId.split(':').length > 2;
  if (!member) return null;
  return (
    <aside className="flex h-full shrink-0 flex-col border-l border-line bg-panel" style={{ width }} aria-label={member.name}>
      <header className="border-b border-line p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-panel-2 p-1 ring-1 ring-line">
            <Portrait appearance={isAgent ? appearanceFromSeed(worldId) : sanitizeAppearance(member.appearance, appearanceFromSeed(member.id))} size={56} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold">{isAgent ? t('agentOf', { name: member.name }) : member.name}</h2>
            <p className="mt-0.5 text-[12px] text-muted">{isAgent ? t('working') : member.online ? t('agentsWorking', { count: member.agents }) : t('status.offline')}</p>
          </div>
          <button onClick={() => useApp.getState().select(undefined)} className="rounded px-2 py-0.5 text-[12px] text-muted hover:bg-panel-2 hover:text-fg">
            {t('common:actions.close')}
          </button>
        </div>
      </header>
      <div className="p-4 text-[12.5px] leading-relaxed text-muted">
        <p className="rounded-md bg-panel-2 p-3 ring-1 ring-line">{t(isAgent ? 'card.agentPrivate' : 'card.memberPrivate', { name: member.name })}</p>
      </div>
    </aside>
  );
}
