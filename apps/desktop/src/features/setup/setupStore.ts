import { create } from 'zustand';
import { bridge, BridgeRpcError } from '../../integration/bridgeClient';
import { desktop, errorCode, isTauri, isWindows } from '../../integration/platform';
import type { InstallPlans, IntegrationView, Platform, ToolInfo } from '../../integration/types';
import { useApp } from '../../state/store';

/**
 * Monitor Mode setup, shared by the first-run wizard and Settings. Every step
 * is something the user can also do by hand; "automatic setup" just runs the
 * missing ones in order and stops where a human is needed (signing in).
 */
export type StepId = 'claude' | 'login' | 'receiver' | 'hooks' | 'events';
export type StepState = 'done' | 'todo' | 'running' | 'blocked' | 'unknown';

interface SetupState {
  view?: IntegrationView;
  claude?: ToolInfo;
  loggedIn: boolean | null;
  plans?: InstallPlans;
  platform: Platform;
  install?: { phase: 'running' | 'done' | 'failed'; lines: string[]; code?: number | null };
  auto: 'idle' | 'running' | 'needs-login' | 'done' | 'failed';
  error?: string;
  busy?: string;
  load: () => Promise<void>;
  recheck: () => Promise<void>;
  installClaude: () => Promise<boolean>;
  cancelInstall: () => void;
  startReceiver: () => Promise<void>;
  installHooks: () => Promise<string | undefined>;
  openTerminal: () => Promise<void>;
  runAuto: () => Promise<void>;
}

let installWaiter: ((ok: boolean) => void) | undefined;
let listening = false;

function errorKey(e: unknown) {
  return e instanceof BridgeRpcError ? e.code : errorCode(e);
}

export const useSetup = create<SetupState>((set, get) => ({
  loggedIn: null,
  platform: isWindows ? 'windows' : 'macos',
  auto: 'idle',

  load: async () => {
    if (!isTauri) {
      void bridge.refreshHooks();
      return;
    }
    if (!listening) {
      listening = true;
      await desktop.onInstaller(
        (_tool, line) => set((s) => ({ install: s.install ? { ...s.install, lines: [...s.install.lines.slice(-400), line] } : s.install })),
        (_tool, ok, code) => {
          set((s) => ({ install: { lines: s.install?.lines ?? [], phase: ok ? 'done' : 'failed', code } }));
          installWaiter?.(ok);
          installWaiter = undefined;
        },
      );
    }
    const [view, plans] = await Promise.all([desktop.integrationGet(), desktop.installPlans()]);
    set({ view, claude: view.claude, platform: view.platform, plans });
    await get().recheck();
  },

  recheck: async () => {
    if (!isTauri) return;
    const claude = await desktop.detectClaude(get().view?.config.claudePath ?? undefined);
    set({ claude });
    void bridge.refreshHooks();
    if (useApp.getState().link === 'online') {
      try {
        const st = await bridge.rpc({ method: 'claude.status' });
        set({ loggedIn: st.loggedIn, claude: st.installed && st.path ? { ...claude, path: st.path, version: st.version, ok: true } : claude });
      } catch {
        set({ loggedIn: null });
      }
    }
  },

  installClaude: async () => {
    set({ install: { phase: 'running', lines: [] }, error: undefined });
    const done = new Promise<boolean>((resolve) => (installWaiter = resolve));
    try {
      await desktop.installTool('claude');
    } catch (e) {
      installWaiter = undefined;
      set({ install: { phase: 'failed', lines: [] }, error: errorKey(e) });
      return false;
    }
    const ok = await done;
    await get().recheck();
    return ok && !!get().claude?.ok;
  },

  cancelInstall: () => void desktop.installCancel(),

  startReceiver: async () => {
    try {
      await desktop.bridgeRestart();
    } catch (e) {
      set({ error: errorKey(e) });
    }
  },

  installHooks: async () => {
    try {
      const r = await bridge.rpc({ method: 'hooks.install' });
      useApp.getState().setHooks(r);
      return r.backup ?? undefined;
    } catch (e) {
      set({ error: errorKey(e) });
      throw e;
    }
  },

  openTerminal: async () => {
    try {
      await desktop.openTerminalClaude();
    } catch (e) {
      set({ error: errorKey(e) });
    }
  },

  runAuto: async () => {
    const s = get();
    set({ auto: 'running', error: undefined });
    try {
      if (!s.claude?.ok) {
        const ok = await get().installClaude();
        if (!ok) return set({ auto: 'failed' });
      }
      if (useApp.getState().bridge.state !== 'running') await get().startReceiver();
      await waitFor(() => useApp.getState().link === 'online', 8000);
      if (useApp.getState().link !== 'online') return set({ auto: 'failed', error: get().error ?? 'bridge_offline' });
      const hooks = useApp.getState().hooks;
      if (!hooks?.installed || hooks.stale) await get().installHooks();
      await get().recheck();
      set({ auto: get().loggedIn === false ? 'needs-login' : 'done' });
    } catch {
      set({ auto: 'failed' });
    }
  },
}));

function waitFor(cond: () => boolean, ms: number) {
  return new Promise<void>((resolve) => {
    const t0 = Date.now();
    const tick = () => (cond() || Date.now() - t0 > ms ? resolve() : setTimeout(tick, 150));
    tick();
  });
}

/** Status of each setup step, derived from live state. */
export function useSteps(): Record<StepId, StepState> {
  const s = useSetup();
  const link = useApp((a) => a.link);
  const bridgeState = useApp((a) => a.bridge);
  const hooks = useApp((a) => a.hooks);
  const lastAt = useApp((a) => a.bridgeStatus?.hooks.lastAt);
  return {
    claude: s.install?.phase === 'running' ? 'running' : !isTauri ? 'unknown' : s.claude ? (s.claude.ok ? 'done' : 'todo') : 'unknown',
    login: s.loggedIn === true ? 'done' : s.loggedIn === false ? 'todo' : 'unknown',
    receiver: bridgeState.state === 'running' && link === 'online' ? 'done' : bridgeState.state === 'starting' ? 'running' : 'todo',
    hooks: !hooks ? (link === 'online' ? 'unknown' : 'blocked') : hooks.installed && !hooks.stale ? 'done' : 'todo',
    events: lastAt ? 'done' : 'todo',
  };
}
