import { DurableObject } from 'cloudflare:workers';

export interface Env {
  RELAY: DurableObjectNamespace<RelaySession>;
}

type Role = 'A' | 'B';
interface Attachment { role: Role }

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_MSG_BYTES = 4096;

// Fail fast before spinning up a DO instance
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only WebSocket upgrades to /relay/<64-hex-char hash> are valid
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(null, { status: 426, headers: { Upgrade: 'websocket' } });
    }
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/relay\/([0-9a-f]{64})$/i);
    if (!m) return new Response(null, { status: 404 });

    const id = env.RELAY.idFromName(m[1].toLowerCase());
    return env.RELAY.get(id).fetch(request);
  },
};

// One DO instance per session, keyed by Hash 1.
// Holds at most two WebSocket connections and relays messages between them.
// Hash 2 (the encryption key) is never transmitted through this relay.
export class RelaySession extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(null, { status: 426 });
    }

    const existing = this.ctx.getWebSockets();
    if (existing.length >= 2) {
      return new Response(null, { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const role: Role = existing.length === 0 ? 'A' : 'B';

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role } satisfies Attachment);

    if (role === 'A') {
      server.send(JSON.stringify({ type: 'waiting' }));
      await this.ctx.storage.setAlarm(Date.now() + SESSION_TIMEOUT_MS);
    } else {
      server.send(JSON.stringify({ type: 'connected' }));
      existing[0].send(JSON.stringify({ type: 'connected' }));
      await this.ctx.storage.deleteAlarm();
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message === 'string' && message.length > MAX_MSG_BYTES) return;
    if (message instanceof ArrayBuffer && message.byteLength > MAX_MSG_BYTES) return;

    const { role } = ws.deserializeAttachment() as Attachment;
    const partnerRole: Role = role === 'A' ? 'B' : 'A';

    for (const peer of this.ctx.getWebSockets()) {
      if ((peer.deserializeAttachment() as Attachment).role === partnerRole) {
        peer.send(message);
        return;
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    this._notifyPartner(ws);
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    this._notifyPartner(ws);
  }

  async alarm(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ type: 'timeout' }));
        ws.close(1000, 'timeout');
      } catch { /* already closed */ }
    }
  }

  private _notifyPartner(ws: WebSocket): void {
    const { role } = ws.deserializeAttachment() as Attachment;
    const partnerRole: Role = role === 'A' ? 'B' : 'A';
    for (const peer of this.ctx.getWebSockets()) {
      if ((peer.deserializeAttachment() as Attachment).role === partnerRole) {
        try { peer.send(JSON.stringify({ type: 'partner_disconnected' })); } catch { /* closed */ }
        return;
      }
    }
  }
}
