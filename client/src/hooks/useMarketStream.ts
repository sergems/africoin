import { useEffect, useMemo, useRef, useState } from "react";

export type StreamQuote = {
  id: number;
  symbol: string;
  name: string;
  assetClass: string;
  exchange: string;
  baseCurrency: string;
  quoteCurrency: string;
  price: string;
  changePercent: string;
  riskLevel: string;
  provider: string;
  asOf: number;
};

type StreamStatusMessage = {
  type: "market_status";
  transport: "websocket";
  providerState: "pending_activation" | "live";
  connected: boolean;
  message: string;
  asOf: number;
};

type StreamUpdateMessage = {
  type: "market_update";
  source: "pending_activation" | "partner";
  asOf: number;
  items: StreamQuote[];
};

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline" | "fallback";

export function useMarketStream(enabled = true) {
  const [quotes, setQuotes] = useState<Record<string, StreamQuote>>({});
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [providerState, setProviderState] = useState<"pending_activation" | "live">("pending_activation");
  const [providerMessage, setProviderMessage] = useState("Connexion au flux de marché…");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let attempt = 0;

    const clearRetry = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const scheduleReconnect = () => {
      if (disposed || !navigator.onLine) return;
      clearRetry();
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 4), 15000);
      attempt += 1;
      setRetryCount(attempt);
      setConnection("reconnecting");
      timerRef.current = setTimeout(connect, delay);
    };

    const connect = (recovering = false) => {
      if (disposed) return;
      if (!navigator.onLine) {
        setConnection("offline");
        setProviderMessage("Connexion hors ligne — dernier catalogue conservé");
        return;
      }
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${window.location.host}/api/market-stream`);
      socketRef.current = socket;
      setConnection(recovering || attempt > 0 ? "reconnecting" : "connecting");
      socket.onopen = () => {
        attempt = 0;
        setRetryCount(0);
        setConnection("connected");
        setProviderMessage("Flux WebSocket connecté");
        socket.send(JSON.stringify({ type: "subscribe", symbols: [] }));
      };
      socket.onmessage = event => {
        try {
          const message = JSON.parse(String(event.data)) as StreamStatusMessage | StreamUpdateMessage;
          if (message.type === "market_status") {
            setProviderState(message.providerState);
            setProviderMessage(message.message);
            setConnection("connected");
          }
          if (message.type === "market_update") {
            setQuotes(current => Object.fromEntries([...Object.entries(current), ...message.items.map(item => [item.symbol, item])]));
            setLastUpdate(message.asOf);
            setProviderState(message.source === "partner" ? "live" : "pending_activation");
            setConnection("connected");
          }
        } catch {
          setConnection("fallback");
          setProviderMessage("Message de marché non reconnu — dernier catalogue conservé");
        }
      };
      socket.onerror = () => {
        setConnection("fallback");
        setProviderMessage("Flux indisponible — dernier catalogue conservé");
      };
      socket.onclose = () => {
        if (disposed) return;
        socketRef.current = null;
        if (navigator.onLine) scheduleReconnect();
        else setConnection("offline");
      };
    };

    const handleOnline = () => {
      attempt = 0;
      clearRetry();
      setConnection("reconnecting");
      connect(true);
    };
    const handleOffline = () => {
      clearRetry();
      socketRef.current?.close();
      setConnection("offline");
      setProviderMessage("Connexion hors ligne — dernier catalogue conservé");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    connect();
    return () => {
      disposed = true;
      clearRetry();
      socketRef.current?.close();
      socketRef.current = null;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [enabled]);

  const quoteList = useMemo(() => Object.values(quotes), [quotes]);
  const isFallback = connection === "fallback" || connection === "offline" || providerState === "pending_activation";
  return { quotes, quoteList, connection, providerState, providerMessage, lastUpdate, retryCount, isFallback };
}
