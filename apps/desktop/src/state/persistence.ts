import { OFFICE_THEMES, type OfficeTheme } from '@agentville/domain';
import type { LocalePreference } from '../i18n';
import type { AppMode } from './store';

/**
 * Preferences persistence. Phase 1 uses localStorage (per-origin, survives
 * restarts of the desktop app). Agents, tasks and layouts move to SQLite in
 * Phase 3–4 behind the same kind of repository boundary.
 */
export interface Prefs {
  version: 1;
  locale: LocalePreference;
  theme: OfficeTheme;
  mode: AppMode;
  consoleOpen: boolean;
  reduceMotion: boolean;
  alwaysShowLabels: boolean;
  sound: boolean;
  /** Native notifications when an observed agent needs approval or fails. */
  notifyAttention: boolean;
  /** Native notifications when an observed agent finishes a turn. */
  notifyDone: boolean;
  /** First-run welcome completed. */
  onboarded: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
}

const KEY = 'agentville.prefs.v1';

export const DEFAULT_PREFS: Prefs = {
  version: 1,
  locale: 'system',
  theme: 'loft',
  mode: 'demo',
  consoleOpen: true,
  reduceMotion: false,
  alwaysShowLabels: false,
  sound: false,
  notifyAttention: true,
  notifyDone: false,
  onboarded: false,
  sidebarWidth: 248,
  inspectorWidth: 320,
};

export function sanitizePrefs(raw: unknown): Prefs {
  const p = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, unknown>;
  if (r.locale === 'en' || r.locale === 'zh-TW' || r.locale === 'system') p.locale = r.locale;
  if (typeof r.theme === 'string' && (OFFICE_THEMES as readonly string[]).includes(r.theme)) p.theme = r.theme as OfficeTheme;
  if (r.mode === 'demo' || r.mode === 'live') p.mode = r.mode;
  for (const k of ['consoleOpen', 'reduceMotion', 'alwaysShowLabels', 'sound', 'notifyAttention', 'notifyDone', 'onboarded'] as const) if (typeof r[k] === 'boolean') p[k] = r[k];
  if (typeof r.sidebarWidth === 'number') p.sidebarWidth = Math.min(400, Math.max(200, r.sidebarWidth));
  if (typeof r.inspectorWidth === 'number') p.inspectorWidth = Math.min(480, Math.max(280, r.inspectorWidth));
  return p;
}

export function loadPrefs(): { prefs: Prefs; available: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    return { prefs: sanitizePrefs(raw ? JSON.parse(raw) : null), available: true };
  } catch {
    return { prefs: { ...DEFAULT_PREFS }, available: false };
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage unavailable; the UI surfaces this through `storageAvailable`.
  }
}
