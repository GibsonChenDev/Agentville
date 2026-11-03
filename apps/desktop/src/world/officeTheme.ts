import { OFFICE_THEMES, type OfficeTheme } from '@agentville/domain';
import { useApp } from '../state/store';
import { team } from '../team/teamClient';
import { useTeam, type TeamState } from '../team/teamStore';

/**
 * The map of the office you're in: a team office's shared choice, or your
 * personal office's (kept in your preferences, untouched by team offices).
 */
const valid = (t?: string): t is OfficeTheme => !!t && (OFFICE_THEMES as readonly string[]).includes(t);

export function officeTheme(personal: OfficeTheme, teamState: Pick<TeamState, 'membership' | 'room' | 'preview'>): OfficeTheme {
  // While the relay hasn't answered yet, the office's map as last seen.
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

/** Picks a map for the office you're in. */
export function chooseOfficeTheme(theme: OfficeTheme) {
  if (useTeam.getState().membership && useTeam.getState().room) team.setTheme(theme);
  else useApp.getState().setTheme(theme);
}
