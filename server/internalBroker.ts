import { and, eq, sql } from "drizzle-orm";
import { instruments, orders, positions, walletTransactions, wallets } from "../drizzle/schema";
import { getDb, writeAuditLog } from "./db";

export function isTriggered(order: Pick<typeof orders.$inferSelect, "orderType" | "side" | "limitPrice">, price: number) {
  const trigger = Number(order.limitPrice ?? 0);
  if (!Number.isFinite(trigger) || trigger <= 0) return false;
  if (order.orderType === "limit") return order.side === "buy" ? price <= trigger : price >= trigger;
  if (order.orderType === "stop") return order.side === "buy" ? price >= trigger : price <= trigger;
  return false;
}

export async function processTriggeredInternalOrders(instrumentId: number, price: number) {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const db = await getDb();
  if (!db) return 0;
  const queued = await db.select().from(orders).where(and(eq(orders.instrumentId, instrumentId), eq(orders.status, "submitted")));
  let filled = 0;
  for (const order of queued) {
    if (!isTriggered(order, price)) continue;
    const result = await db.transaction(async tx => {
      const current = (await tx.select().from(orders).where(and(eq(orders.id, order.id), eq(orders.status, "submitted"))).limit(1))[0];
      if (!current) return false;
      const instrument = (await tx.select().from(instruments).where(eq(instruments.id, current.instrumentId)).limit(1))[0];
      if (!instrument) return false;
      const currency = instrument.quoteCurrency as "CDF" | "USD" | "KES" | "NGN" | "ZAR" | "GHS" | "UGX" | "TZS" | "RWF" | "JPY" | "CAD" | "CHF" | "CNH";
      const wallet = (await tx.select().from(wallets).where(and(eq(wallets.userId, current.userId), eq(wallets.currency, currency))).limit(1))[0];
      if (!wallet) return false;
      const position = (await tx.select().from(positions).where(and(eq(positions.userId, current.userId), eq(positions.instrumentId, current.instrumentId))).limit(1))[0];
      const quantity = Number(current.quantity);
      const notional = price * quantity;
      if (current.side === "sell") {
        if (!position || Number(position.quantity) < quantity) return false;
        const released = await tx.update(positions).set({ quantity: sql`${positions.quantity} - ${quantity}`, updatedAt: new Date() }).where(and(eq(positions.id, position.id), sql`${positions.quantity} >= ${quantity}`));
        if (!released[0]?.affectedRows) return false;
        await tx.update(wallets).set({ availableBalance: sql`${wallets.availableBalance} + ${notional}`, updatedAt: new Date() }).where(eq(wallets.id, wallet.id));
        await tx.insert(walletTransactions).values({ walletId: wallet.id, userId: current.userId, type: "trade_credit", direction: "credit", amount: notional.toFixed(8), currency, status: "completed", reference: `AFRIBROKER-${current.id}-CREDIT`, description: `Vente interne déclenchée ${quantity}`, completedAt: new Date() });
      } else {
        const reserved = await tx.update(wallets).set({ pendingBalance: sql`GREATEST(${wallets.pendingBalance} - ${Number(current.marginUsed ?? notional)}, 0)`, updatedAt: new Date() }).where(and(eq(wallets.id, wallet.id), sql`${wallets.pendingBalance} >= ${Number(current.marginUsed ?? notional)}`));
        if (!reserved[0]?.affectedRows) return false;
        const oldQuantity = Number(position?.quantity ?? 0);
        const newQuantity = oldQuantity + quantity;
        const averageCost = ((oldQuantity * Number(position?.averageCost ?? 0)) + notional) / newQuantity;
        if (position) await tx.update(positions).set({ quantity: newQuantity.toFixed(8), averageCost: averageCost.toFixed(8), updatedAt: new Date() }).where(eq(positions.id, position.id));
        else await tx.insert(positions).values({ userId: current.userId, instrumentId: current.instrumentId, quantity: quantity.toFixed(8), averageCost: price.toFixed(8), unrealizedPnl: "0", currency, updatedAt: new Date() });
        await tx.insert(walletTransactions).values({ walletId: wallet.id, userId: current.userId, type: "trade_debit", direction: "debit", amount: notional.toFixed(8), currency, status: "completed", reference: `AFRIBROKER-${current.id}-DEBIT`, description: `Achat interne déclenché ${quantity}`, completedAt: new Date() });
      }
      await tx.update(orders).set({ status: "filled", filledQuantity: current.quantity, averagePrice: price.toFixed(8), providerReference: `AFRIBROKER-${current.id}`, executedAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, current.id));
      return true;
    });
    if (result) {
      filled += 1;
      await writeAuditLog({ action: "order.filled_internal_trigger", entityType: "order", entityId: String(order.id), metadata: { instrumentId, price, broker: "africoin_internal" } });
    }
  }
  return filled;
}
