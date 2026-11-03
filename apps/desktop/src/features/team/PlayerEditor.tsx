import { appearanceFromSeed, type CharacterAppearance } from '@agentville/domain';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnimName } from '../../game/assets/characterSprites';
import { usePlayer } from '../../team/playerStore';
import { FIELD_GROUPS, OptionRow, Preview, changeField } from '../agents/CharacterEditor';

const ANIMS: { id: string; anim: AnimName }[] = [
  { id: 'idle', anim: 'idle_front' },
  { id: 'walk', anim: 'walk_front' },
  { id: 'type', anim: 'sit_front_type' },
  { id: 'cheer', anim: 'stand_cheer' },
];

/** Your own character: nickname and look, shown to teammates in a team office. */
export function PlayerEditor() {
  const { t } = useTranslation('team');
  const open = usePlayer((s) => s.editorOpen);
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [appearance, setAppearance] = useState<CharacterAppearance>(appearanceFromSeed('x'));
  const [anim, setAnim] = useState<AnimName>('idle_front');

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      const p = usePlayer.getState();
      setName(p.name);
      setAppearance(p.appearance);
      setAnim('idle_front');
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => usePlayer.getState().openEditor(false);
  const set = <K extends keyof CharacterAppearance>(field: K) => (v: CharacterAppearance[K]) => setAppearance((a) => changeField(a, field, v));

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onClick={(e) => e.target === dialog.current && close()}
      className="m-auto w-[760px] max-w-[95vw] rounded-xl bg-panel p-0 text-fg shadow-2xl ring-1 ring-line-strong backdrop:bg-black/55"
      aria-labelledby="player-editor-title"
    >
      {open && (
        <>
          <div className="border-b border-line px-5 py-3">
            <h2 id="player-editor-title" className="text-[15px] font-semibold">
              {t('editor.title')}
            </h2>
            <p className="text-[11.5px] text-muted">{t('editor.body')}</p>
          </div>
          <div className="grid max-h-[70vh] grid-cols-[210px_1fr] overflow-hidden">
            <div className="flex flex-col items-center gap-3 border-r border-line bg-[repeating-linear-gradient(0deg,#2a2433_0_12px,#2e2738_12px_24px)] p-4">
              <div className="grid h-[230px] w-full place-items-center rounded-lg bg-ink/30 ring-1 ring-line">
                <Preview appearance={appearance} anim={anim} />
              </div>
              <div className="flex flex-wrap justify-center gap-1">
                {ANIMS.map((a) => (
                  <button key={a.id} onClick={() => setAnim(a.anim)} className={`rounded px-1.5 py-0.5 text-[10.5px] ${anim === a.anim ? 'bg-panel-3 text-fg ring-1 ring-line-strong' : 'text-muted hover:text-fg'}`}>
                    {t(`agents:editor.anim.${a.id}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="scroll-thin space-y-4 overflow-y-auto p-5">
              <label className="block">
                <span className="text-[12px] text-muted">{t('dialog.nickname')}</span>
                <input
                  value={name}
                  maxLength={24}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('dialog.nicknamePlaceholder')}
                  className="selectable mt-1 w-full rounded-md bg-ink/60 px-2.5 py-1.5 text-[13px] ring-1 ring-line outline-none focus:ring-amber/60"
                />
              </label>
              {FIELD_GROUPS.map((group, i) => (
                <section key={i} className="space-y-2.5">
                  <h3 className="text-[11px] font-semibold tracking-wide text-faint uppercase">{t(i === 0 ? 'agents:editor.groupLook' : 'agents:editor.groupOutfit')}</h3>
                  {group.map((field) => (
                    <OptionRow key={field} field={field} value={appearance[field]} onChange={set(field)} gender={appearance.gender} />
                  ))}
                </section>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-line px-5 py-3">
            <button onClick={() => setAppearance(appearanceFromSeed(`${Math.random()}`))} className="rounded-md px-3 py-1.5 text-[12px] ring-1 ring-line-strong hover:bg-panel-3">
              🎲 {t('agents:editor.randomize')}
            </button>
            <div className="ml-auto flex gap-2">
              <button onClick={close} className="rounded-md px-3 py-1.5 text-[12px] ring-1 ring-line-strong hover:bg-panel-3">
                {t('common:actions.cancel')}
              </button>
              <button
                onClick={() => {
                  usePlayer.getState().save(name, appearance);
                  close();
                }}
                className="rounded-md bg-amber px-4 py-1.5 text-[12.5px] font-semibold text-ink"
              >
                {t('common:actions.save')}
              </button>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
