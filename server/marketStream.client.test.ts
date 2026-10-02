// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMarketStream } from "@/hooks/useMarketStream";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: string[] = [];
  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
  emitOpen() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
  emitMessage(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent); }
  emitError() { this.onerror?.(); }
  emitClose() { this.readyState = 3; this.onclose?.(); }
}

const quote = { id: 101, symbol: "AAPL", name: "Apple Inc.", assetClass: "equity", exchange: "NASDAQ", baseCurrency: "USD", quoteCurrency: "USD", price: "227.16", changePercent: "0.72", riskLevel: "medium", provider: "pending_activation", asOf: 1700000000000 };

beforeEach(() => {
  MockWebSocket.instances = [];
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useMarketStream", () => {
  it("keeps the last quote snapshot and exposes its update time", async () => {
    const { result } = renderHook(() => useMarketStream());
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.emitOpen();
      socket.emitMessage({ type: "market_status", transport: "websocket", providerState: "pending_activation", connected: false, message: "Flux prêt", asOf: 1700000000000 });
      socket.emitMessage({ type: "market_update", source: "pending_activation", asOf: 1700000000000, items: [quote] });
    });
    await waitFor(() => expect(result.current.quotes.AAPL).toMatchObject({ symbol: "AAPL", price: "227.16" }));
    expect(result.current.lastUpdate).toBe(1700000000000);
    expect(result.current.providerState).toBe("pending_activation");
  });

  it("switches to fallback on socket errors without discarding the last quote", async () => {
    const { result } = renderHook(() => useMarketStream());
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.emitMessage({ type: "market_update", source: "pending_activation", asOf: 1700000000000, items: [quote] });
      socket.emitError();
    });
    await waitFor(() => expect(result.current.connection).toBe("fallback"));
    expect(result.current.quotes.AAPL.price).toBe("227.16");
    expect(result.current.isFallback).toBe(true);
  });

  it("marks the client offline and reconnects after recovery", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMarketStream());
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.emitMessage({ type: "market_update", source: "pending_activation", asOf: 1700000000000, items: [quote] });
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.connection).toBe("offline");
    expect(result.current.quotes.AAPL.symbol).toBe("AAPL");

    act(() => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.connection).toBe("reconnecting");
    act(() => vi.advanceTimersByTime(1000));
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });
});
