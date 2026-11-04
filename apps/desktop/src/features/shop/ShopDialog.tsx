import { CATALOG, EARN, ownedCount, type CatalogItem } from '@agentville/team-protocol';
import { accessorySlot, type CharacterAppearance, type OfficeTheme } from '@agentville/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccount, type ShopTab } from '../../account/accountStore';
import { THEMES } from '../../game/assets/themes';
import { FURNITURE } from '../../game/furniture/furniture';
import { DEFAULT_SCENES } from '../../game/scenes/layouts';
import { drawRoom } from '../../game/scenes/room';
import { TeamApiError } from '../../team/api';
import { usePlayer } from '../../team/playerStore';
import { usePlace } from '../../world/placeStore';
import { chooseOfficeTheme, useOfficeStyle } from '../../world/officeTheme';
import { Portrait } from '../agents/Portrait';
import { useEditor } from '../office/editorStore';

const furnitureThumbs = new Map<string, string>();
const mapThumbs = new Map<string, string>();
/** The whole map, empty, as its shop preview. */
function mapThumb(theme: OfficeTheme) {
  let url = mapThumbs.get(theme);
  if (!url) {
    url = drawRoom(THEMES[theme], DEFAULT_SCENES[theme]).canvas.toDataURL();
    mapThumbs.set(theme, url);
  }
  return url;
}

function furnitureThumb(kind: string) {
  let url = furnitureThumbs.get(kind);
  if (!url) {
    url = FURNITURE[kind]?.draw(THEMES.studio, 0).canvas.toDataURL() ?? '';
    furnitureThumbs.set(kind, url);
  }
  return url;
}

/** The look an item gives your character, for its preview and the "Wear it" button. */
function withItem(a: CharacterAppearance, item: CatalogItem): CharacterAppearance {
  if (item.kind === 'accessory') return { ...a, [accessorySlot(item.value)]: item.value };
  if (item.kind === 'color') return { ...a, topColor: item.value as CharacterAppearance['topColor'] };
  return a;
}

