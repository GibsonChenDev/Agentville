export type { BridgeStatus, ClaudeStatus, ExternalSession, HooksPreview, HooksStatus, RawHook, RpcRequest, StreamMessage } from './protocol';

export interface ToolInfo {
  path: string | null;
  version: string | null;
  ok: boolean;
  source: 'config' | 'detected' | 'none';
}

export interface IntegrationConfig {
  claudePath: string | null;
  hookPort: number;
  hookToken: string;
  autoStart: boolean;
}

export type BridgeState =
  | { state: 'stopped' }
  | { state: 'starting' }
  | { state: 'running'; port: number }
  | { state: 'failed'; code: string; detail: string | null };

export interface BridgeConnection {
  url: string;
  token: string;
}

export type Platform = 'macos' | 'windows' | 'linux';

export interface IntegrationView {
  config: IntegrationConfig;
  claude: ToolInfo;
  /** Git is optional (branch/worktree display only). */
  git: boolean;
  platform: Platform;
  bridge: BridgeState;
}

export type InstallPlan = { method: 'shell'; command: string; shell: 'powershell' | 'shell' };
export interface InstallPlans {
  claude: InstallPlan;
  running: string | null;
}
export type InstallTool = 'claude';
