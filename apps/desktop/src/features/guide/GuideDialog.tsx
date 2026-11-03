import { useEffect, useMemo, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { drawIcon, type IconKind } from '../../game/assets/icons';
import { desktop, isTauri } from '../../integration/platform';
import { useApp } from '../../state/store';
import { CommandLine } from '../setup/SetupChecklist';
import { useSetup } from '../setup/setupStore';
import { useGuide, type GuideSection } from './guideStore';

const SECTIONS: GuideSection[] = ['start', 'office', 'teams', 'help'];
const LEGEND: IconKind[] = ['think', 'read', 'type', 'exec', 'test', 'plan', 'delegate', 'raise', 'cheer', 'slump', 'talk'];

const COMMANDS = {
  installMac: 'curl -fsSL https://claude.ai/install.sh | bash',
  installWin: 'irm https://claude.ai/install.ps1 | iex',
  wingetWin: 'winget install Anthropic.ClaudeCode',
  start: 'claude',
  cd: 'cd ~/code/my-project',
  cdWin: 'cd $HOME\\code\\my-project',
  worktree: 'git worktree add ../my-project-feature -b feature',
  claudeWorktree: 'claude --worktree feature',
  teams: '{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }',
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber/15 font-pixel text-[13px] text-amber ring-1 ring-amber/40">{n}</span>
      <div className="min-w-0 flex-1 pb-1">
        <h4 className="text-[13px] font-semibold">{title}</h4>
        <div className="mt-1 space-y-1.5 text-[12.5px] leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  );
}

function Qa({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg bg-panel-2/60 px-3 py-2 ring-1 ring-line">
      <summary className="cursor-pointer text-[12.5px] font-medium marker:text-faint">{q}</summary>
      <div className="mt-1.5 space-y-1.5 text-[12px] leading-relaxed text-muted">{children}</div>
    </details>
  );
}

/** The in-app user guide: install, sign in, read the office, teams, FAQ. */
export function GuideDialog() {
  const { t } = useTranslation('guide');
  const section = useGuide((s) => s.section);
  const platform = useSetup((s) => s.platform);
  const dialog = useRef<HTMLDialogElement>(null);
  const icons = useMemo(() => Object.fromEntries(LEGEND.map((k) => [k, drawIcon(k).canvas.toDataURL()])), []);
  const win = platform === 'windows';

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (section && !d.open) d.showModal();
    if (!section && d.open) d.close();
  }, [section]);

  const openSetup = () => {
    useGuide.getState().close();
    useApp.getState().toggleSettings(true, 'monitoring');
  };

  return (
    <dialog
      ref={dialog}
      onClose={() => useGuide.getState().close()}
      onClick={(e) => e.target === dialog.current && useGuide.getState().close()}
      className="m-auto w-[760px] max-w-[95vw] rounded-xl bg-panel p-0 text-fg shadow-2xl ring-1 ring-line-strong backdrop:bg-black/55"
      aria-labelledby="guide-title"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id="guide-title" className="text-[15px] font-semibold">
          {t('title')}
        </h2>
        <button onClick={() => useGuide.getState().close()} className="rounded px-2 py-0.5 text-[12px] text-muted hover:bg-panel-2 hover:text-fg">
          {t('common:actions.close')}
        </button>
      </div>
      <div className="grid max-h-[74vh] grid-cols-[170px_1fr]">
        <nav className="space-y-0.5 border-r border-line p-2" aria-label={t('title')}>
          {SECTIONS.map((id) => (
            <button
              key={id}
              onClick={() => useGuide.getState().open(id)}
              aria-current={section === id}
              className={`block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] ${section === id ? 'bg-panel-3 font-medium text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg'}`}
            >
              {t(`nav.${id}`)}
            </button>
          ))}
        </nav>

        <div className="scroll-thin overflow-y-auto px-5 py-4">
          {section === 'start' && (
            <>
              <p className="mb-4 text-[12.5px] leading-relaxed text-muted">{t('start.intro')}</p>
              <ol className="space-y-4">
                <Step n={1} title={t('start.install.title')}>
                  <p>{t('start.install.body')}</p>
                  <p className="text-[11.5px] text-faint">{t('start.install.mac')}</p>
                  <CommandLine command={COMMANDS.installMac} />
                  <p className="pt-1 text-[11.5px] text-faint">{t('start.install.win')}</p>
                  <CommandLine command={COMMANDS.installWin} />
                  <p className="text-[11.5px] text-faint">{t('start.install.winget')}</p>
                  <CommandLine command={COMMANDS.wingetWin} />
                  {win && <p className="text-[11.5px] text-amber">{t('start.install.gitWindows')}</p>}
                  <p>
                    <button className="text-amber underline decoration-dotted" onClick={openSetup}>
                      {t('start.install.orButton')}
                    </button>
                  </p>
                </Step>
                <Step n={2} title={t('start.login.title')}>
                  <p>{t('start.login.body')}</p>
                  <CommandLine command={COMMANDS.start} />
                  <p className="text-[11.5px] text-faint">{t('start.login.plans')}</p>
                  {isTauri && (
                    <button onClick={() => void useSetup.getState().openTerminal()} className="rounded-md px-2.5 py-1 text-[11.5px] ring-1 ring-line-strong hover:bg-panel-3">
                      {t('start.login.button')}
                    </button>
                  )}
                </Step>
                <Step n={3} title={t('start.connect.title')}>
                  <p>{t('start.connect.body')}</p>
                  <button onClick={openSetup} className="rounded-md bg-amber px-2.5 py-1 text-[11.5px] font-semibold text-ink">
                    {t('start.connect.button')}
                  </button>
                </Step>
                <Step n={4} title={t('start.work.title')}>
                  <p>{t('start.work.body')}</p>
                  <CommandLine command={win ? COMMANDS.cdWin : COMMANDS.cd} />
                  <CommandLine command={COMMANDS.start} />
                  <p className="text-[11.5px] text-faint">{t('start.work.many')}</p>
                </Step>
              </ol>
            </>
          )}

          {section === 'office' && (
            <div className="space-y-4 text-[12.5px] leading-relaxed text-muted">
              <p>{t('office.intro')}</p>
              <div>
                <h4 className="mb-2 text-[13px] font-semibold text-fg">{t('office.legendTitle')}</h4>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {LEGEND.map((k) => (
                    <li key={k} className="flex items-center gap-2">
                      <img src={icons[k]} width={26} height={28} alt="" className="pixelated shrink-0" />
                      <span className="text-[12px]">{t(`office.legend.${k}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p>{t('office.screens')}</p>
              <p>{t('office.readOnly')}</p>
              <p>{t('office.inspector')}</p>
              <p>{t('office.controls')}</p>
              <p>{t('office.customize')}</p>
              <p>{t('office.demo')}</p>
            </div>
          )}

          {section === 'teams' && (
            <div className="space-y-4 text-[12.5px] leading-relaxed text-muted">
              <div>
                <h4 className="text-[13px] font-semibold text-fg">{t('teams.subagentsTitle')}</h4>
                <p className="mt-1">{t('teams.subagents')}</p>
              </div>
              <div>
                <h4 className="text-[13px] font-semibold text-fg">{t('teams.teamsTitle')}</h4>
                <p className="mt-1">{t('teams.teams')}</p>
                <CommandLine command={COMMANDS.teams} />
                <p className="mt-1 text-[11.5px] text-faint">{t('teams.teamsNote')}</p>
              </div>
              <div>
                <h4 className="text-[13px] font-semibold text-fg">{t('teams.worktreesTitle')}</h4>
                <p className="mt-1">{t('teams.worktrees')}</p>
                <CommandLine command={COMMANDS.claudeWorktree} />
                <CommandLine command={COMMANDS.worktree} />
              </div>
              <div>
                <h4 className="text-[13px] font-semibold text-fg">{t('teams.conflictsTitle')}</h4>
                <p className="mt-1">{t('teams.conflicts')}</p>
              </div>
            </div>
          )}

          {section === 'help' && (
            <div className="space-y-2">
              <Qa q={t('help.noCharacter.q')}>
                <ol className="list-decimal space-y-1 pl-4">
                  <li>{t('help.noCharacter.a1')}</li>
                  <li>{t('help.noCharacter.a2')}</li>
                  <li>{t('help.noCharacter.a3')}</li>
                  <li>{t('help.noCharacter.a4')}</li>
                </ol>
              </Qa>
              <Qa q={t('help.notFound.q')}>
                <p>{t('help.notFound.a')}</p>
              </Qa>
              <Qa q={t('help.closed.q')}>
                <p>{t('help.closed.a')}</p>
              </Qa>
              <Qa q={t('help.permission.q')}>
                <p>{t('help.permission.a')}</p>
              </Qa>
              <Qa q={t('help.cost.q')}>
                <p>{t('help.cost.a')}</p>
              </Qa>
              <Qa q={t('help.privacy.q')}>
                <p>{t('help.privacy.a')}</p>
              </Qa>
              <Qa q={t('help.uninstall.q')}>
                <ol className="list-decimal space-y-1 pl-4">
                  <li>{t('help.uninstall.a1')}</li>
                  <li>{t('help.uninstall.a2')}</li>
                  <li>
                    <Trans t={t} i18nKey={win ? 'help.uninstall.a3win' : 'help.uninstall.a3mac'} components={{ code: <code className="selectable font-mono text-[11px] text-fg" /> }} />
                  </li>
                </ol>
              </Qa>
              {isTauri && (
                <p className="pt-2 text-[11.5px] text-faint">
                  {t('help.more')}{' '}
                  <button className="underline decoration-dotted" onClick={() => void desktop.openLink('claude_quickstart')}>
                    code.claude.com
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