/** Spend the coins your agents earned on looks and office decorations. */
export function ShopDialog() {
  const { t } = useTranslation('shop');
  const open = useAccount((s) => s.shopOpen);
  const account = useAccount((s) => s.account);
  const status = useAccount((s) => s.status);
  const player = usePlayer();
  const inLobby = usePlace((s) => s.place.kind === 'lobby');
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<ShopTab>('look');
  const office = useOfficeStyle();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [justBought, setJustBought] = useState<string>();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setError(undefined);
      setJustBought(undefined);
      const wanted = useAccount.getState().shopTab;
      if (wanted) setTab(wanted);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => useAccount.getState().openShop(false);
  const items = useMemo(() => CATALOG.filter((i) => (tab === 'look' ? i.kind === 'accessory' || i.kind === 'color' : tab === 'decor' ? i.kind === 'furniture' : i.kind === 'map')), [tab]);
  const today = account?.earn.day === new Date().toISOString().slice(0, 10) ? account.earn.today : 0;

  const buy = async (item: CatalogItem) => {
    setBusy(item.id);
    setError(undefined);
    try {
      await useAccount.getState().buy(item.id);
      setJustBought(item.id);
    } catch (e) {
      setError(e instanceof TeamApiError ? e.code : 'server');
    } finally {
      setBusy(undefined);
    }
  };

  const use = (item: CatalogItem) => {
    if (item.kind === 'map') {
      close();
      chooseOfficeTheme(item.value as OfficeTheme);
      return;
    }
    if (item.kind === 'furniture') {
      close();
      useEditor.getState().start();
      useEditor.getState().setPlacing(item.value);
      return;
    }
    usePlayer.getState().save(player.name, withItem(player.appearance, item));
  };

  const label = (item: CatalogItem) =>
    item.kind === 'furniture'
      ? t(`office:furniture.${item.value}`)
      : item.kind === 'map'
        ? t(`office:theme.${item.value}`)
        : item.kind === 'accessory'
          ? t(`agents:appearance.accessory.${item.value}`)
          : t('colorItem', { color: t(`agents:appearance.color.${item.value}`) });

  return (
    <dialog
      ref={dialog}
      onClose={close}
      onClick={(e) => e.target === dialog.current && close()}
      className="m-auto w-[760px] max-w-[95vw] rounded-xl bg-panel p-0 text-fg shadow-2xl ring-1 ring-line-strong backdrop:bg-black/55"
      aria-labelledby="shop-title"
    >
      {open && (
        <>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
            <div>
              <h2 id="shop-title" className="text-[15px] font-semibold">
                {t('title')}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted">{t('howToEarn', { perTurn: EARN.perTurn, cap: EARN.dailyCap })}</p>
              <p className="mt-0.5 text-[11.5px] text-faint">{t('limitNote')}</p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[18px] font-bold tabular-nums">🪙 {account ? account.coins.toLocaleString() : '—'}</div>
              <div className="text-[11px] text-faint">{t('today', { today, cap: EARN.dailyCap })}</div>
            </div>
          </div>

          <div className="flex gap-1 px-5 pt-3" role="tablist">
            {(['look', 'decor', 'map'] as const).map((id) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-md px-3 py-1 text-[12.5px] ${tab === id ? 'bg-panel-3 text-fg ring-1 ring-line-strong' : 'text-muted hover:text-fg'}`}
              >
                {t(`tab.${id}`)}
              </button>
            ))}
          </div>

          {status !== 'ready' && <p className="mx-5 mt-3 rounded-md bg-coral/10 p-2.5 text-[12px] text-coral ring-1 ring-coral/30">{t('offline')}</p>}
          {tab === 'map' && <p className="mx-5 mt-3 text-[12px] leading-relaxed text-muted">{t('mapNote')}</p>}

          <div className={`scroll-thin grid max-h-[56vh] gap-3 overflow-y-auto p-5 ${tab === 'map' ? 'grid-cols-2' : 'grid-cols-4'}`}>
            {items.map((item) => {
              const count = ownedCount(account?.inventory, item.id);
              const owned = count > 0;
              const canBuyMore = count < item.max;
              const wearing =
                item.kind === 'accessory'
                  ? player.appearance[accessorySlot(item.value)] === item.value
                  : item.kind === 'color'
                    ? player.appearance.topColor === item.value
                    : item.kind === 'map' && office === item.value;
              return (
                <div key={item.id} className={`flex flex-col items-center rounded-lg bg-panel-2 p-3 ring-1 ${justBought === item.id ? 'ring-amber' : 'ring-line'}`}>
                  <div className={`grid w-full place-items-center overflow-hidden rounded-md bg-ink/40 ${item.kind === 'map' ? 'h-[150px]' : 'h-[84px]'}`}>
                    {item.kind === 'map' ? (
                      <img src={mapThumb(item.value as OfficeTheme)} alt="" className="pixelated h-full w-full object-cover" />
                    ) : item.kind === 'furniture' ? (
                      <img src={furnitureThumb(item.value)} alt="" className="pixelated h-[64px] w-auto" />
                    ) : (
                      <Portrait appearance={withItem(player.appearance, item)} size={72} />
                    )}
                  </div>
                  <div className="mt-2 w-full truncate text-center text-[12.5px] font-medium">{label(item)}</div>
                  {item.max > 1 && (
                    <div className="mt-0.5 text-[11px] text-faint tabular-nums">{t('ownedOf', { count, max: item.max })}</div>
                  )}
                  {item.kind === 'furniture' && owned && canBuyMore ? (
                    <div className="mt-2 flex w-full gap-1.5">
                      <button
                        onClick={() => use(item)}
                        disabled={inLobby}
                        title={inLobby ? t('placeFromOffice') : undefined}
                        className="flex-1 rounded-md px-2 py-1 text-[12px] ring-1 ring-line-strong hover:bg-panel-3 disabled:opacity-50"
                      >
                        {t('place')}
                      </button>
                      <button
                        onClick={() => void buy(item)}
                        disabled={!account || busy === item.id || account.coins < item.price}
                        title={t('buyAnother')}
                        className="flex-1 rounded-md bg-amber px-2 py-1 text-[12px] font-semibold text-ink disabled:bg-panel-3 disabled:text-faint"
                      >
                        +🪙 {item.price.toLocaleString()}
                      </button>
                    </div>
                  ) : owned ? (
                    <button
                      onClick={() => use(item)}
                      disabled={wearing || (item.kind === 'furniture' && inLobby)}
                      title={item.kind === 'furniture' && inLobby ? t('placeFromOffice') : undefined}
                      className="mt-2 w-full rounded-md px-2 py-1 text-[12px] ring-1 ring-line-strong hover:bg-panel-3 disabled:opacity-50"
                    >
                      {item.kind === 'furniture' ? t('place') : item.kind === 'map' ? (wearing ? t('mapInUse') : t('useMap')) : wearing ? t('wearing') : t('wear')}
                    </button>
                  ) : (
                    <button
                      onClick={() => void buy(item)}
                      disabled={!account || busy === item.id || account.coins < item.price}
                      className="mt-2 w-full rounded-md bg-amber px-2 py-1 text-[12px] font-semibold text-ink disabled:bg-panel-3 disabled:text-faint"
                    >
                      🪙 {item.price.toLocaleString()}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3 border-t border-line px-5 py-3">
            <span className="text-[12px] text-coral" role="alert">
              {error ? t(`error.${error}`) : ''}
            </span>
            <button onClick={close} className="ml-auto rounded-md px-3 py-1.5 text-[12px] ring-1 ring-line-strong hover:bg-panel-3">
              {t('common:actions.close')}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
