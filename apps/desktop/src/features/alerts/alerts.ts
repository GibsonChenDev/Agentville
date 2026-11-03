import type { AgentStatus } from '@agentville/domain';
import { i18n } from '../../i18n';
import { isTauri } from '../../integration/platform';
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

export function startAlerts() {
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
