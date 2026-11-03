import {
  AGENT_ROLES,
  APPEARANCE_OPTIONS,
  appearanceFromSeed,
  profileKeyFor,
  styleGender,
  withGender,
  type Gender,
  type AgentRole,
  type CharacterAppearance,
} from '@agentville/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ANIMS, buildCharacterSheet, type AnimName } from '../../game/assets/characterSprites';
import { HAIR, OUTFIT, SKIN } from '../../game/assets/palette';
import { THEMES } from '../../game/assets/themes';
import { drawDesk, drawEquipment } from '../../game/furniture/furniture';
import { sceneFor, useApp } from '../../state/store';
import { lockedOption, useAccount } from '../../account/accountStore';
import { useOfficeStyle, useOfficeTheme } from '../../world/officeTheme';

const PREVIEW_ANIMS: { id: string; anim: AnimName }[] = [
  { id: 'idle', anim: 'idle_front' },
  { id: 'walk', anim: 'walk_front' },
  { id: 'type', anim: 'sit_front_type' },
  { id: 'read', anim: 'sit_front_read' },
  { id: 'raise', anim: 'sit_front_raise' },
  { id: 'cheer', anim: 'stand_cheer' },
  { id: 'back', anim: 'walk_back' },
  { id: 'side', anim: 'walk_side' },
];

const SWATCHES: Partial<Record<keyof CharacterAppearance, Record<string, string>>> = {
  hairColor: HAIR,
  skin: SKIN,
  topColor: OUTFIT,
  bottomColor: OUTFIT,
  shoesColor: OUTFIT,
};

/** Applies one editor choice; choosing a gender also swaps the other gender's hair and clothes to defaults. */
export function changeField<K extends keyof CharacterAppearance>(a: CharacterAppearance, field: K, v: CharacterAppearance[K]): CharacterAppearance {
  return field === 'gender' ? withGender(a, v as Gender) : { ...a, [field]: v };
}

/** Colour swatches share one label set per kind (all outfit colours use `color`). */
const swatchNs = (field: keyof CharacterAppearance) => (field === 'skin' ? 'skin' : field === 'hairColor' ? 'hairColor' : 'color');

