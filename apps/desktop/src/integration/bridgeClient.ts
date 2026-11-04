import { appearanceFromSeed, type AgentRecord } from '@agentville/domain';
import { HOOK_PROVIDERS, hookProvider } from '@agentville/integrations';
import { useApp } from '../state/store';
import { desktop, isTauri } from './platform';
import { createHookPipeline } from './hookPipeline';
import type { RpcResult } from './protocol';
import type { BridgeConnection, ExternalSession, RpcRequest, StreamMessage } from './types';

export class BridgeRpcError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code);
  }
}

/**
 * Connects the UI to the local bridge (Monitor Mode): a long-lived NDJSON
 * stream of observed hook events plus JSON RPC for hook installation. Reconnects with backoff; every incoming event goes
 * through the store's de-duplicating `ingest`.
 */
class BridgeClient {
  private conn: BridgeConnection | null = null;
  private abort?: AbortController;
  private retry = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private started = false;
  private pipeline = createHookPipeline({
    ingest: (e) => useApp.getState().ingest(e),
    discover: registerExternal,
    locate: (agentId, cwd) => {
      useApp.getState().setLocation(agentId, { cwd });
      void this.rpc({ method: 'git.info', params: { cwd } })
        .then((git) => git && useApp.getState().setLocation(agentId, { cwd, git }))
        .catch(() => {});
    },
  });

  async start() {
    if (this.started) return;
    this.started = true;
    if (isTauri) {
      await desktop.onBridgeState((s) => {
        useApp.getState().setBridgeState(s);
        if (s.state === 'running') void this.connect();
        else this.disconnect();
      });
      const s = await desktop.bridgeState();
      useApp.getState().setBridgeState(s);
      if (s.state === 'running') void this.connect();
    } else {
      useApp.getState().setBridgeState({ state: 'stopped' });
    }
  }

  private disconnect() {
    this.abort?.abort();
    clearTimeout(this.timer);
    this.conn = null;
    useApp.getState().setLink('offline');
    useApp.getState().clearHooks();
  }

  private async connect() {
    this.abort?.abort();
    clearTimeout(this.timer);
    this.conn = isTauri ? await desktop.bridgeConnection() : null;
    if (!this.conn) return;
    const abort = new AbortController();
    this.abort = abort;
    useApp.getState().setLink('connecting');
    try {
      const res = await fetch(`${this.conn.url}/stream`, { headers: { Authorization: `Bearer ${this.conn.token}` }, signal: abort.signal });
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      this.retry = 0;
      useApp.getState().setLink('online');
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.trim()) this.handle(JSON.parse(line) as StreamMessage);
        }
      }
      throw new Error('stream closed');
    } catch {
      if (abort.signal.aborted) return;
      useApp.getState().setLink('offline');
      const delay = Math.min(15_000, 500 * 2 ** this.retry++);
      this.timer = setTimeout(() => void this.connect(), delay);
    }
  }

  private handle(msg: StreamMessage) {
    const store = useApp.getState();
    switch (msg.type) {
      case 'hello':
        store.setBridgeStatus(msg.status);
        msg.recent.forEach((h) => this.pipeline(h));
        void this.refreshHooks();
        break;
      case 'hook':
        this.pipeline(msg.hook);
        break;
      case 'status':
        store.setBridgeStatus(msg.status);
        break;
      case 'ping':
        break;
    }
  }

  /** Refreshes the hook installation status of every provider (or just one). */
  async refreshHooks(provider?: string) {
    const ids = provider ? [provider] : HOOK_PROVIDERS.map((p) => p.id);
    await Promise.all(
      ids.map(async (id) => {
        try {
          useApp.getState().setHooks(id, await this.rpc({ method: 'hooks.status', params: { provider: id } }));
        } catch {
          useApp.getState().setHooks(id, undefined);
        }
      }),
    );
  }

  async rpc<R extends RpcRequest>(request: R): Promise<RpcResult<R['method']>> {
    if (!this.conn) throw new BridgeRpcError('bridge_offline');
    let res: Response;
    try {
      res = await fetch(`${this.conn.url}/rpc`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.conn.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
    } catch {
      throw new BridgeRpcError('bridge_offline');
    }
    const body = (await res.json()) as { ok: boolean; result?: unknown; error?: { code: string; detail?: string } };
    if (!body.ok) throw new BridgeRpcError(body.error?.code ?? 'internal', body.error?.detail);
    return body.result as RpcResult<R['method']>;
  }
}

/** Creates (once) the office character for an externally observed session (Claude Code, Codex, …). */
function registerExternal(session: ExternalSession) {
  const store = useApp.getState();
  if (store.agents[session.agentId]) return;
  const folder = session.cwd?.split(/[\\/]/).filter(Boolean).pop() ?? hookProvider(session.provider)?.label ?? 'Agent';
  // Characters carry a provider badge, so only the same agent in the same folder needs telling apart.
  const sameFolder = Object.values(store.agents).filter((a) => a.origin === 'external' && a.kind === 'agent' && (a.provider ?? 'claude') === session.provider && a.projectPath === session.cwd).length;
  const record: AgentRecord = {
    id: session.agentId,
    name: sameFolder ? `${folder} · ${session.sessionId.slice(0, 4)}` : folder,
    role: 'generalist',
    origin: 'external',
    provider: session.provider,
    kind: 'agent',
    projectPath: session.cwd,
    appearance: appearanceFromSeed(session.sessionId),
    createdAt: session.firstSeenAt,
  };
  store.upsertAgent(record);
}

export const bridge = new BridgeClient();
