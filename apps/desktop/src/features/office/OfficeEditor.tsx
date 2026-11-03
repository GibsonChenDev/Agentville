import type { OfficeTheme } from '@agentville/domain';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { THEMES } from '../../game/assets/themes';
import { FURNITURE, drawDesk } from '../../game/furniture/furniture';
import { EDITABLE_KINDS } from '../../game/scenes/editing';
import { useEditor } from './editorStore';

const thumbs = new Map<string, string>();
function thumb(theme: OfficeTheme, kind: string) {
  const k = `${theme}:${kind}`;
  let url = thumbs.get(k);
  if (!url) {
    const t = THEMES[theme];
    url = (kind === 'desk' ? drawDesk(t) : FURNITURE[kind]!.draw(t, 0)).canvas.toDataURL();
    thumbs.set(k, url);
  }
  return url;
}

/** Floating editor panel shown over the office while editing its layout. */
export function OfficeEditor() {
  const { t } = useTranslation('office');
  const ed = useEditor();
  const theme = ed.theme;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const s = useEditor.getState();
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (s.placing) s.setPlacing(undefined);
        else if (s.selectedId) s.select(undefined);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedId) {
        e.preventDefault();
        e.stopImmediatePropagation();
        s.remove();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  if (!ed.active || !theme || !ed.draft) return null;
  const selected = ed.draft.furniture.find((f) => f.id === ed.selectedId);
  const selectedWs = selected ? ed.draft.workstations.find((w) => w.deskId === selected.id) : undefined;

  return (
    <div className="pointer-events-auto absolute inset-x-3 bottom-3 rounded-xl bg-panel/95 shadow-2xl ring-1 ring-line-strong backdrop-blur" role="region" aria-label={t('editOffice')}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="rounded bg-amber px-1.5 text-[10.5px] font-bold tracking-wider text-ink uppercase">{t('editor.badge')}</span>
        <span className="text-[12.5px] font-semibold">{t(`theme.${theme}`)}</span>
        <span className="truncate text-[11.5px] text-muted">{t('editor.hint')}</span>
        <div className="ml-auto flex shrink-0 gap-1.5">
          <button onClick={ed.resetToDefault} className="rounded-md px-2.5 py-1 text-[12px] text-muted ring-1 ring-line hover:bg-panel-3 hover:text-fg">
            {t('editor.reset')}
          </button>
          <button onClick={ed.cancel} className="rounded-md px-2.5 py-1 text-[12px] ring-1 ring-line-strong hover:bg-panel-3">
            {t('common:actions.cancel')}
          </button>
          <button onClick={() => void ed.save()} disabled={!ed.dirty || ed.saving} className="rounded-md bg-amber px-3 py-1 text-[12px] font-semibold text-ink disabled:opacity-40">
            {t('common:actions.save')}
          </button>
        </div>
      </div>

      <div className="scroll-thin flex gap-1.5 overflow-x-auto px-3 py-2" role="listbox" aria-label={t('editor.palette')}>
        {EDITABLE_KINDS.map((kind) => (
          <button
            key={kind}
            role="option"
            aria-selected={ed.placing === kind}
            onClick={() => ed.setPlacing(ed.placing === kind ? undefined : kind)}
            className={`flex w-[76px] shrink-0 flex-col items-center gap-1 rounded-lg p-1.5 text-center transition-colors ${ed.placing === kind ? 'bg-amber/15 ring-1 ring-amber/60' : 'hover:bg-panel-2'}`}
            title={t(`furniture.${kind}`)}
          >
            <span className="grid h-[44px] w-full place-items-center">
              <img src={thumb(theme, kind)} alt="" className="pixelated max-h-[44px] max-w-[60px] object-contain" style={{ zoom: 1 }} />
            </span>
            <span className="w-full truncate text-[10.5px] text-muted">{t(`furniture.${kind}`)}</span>
          </button>
        ))}
      </div>

      <div className="flex min-h-[38px] items-center gap-2 border-t border-line px-3 py-1.5 text-[12px]">
        {ed.error ? (
          <span className="text-coral" role="alert">
            {t(`editor.error.${ed.error}`)}
          </span>
        ) : ed.placing ? (
          <span className="text-muted">{t('editor.placing', { item: t(`furniture.${ed.placing}`) })}</span>
        ) : selected ? (
          <>
            <span className="font-medium">{t(`furniture.${selected.kind}`)}</span>
            {selectedWs && <span className="text-muted">· {t(selectedWs.facing === 'up' ? 'editor.facingUp' : 'editor.facingDown')}</span>}
            <span className="ml-auto flex gap-1.5">
              {selectedWs && (
                <button onClick={ed.flipDesk} className="rounded-md px-2.5 py-1 ring-1 ring-line-strong hover:bg-panel-3">
                  {t('editor.flip')}
                </button>
              )}
              <button onClick={ed.remove} className="rounded-md px-2.5 py-1 text-coral ring-1 ring-coral/40 hover:bg-coral/10">
                {t('editor.remove')}
              </button>
            </span>
          </>
        ) : (
          <span className="text-faint">{t('editor.idle')}</span>
        )}
      </div>
    </div>
  );
}
