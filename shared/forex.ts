export function getIndicativeBidAsk(mid: number, spreadBps = 2) {
  if (!Number.isFinite(mid) || mid <= 0) return { bid: 0, ask: 0, spread: 0 };
  const spread = mid * (spreadBps / 10000);
  return {
    bid: Math.max(0, mid - spread / 2),
    ask: mid + spread / 2,
    spread,
  };
}

export function calculateForexMargin(notional: number, leverage = 1) {
  if (!Number.isFinite(notional) || notional < 0 || !Number.isFinite(leverage) || leverage <= 0) return 0;
  return notional / leverage;
}
