import { DurableObject } from 'cloudflare:workers';

export interface Env {
  RELAY: DurableObjectNamespace<RelaySession>;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
}

type Role = 'A' | 'B';
interface Attachment { role: Role; ip: string; lastMsgMs: number; msgCount: number }

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_MSG_BYTES      = 4096;
const MAX_CONNS_PER_IP   = 6;   // 2 per session × up to 3 concurrent; covers same-IP / NAT / local testing
const MSG_RATE_LIMIT     = 20;  // messages per second per socket
const MSG_RATE_WINDOW_MS = 1000;

// ── Worker entrypoint ─────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(null, { status: 404 });
    }
    if (!request.headers.get('Origin')) {
      return new Response(null, { status: 404 });
    }

    const url = new URL(request.url);
    const m = url.pathname.match(/^\/relay\/([A-Za-z0-9_-]{43})$/);
    if (!m) return new Response(null, { status: 404 });

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const limiter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(ip));
    if (!await limiter.tryConnect()) return new Response(null, { status: 429 });

    const response = await env.RELAY.get(env.RELAY.idFromName(m[1])).fetch(request);

    // Session full — release the slot we just claimed
    if (response.status === 409) await limiter.release();

    return response;
  },
};

// ── Rate Limiter Durable Object ───────────────────────────────────────────────
// One instance per IP address. Tracks concurrent open WebSocket connections.
// Uses durable storage so the count survives DO hibernation between RPC calls.

export class RateLimiter extends DurableObject<Env> {
  async tryConnect(): Promise<boolean> {
    const count = (await this.ctx.storage.get<number>('c')) ?? 0;
    if (count >= MAX_CONNS_PER_IP) return false;
    await this.ctx.storage.put('c', count + 1);
    return true;
  }

  async release(): Promise<void> {
    const count = (await this.ctx.storage.get<number>('c')) ?? 0;
    if (count > 0) await this.ctx.storage.put('c', count - 1);
  }
}

// ── Session Durable Object ────────────────────────────────────────────────────
// One DO instance per session, keyed by session_id (256-bit random).
// Holds at most two WebSocket connections and relays messages between them.
// The session key (AES-256-GCM encryption secret) is never transmitted here —
// the relay sees only ciphertext.

export class RelaySession extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(null, { status: 404 });
    }

    const existing = this.ctx.getWebSockets();
    if (existing.length >= 2) {
      return new Response(null, { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    const role: Role = existing.length === 0 ? 'A' : 'B';
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role, ip, lastMsgMs: 0, msgCount: 0 } satisfies Attachment);

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

    const att = ws.deserializeAttachment() as Attachment;
    const now = Date.now();

    if (now - att.lastMsgMs >= MSG_RATE_WINDOW_MS) {
      att.msgCount = 1;
      att.lastMsgMs = now;
    } else {
      att.msgCount++;
    }
    if (att.msgCount > MSG_RATE_LIMIT) return;
    ws.serializeAttachment(att);

    const partnerRole: Role = att.role === 'A' ? 'B' : 'A';
    for (const peer of this.ctx.getWebSockets()) {
      if ((peer.deserializeAttachment() as Attachment).role === partnerRole) {
        peer.send(message);
        return;
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    this._notifyPartner(ws);
    void this._releaseSlot(ws);
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
        try { peer.close(1001, 'partner disconnected'); } catch { /* closed */ }
        return;
      }
    }
  }

  private async _releaseSlot(ws: WebSocket): Promise<void> {
    const { ip } = ws.deserializeAttachment() as Attachment;
    await this.env.RATE_LIMITER.get(this.env.RATE_LIMITER.idFromName(ip)).release();
  }
}
