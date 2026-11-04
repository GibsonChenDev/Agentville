import { OFFICE_THEMES, type OfficeTheme } from '@agentville/domain';
import { create } from 'zustand';
import { mapLocked, useAccount } from '../account/accountStore';
import { useApp } from '../state/store';
import { useTeam, type TeamState } from '../team/teamStore';

/**
 * Two separate things decide what an office looks like:
 *
 * - its **layout** (`officeTheme`): which built-in furniture layout and saved
 *   edits it uses. A team office's layout is shared, so everyone's desks,
 *   sofas and seats line up and you're seen sitting where you sit.
 * - its **style** (`officeStyle`): floor, walls, window view and colours. In a
 *   team office each person picks their own, remembered per office on this
 *   computer; it never changes what anyone else sees.
 *
 * In your own office the two are the same choice, kept in your preferences.
 */
const valid = (t?: string): t is OfficeTheme => !!t && (OFFICE_THEMES as readonly string[]).includes(t);

type TeamView = Pick<TeamState, 'membership' | 'room' | 'preview'>;

export function officeTheme(personal: OfficeTheme, teamState: TeamView): OfficeTheme {
  // While the relay hasn't answered yet, the office's layout as last seen.
  const shared = teamState.membership ? (teamState.room?.theme ?? teamState.preview?.theme) : undefined;
  return valid(shared) ? shared : personal;
}

export function useOfficeTheme(): OfficeTheme {
  const personal = useApp((s) => s.prefs.theme);
  const shared = useTeam((s) => (s.membership ? (s.room?.theme ?? s.preview?.theme) : undefined));
  return valid(shared) ? shared : personal;
}

export function currentOfficeTheme(): OfficeTheme {
  return officeTheme(useApp.getState().prefs.theme, useTeam.getState());
}

// ───────────────────────────────── your own style per team office

const STYLE_KEY = 'agentville.officeStyles.v1';

function loadStyles(): Record<string, OfficeTheme> {
  try {
    const raw = JSON.parse(localStorage.getItem(STYLE_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw ?? {}).filter((e): e is [string, OfficeTheme] => valid(e[1] as string)));
  } catch {
    return {};
  }
}

export const useOfficeStyles = create<{ styles: Record<string, OfficeTheme>; setStyle: (roomId: string, style: OfficeTheme) => void }>((set, get) => ({
  styles: loadStyles(),
  setStyle: (roomId, style) => {
    const styles = { ...get().styles, [roomId]: style };
    set({ styles });
    try {
      localStorage.setItem(STYLE_KEY, JSON.stringify(styles));
    } catch {
      // kept for this session only
    }
  },
}));

export function officeStyle(personal: OfficeTheme, teamState: TeamView, styles: Record<string, OfficeTheme>): OfficeTheme {
  const roomId = teamState.membership?.roomId;
  const mine = roomId ? styles[roomId] : undefined;
  return valid(mine) ? mine : officeTheme(personal, teamState);
}

export function useOfficeStyle(): OfficeTheme {
  const layout = useOfficeTheme();
  const roomId = useTeam((s) => s.membership?.roomId);
  const mine = useOfficeStyles((s) => (roomId ? s.styles[roomId] : undefined));
  return roomId && valid(mine) ? mine : layout;
}

export function currentOfficeStyle(): OfficeTheme {
  return officeStyle(useApp.getState().prefs.theme, useTeam.getState(), useOfficeStyles.getState().styles);
}

/**
 * The map buttons. In a team office they change only how the office looks to
 * you; in your own office they pick its map (layout and look together).
 */
export function chooseOfficeTheme(theme: OfficeTheme) {
  // A map from the shop you haven't bought yet: show it in the shop instead.
  if (mapLocked(useAccount.getState().account?.inventory, theme)) return useAccount.getState().openShop(true, 'map');
  const roomId = useTeam.getState().membership?.roomId;
  if (roomId) useOfficeStyles.getState().setStyle(roomId, theme);
  else useApp.getState().setTheme(theme);
}
