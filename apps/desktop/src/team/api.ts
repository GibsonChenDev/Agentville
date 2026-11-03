import type { ApiErrorCode, Appearance, MembershipResponse } from '@agentville/team-protocol';

/** HTTP calls to the team relay. Errors carry a stable code for localized messages. */
export class TeamApiError extends Error {
  constructor(readonly code: ApiErrorCode | 'network' | 'server' | 'no_server') {
    super(code);
  }
}

export function normalizeServer(url: string): string | null {
  const s = url.trim().replace(/\/+$/, '');
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'))) return s;
  } catch {
    // not a URL
  }
  return null;
}

export function socketUrl(server: string, roomId: string) {
  return `${server.replace(/^http/, 'ws')}/v1/rooms/${roomId}/ws`;
}

async function call<T>(server: string, path: string, body: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${server}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new TeamApiError('network');
  }
  const data = (await res.json().catch(() => null)) as { error?: ApiErrorCode } | null;
  if (!res.ok) throw new TeamApiError(data?.error ?? 'server');
  return data as T;
}

export const teamApi = {
  create: (server: string, roomName: string, name: string, appearance: Appearance) => call<MembershipResponse>(server, '/v1/rooms', { roomName, name, appearance }),
  join: (server: string, code: string, name: string, appearance: Appearance) => call<MembershipResponse>(server, '/v1/join', { code, name, appearance }),
  rotate: (server: string, roomId: string, token: string) => call<{ code: string }>(server, `/v1/rooms/${roomId}/rotate`, {}, token),
  leave: (server: string, roomId: string, token: string) => call<{ ok: true }>(server, `/v1/rooms/${roomId}/leave`, {}, token),
};
