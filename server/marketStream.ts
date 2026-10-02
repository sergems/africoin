import type { IncomingMessage, Server as HttpServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { getInstruments } from "./db";
import { getProviderRegistry } from "./providers";
import { pendingActivationInstruments } from "./marketCatalog";

type MarketRow = {
  id: number | string;
  symbol: string;
  name: string;
  assetClass: string;
  exchange: string;
  baseCurrency: string;
  quoteCurrency: string;
  price: string | number;
  changePercent: string | number;
  riskLevel: string;
  provider: string;
};

type StreamClient = { socket: WebSocket; symbols: Set<string> | null };

export type MarketStreamStatus = {
  type: "market_status";
  transport: "websocket";
  providerState: "pending_activation" | "live";
  connected: boolean;
  message: string;
  asOf: number;
};

export type MarketStreamUpdate = {
  type: "market_update";
  source: "pending_activation" | "partner";
  asOf: number;
  items: Array<MarketRow & { id: number; price: string; changePercent: string; asOf: number }>;
};

export function buildMarketStreamStatus(now = Date.now()): MarketStreamStatus {
  const provider = getProviderRegistry().find(item => item.category === "market_data");
  const live = provider?.connected === true && provider.mode === "live";
  return {
    type: "market_status",
    transport: "websocket",
    providerState: live ? "live" : "pending_activation",
    connected: live,
    message: live ? "Flux partenaire actif" : "Flux prêt, données partenaire en attente de connexion",
    asOf: now,
  };
}

export function buildMarketStreamUpdate(rows: readonly MarketRow[], now = Date.now()): MarketStreamUpdate {
  const status = buildMarketStreamStatus(now);
  const source = status.providerState === "live" ? "partner" : "pending_activation";
  return {
    type: "market_update",
    source,
    asOf: now,
    items: rows.map(row => ({
      ...row,
      id: Number(row.id),
      price: String(row.price),
      changePercent: String(row.changePercent),
      asOf: now,
    })),
  };
}

function parseSymbols(message: WebSocket.RawData) {
  try {
    const parsed = JSON.parse(message.toString()) as { type?: string; symbols?: unknown };
    if (parsed.type !== "subscribe" || !Array.isArray(parsed.symbols)) return null;
    const symbols = parsed.symbols.filter((symbol): symbol is string => typeof symbol === "string" && symbol.length > 0).map(symbol => symbol.toUpperCase());
    return new Set(symbols);
  } catch {
    return null;
  }
}

export function registerMarketStream(server: HttpServer) {
  const streamServer = new WebSocketServer({ noServer: true });
  const clients = new Set<StreamClient>();
  let closed = false;

  const sendSnapshot = async (client: StreamClient) => {
    try {
      const rows = (await getInstruments()) as MarketRow[];
      const catalog = rows.length ? rows : pendingActivationInstruments;
      const update = buildMarketStreamUpdate(catalog);
      const filtered = client.symbols ? { ...update, items: update.items.filter(item => client.symbols?.has(item.symbol)) } : update;
      if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(filtered));
    } catch {
      if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify({ ...buildMarketStreamStatus(), message: "Actualisation indisponible, le dernier catalogue reste affiché." }));
    }
  };

  const broadcast = async () => {
    if (closed || clients.size === 0) return;
    await Promise.all(Array.from(clients, sendSnapshot));
  };

  streamServer.on("connection", (socket: WebSocket) => {
    const client: StreamClient = { socket, symbols: null };
    clients.add(client);
    socket.send(JSON.stringify(buildMarketStreamStatus()));
    void sendSnapshot(client);
    socket.on("message", message => {
      const symbols = parseSymbols(message);
      if (symbols) {
        client.symbols = symbols;
        void sendSnapshot(client);
      }
    });
    socket.on("close", () => clients.delete(client));
    socket.on("error", () => clients.delete(client));
  });

  const upgradeHandler = (request: IncomingMessage, socket: import("net").Socket, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/market-stream") return;
    streamServer.handleUpgrade(request, socket, head, client => streamServer.emit("connection", client, request));
  };
  server.on("upgrade", upgradeHandler);
  const interval = setInterval(() => void broadcast(), 5000);
  interval.unref?.();

  return {
    broadcast,
    close: () => {
      closed = true;
      clearInterval(interval);
      server.off("upgrade", upgradeHandler);
      streamServer.close();
    },
  };
}
