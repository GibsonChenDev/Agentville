import type { AgentStatus } from '@agentville/domain';
import { HOOK_PROVIDERS } from '@agentville/integrations';
import { i18n } from '../../i18n';
import { isTauri } from '../../integration/platform';
import { lastHookAt } from '../../integration/protocol';
import { inMode, useApp } from '../../state/store';
import { playCue, type Cue } from './sounds';

/**
 * Turns real status transitions into attention signals: an optional sound and,
 * when the window isn't focused, a native macOS notification. Demo fixtures
 * never trigger notifications.
 */
const COOLDOWN_MS = 20_000;
const last = new Map<string, number>();

const CUE_FOR: Partial<Record<AgentStatus, Cue>> = {
  waiting_for_permission: 'attention',
  failed: 'failed',
  completed: 'done',
};

async function notify(title: string, body: string) {
  const n = await import('@tauri-apps/plugin-notification');
  let granted = await n.isPermissionGranted();
  if (!granted) granted = (await n.requestPermission()) === 'granted';
  if (granted) n.sendNotification({ title, body });
}

const ANNOUNCED_KEY = (provider: string) => `agentville.connected.${provider}`;

function announced(provider: string) {
  try {
    return localStorage.getItem(ANNOUNCED_KEY(provider)) === '1';
  } catch {
    return false;
  }
}

/** Forgets that `provider` was announced, so reconnecting it later is announced again. */
export function forgetConnection(provider: string) {
  try {
    localStorage.removeItem(ANNOUNCED_KEY(provider));
  } catch {
    // Storage unavailable: worst case the next connection isn't announced.
  }
}

/**
 * Agents that need their hooks trusted (Codex) connect while the user is in
 * that agent, not in Agentville; the first hook that arrives is the proof, so
 * say so once with a native notification.
 */
function watchConnections() {
  useApp.subscribe((s, before) => {
    if (s.bridgeStatus === before.bridgeStatus) return;
    for (const p of HOOK_PROVIDERS) {
      if (!p.needsTrust || !lastHookAt(s.bridgeStatus, p.id) || lastHookAt(before.bridgeStatus, p.id) || announced(p.id)) continue;
      try {
        localStorage.setItem(ANNOUNCED_KEY(p.id), '1');
      } catch {
        // Announce anyway; it may repeat once per app run.
      }
      if (isTauri && !document.hasFocus()) void notify(i18n.t('common:appName'), i18n.t('integration:notify.connected', { name: p.label })).catch(() => {});
    }
  });
}

export function startAlerts() {
  watchConnections();
  let prev = useApp.getState().runtime;
  useApp.subscribe((s) => {
    if (s.runtime === prev) return;
    const before = prev;
    prev = s.runtime;
    for (const [id, r] of Object.entries(s.runtime)) {
      const was = before[id]?.status;
      if (!r || was === r.status) continue;
      const cue = CUE_FOR[r.status];
      const agent = s.agents[id];
      if (!cue || !agent || !inMode(s.mode, agent.origin)) continue;
      const key = `${id}:${cue}`;
      const now = Date.now();
      if (now - (last.get(key) ?? 0) < COOLDOWN_MS) continue;
      last.set(key, now);

      if (s.prefs.sound) playCue(cue);

      const wanted = cue === 'done' ? s.prefs.notifyDone : s.prefs.notifyAttention;
      if (!isTauri || !wanted || agent.origin === 'demo' || document.hasFocus()) continue;
      const t = i18n.t.bind(i18n);
      const body =
        cue === 'attention'
          ? t('integration:notify.permission', { name: agent.name, tool: r.pendingPermission?.toolName ?? '' })
          : cue === 'failed'
            ? t('integration:notify.failed', { name: agent.name })
            : t('integration:notify.done', { name: agent.name });
      void notify(t('common:appName'), body).catch(() => {});
    }
  });
}
