import type { BridgeConnection, BridgeState, InstallPlans, InstallTool, IntegrationConfig, IntegrationView, ToolInfo } from './types';

/** True inside the Tauri desktop shell. */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Typed wrappers over the Rust commands in src-tauri/src/lib.rs. */
export const desktop = {
  integrationGet: () => invoke<IntegrationView>('integration_get'),
  integrationSave: (config: IntegrationConfig) => invoke<void>('integration_save', { config }),
  detectClaude: (claudePath?: string) => invoke<ToolInfo>('detect_claude', { claudePath }),
  bridgeState: () => invoke<BridgeState>('bridge_state'),
  bridgeConnection: () => invoke<BridgeConnection | null>('bridge_connection'),
  bridgeRestart: () => invoke<void>('bridge_restart'),
  bridgeLogs: () => invoke<string[]>('bridge_logs'),
  installPlans: () => invoke<InstallPlans>('install_plans'),
  installTool: (tool: InstallTool) => invoke<void>('install_tool', { tool }),
  installCancel: () => invoke<void>('install_cancel'),
  openLink: (which: 'claude_docs' | 'claude_quickstart' | 'git_windows') => invoke<void>('open_link', { which }),
  openTerminalClaude: () => invoke<void>('open_terminal_claude'),
  async onInstaller(onLine: (tool: string, line: string) => void, onDone: (tool: string, ok: boolean, code: number | null) => void) {
    const { listen } = await import('@tauri-apps/api/event');
    const a = await listen<{ tool: string; line: string }>('installer://log', (e) => onLine(e.payload.tool, e.payload.line));
    const b = await listen<{ tool: string; ok: boolean; code: number | null }>('installer://done', (e) => onDone(e.payload.tool, e.payload.ok, e.payload.code));
    return () => {
      a();
      b();
    };
  },
  async onBridgeState(cb: (s: BridgeState) => void) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<BridgeState>('bridge://state', (e) => cb(e.payload));
  },
  async pickFile(title: string): Promise<string | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ directory: false, multiple: false, title });
    return typeof r === 'string' ? r : null;
  },
};


/** Rust returns errors as "code" or "code: detail". */
export function errorCode(e: unknown): string {
  const text = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
  return text.split(':')[0]!.trim();
}

/** Best-effort OS for copy and shortcuts (the desktop shell reports it authoritatively). */
export const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