/** Animated pixel preview of an appearance, drawn at an integer scale. */
export function Preview({ appearance, anim, scale = 6 }: { appearance: CharacterAppearance; anim: AnimName; scale?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sheet = useMemo(() => buildCharacterSheet(appearance), [appearance]);
  useEffect(() => {
    const frames = sheet.frames[anim];
    const def = ANIMS[anim];
    let i = 0;
    const draw = () => {
      const c = canvas.current;
      const ctx = c?.getContext('2d');
      const frame = frames[i++ % frames.length];
      if (!c || !ctx || !frame) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(c.width / 2, c.height - scale * 1.5, scale * 8, scale * 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(frame, 0, 0, frame.width * scale, frame.height * scale);
    };
    draw();
    const id = setInterval(draw, def.frameMs);
    return () => clearInterval(id);
  }, [sheet, anim, scale]);
  return <canvas ref={canvas} width={24 * scale} height={36 * scale} className="pixelated" aria-hidden />;
}

function EquipmentPreview({ appearance }: { appearance: CharacterAppearance }) {
  const theme = useOfficeStyle();
  const url = useMemo(() => {
    const t = THEMES[theme];
    const c = document.createElement('canvas');
    c.width = 34;
    c.height = 40;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(drawDesk(t).canvas, 0, 16);
    ctx.drawImage(drawEquipment(t, appearance.equipment, 'screen', 7).canvas.canvas, 0, 2);
    return c.toDataURL();
  }, [theme, appearance.equipment]);
  return <img src={url} width={34 * 3} height={40 * 3} alt="" className="pixelated" />;
}

/** Fields whose options come in men's, women's and unisex groups. */
const GENDERED = new Set<keyof CharacterAppearance>(['hairStyle', 'top', 'bottom']);

/**
 * One appearance field. Hair styles, tops and bottoms are shown in men's,
 * women's and unisex groups, the character's own gender first — every option
 * stays selectable.
 */
export function OptionRow<K extends keyof CharacterAppearance>({ field, value, onChange, gender }: { field: K; value: CharacterAppearance[K]; onChange: (v: CharacterAppearance[K]) => void; gender?: Gender }) {
  const { t } = useTranslation('agents');
  const inventory = useAccount((s) => s.account?.inventory);
  // Shop items show a lock until bought; choosing one opens the shop instead.
  const pick = (opt: CharacterAppearance[K]) => (lockedOption(inventory, field, opt as string) ? useAccount.getState().openShop(true) : onChange(opt));
  const lock = (opt: CharacterAppearance[K]) => lockedOption(inventory, field, opt as string);
  const options = APPEARANCE_OPTIONS[field] as readonly CharacterAppearance[K][];
  const swatch = SWATCHES[field];
  if (GENDERED.has(field) && gender) {
    const order: (Gender | 'any')[] = gender === 'female' ? ['female', 'any', 'male'] : ['male', 'any', 'female'];
    const groups = order.map((g) => ({ g, opts: options.filter((o) => styleGender(field as 'top', o as string) === g) })).filter((x) => x.opts.length);
    return (
      <div className="grid grid-cols-[84px_1fr] items-start gap-2">
        <span className="pt-1 text-[12px] text-muted">{t(`appearance.field.${field}`)}</span>
        <div className="space-y-1" role="radiogroup" aria-label={t(`appearance.field.${field}`)}>
          {groups.map(({ g, opts }) => (
            <div key={g} className="flex flex-wrap items-center gap-1">
              <span className="w-9 shrink-0 text-[10.5px] text-faint">{t(`appearance.group.${g}`)}</span>
              {opts.map((opt) => (
                <button
                  key={opt}
                  role="radio"
                  aria-checked={value === opt}
                  onClick={() => pick(opt)}
                  className={`rounded-md px-2 py-1 text-[11.5px] ${value === opt ? 'bg-amber/15 text-amber ring-1 ring-amber/50' : 'text-muted ring-1 ring-line hover:bg-panel-3 hover:text-fg'}`}
                >
                  {t(`appearance.${field}.${opt}`)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[84px_1fr] items-start gap-2">
      <span className="pt-1 text-[12px] text-muted">{t(`appearance.field.${field}`)}</span>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t(`appearance.field.${field}`)}>
        {options.map((opt) =>
          swatch ? (
            <button
              key={opt}
              role="radio"
              aria-checked={value === opt}
              aria-label={t(`appearance.${swatchNs(field)}.${opt}`)}
              title={lock(opt) ? `🔒 ${t(`appearance.${swatchNs(field)}.${opt}`)} · ${t('shop:lockedHint')}` : t(`appearance.${swatchNs(field)}.${opt}`)}
              onClick={() => pick(opt)}
              className={`grid h-6 w-6 place-items-center rounded-full text-[9px] ring-offset-2 ring-offset-panel ${value === opt ? 'ring-2 ring-amber' : 'ring-1 ring-line-strong hover:ring-fg/40'} ${lock(opt) ? 'opacity-50' : ''}`}
              style={{ background: swatch[opt as string] }}
            >
              {lock(opt) ? '🔒' : null}
            </button>
          ) : (
            <button
              key={opt}
              role="radio"
              aria-checked={value === opt}
              onClick={() => pick(opt)}
              title={lock(opt) ? t('shop:lockedHint') : undefined}
              className={`rounded-md px-2 py-1 text-[11.5px] ${value === opt ? 'bg-amber/15 text-amber ring-1 ring-amber/50' : 'text-muted ring-1 ring-line hover:bg-panel-3 hover:text-fg'} ${lock(opt) ? 'opacity-60' : ''}`}
            >
              {lock(opt) ? '🔒 ' : ''}
              {t(`appearance.${field}.${opt}`)}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export const FIELD_GROUPS: (keyof CharacterAppearance)[][] = [
  ['gender', 'hairStyle', 'hairColor', 'skin', 'face'],
  ['top', 'topColor', 'bottom', 'bottomColor', 'shoes', 'shoesColor', 'accessory'],
];

export function CharacterEditor() {
  const { t } = useTranslation('agents');
  const agentId = useApp((s) => s.customizing);
  const agent = useApp((s) => (agentId ? s.agents[agentId] : undefined));
  const base = useApp((s) => (agentId ? s.baseAgents[agentId] : undefined));
  const theme = useOfficeTheme();
  const scene = useApp((s) => sceneFor(s, theme));
  const dialog = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState('');
  const [role, setRole] = useState<AgentRole>('generalist');
  const [appearance, setAppearance] = useState<CharacterAppearance>(appearanceFromSeed('x'));
  const [workstationId, setWorkstationId] = useState('');
  const [anim, setAnim] = useState<AnimName>('idle_front');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (agent && !d.open) {
      setName(agent.name);
      setRole(agent.role);
      setAppearance(agent.appearance);
      setWorkstationId(agent.workstationId ?? '');
      setAnim('idle_front');
      d.showModal();
    }
    if (!agent && d.open) d.close();
    // Only when the target changes, not on every live update of the agent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const close = () => useApp.getState().openCustomizer(undefined);
  const key = agent ? profileKeyFor(agent) : '';
  const scope = key.startsWith('project:') ? t('editor.scopeProject', { path: agent?.projectPath }) : key.startsWith('subagent:') ? t('editor.scopeSubagent', { type: agent?.agentType ?? '' }) : t('editor.scopeAgent');

  const save = async () => {
    if (!agent || !base) return;
    setSaving(true);
    try {
      await useApp.getState().saveProfile(key, {
        name: name.trim() && name.trim() !== base.name ? name.trim().slice(0, 40) : undefined,
        role: role !== base.role ? role : undefined,
        appearance,
        workstationId: workstationId || undefined,
      });
      close();
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!base) return;
    await useApp.getState().resetProfile(key);
    setName(base.name);
    setRole(base.role);
    setAppearance(base.appearance);
    setWorkstationId(base.workstationId ?? '');
  };

  const set = <K extends keyof CharacterAppearance>(field: K) => (v: CharacterAppearance[K]) => setAppearance((a) => changeField(a, field, v));

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onClick={(e) => e.target === dialog.current && close()}
      className="m-auto w-[860px] max-w-[95vw] rounded-xl bg-panel p-0 text-fg shadow-2xl ring-1 ring-line-strong backdrop:bg-black/55"
      aria-labelledby="char-editor-title"
    >
      {agent && (
        <>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <div>
              <h2 id="char-editor-title" className="text-[15px] font-semibold">
                {t('editor.title')}
              </h2>
              <p className="selectable text-[11.5px] text-muted">{scope}</p>
            </div>
            <button onClick={close} className="rounded px-2 py-0.5 text-[12px] text-muted hover:bg-panel-2 hover:text-fg">
              {t('common:actions.close')}
            </button>
          </div>

          <div className="grid max-h-[72vh] grid-cols-[230px_1fr] overflow-hidden">
            <div className="flex flex-col items-center gap-3 border-r border-line bg-[repeating-linear-gradient(0deg,#2a2433_0_12px,#2e2738_12px_24px)] p-4">
              <div className="grid h-[230px] w-full place-items-center rounded-lg bg-ink/30 ring-1 ring-line">
                <Preview appearance={appearance} anim={anim} />
              </div>
              <div className="flex flex-wrap justify-center gap-1" role="radiogroup" aria-label={t('editor.animation')}>
                {PREVIEW_ANIMS.map((a) => (
                  <button
                    key={a.id}
                    role="radio"
                    aria-checked={anim === a.anim}
                    onClick={() => setAnim(a.anim)}
                    className={`rounded px-1.5 py-0.5 text-[10.5px] ${anim === a.anim ? 'bg-panel-3 text-fg ring-1 ring-line-strong' : 'text-muted hover:text-fg'}`}
                  >
                    {t(`editor.anim.${a.id}`)}
                  </button>
                ))}
              </div>
              <div className="mt-1 flex flex-col items-center">
                <EquipmentPreview appearance={appearance} />
                <span className="mt-1 text-[10.5px] text-faint">{t(`appearance.equipment.${appearance.equipment}`)}</span>
              </div>
            </div>

            <div className="scroll-thin space-y-4 overflow-y-auto p-5">
              <section className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[12px] text-muted">{t('editor.name')}</span>
                  <input
                    value={name}
                    maxLength={40}
                    onChange={(e) => setName(e.target.value)}
                    className="selectable mt-1 w-full rounded-md bg-ink/60 px-2.5 py-1.5 text-[13px] ring-1 ring-line outline-none focus:ring-amber/60"
                  />
                </label>
                <label className="block">
                  <span className="text-[12px] text-muted">{t('editor.role')}</span>
                  <select value={role} onChange={(e) => setRole(e.target.value as AgentRole)} className="mt-1 w-full rounded-md bg-ink/60 px-2 py-1.5 text-[13px] ring-1 ring-line">
                    {AGENT_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`role.${r}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              {FIELD_GROUPS.map((group, i) => (
                <section key={i} className="space-y-2.5">
                  <h3 className="text-[11px] font-semibold tracking-wide text-faint uppercase">{t(i === 0 ? 'editor.groupLook' : 'editor.groupOutfit')}</h3>
                  {group.map((field) => (
                    <OptionRow key={field} field={field} value={appearance[field]} onChange={set(field)} gender={appearance.gender} />
                  ))}
                </section>
              ))}

              <section className="space-y-2.5">
                <h3 className="text-[11px] font-semibold tracking-wide text-faint uppercase">{t('editor.groupDesk')}</h3>
                <OptionRow field="equipment" value={appearance.equipment} onChange={set('equipment')} />
                <p className="text-[11px] text-faint">{t('editor.equipmentNote')}</p>
                <div className="grid grid-cols-[84px_1fr] items-center gap-2">
                  <span className="text-[12px] text-muted">{t('editor.workstation')}</span>
                  <select value={workstationId} onChange={(e) => setWorkstationId(e.target.value)} className="rounded-md bg-ink/60 px-2 py-1.5 text-[12.5px] ring-1 ring-line">
                    <option value="">{t('editor.workstationAuto')}</option>
                    {scene.workstations.map((w, i) => (
                      <option key={w.id} value={w.id}>
                        {t('editor.workstationItem', { n: i + 1, facing: t(w.facing === 'up' ? 'editor.facesScreen' : 'editor.facesCamera') })}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-faint">{t('editor.workstationNote')}</p>
              </section>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-line px-5 py-3">
            <button onClick={() => setAppearance(appearanceFromSeed(`${Math.random()}`))} className="rounded-md px-3 py-1.5 text-[12px] ring-1 ring-line-strong hover:bg-panel-3">
              🎲 {t('editor.randomize')}
            </button>
            <button onClick={() => void reset()} className="rounded-md px-3 py-1.5 text-[12px] text-muted ring-1 ring-line hover:bg-panel-3 hover:text-fg">
              {t('editor.reset')}
            </button>
            <div className="ml-auto flex gap-2">
              <button onClick={close} className="rounded-md px-3 py-1.5 text-[12px] ring-1 ring-line-strong hover:bg-panel-3">
                {t('common:actions.cancel')}
              </button>
              <button onClick={() => void save()} disabled={saving} className="rounded-md bg-amber px-4 py-1.5 text-[12.5px] font-semibold text-ink disabled:opacity-50">
                {t('common:actions.save')}
              </button>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
