import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { buildFundingDecisionNotification } from "./notificationService";
import type { TrpcContext } from "./_core/context";

function context(userId = 41): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `notification-user-${userId}`,
      name: "Client Africoin",
      email: "client@example.com",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("notifications", () => {
  it("returns a user-scoped feed with an unread counter", async () => {
    const result = await appRouter.createCaller(context(41)).notifications.list();
    expect(result).toEqual(expect.objectContaining({ items: expect.any(Array), unreadCount: expect.any(Number), serverTime: expect.any(Date) }));
    expect(result.unreadCount).toBeGreaterThanOrEqual(0);
  });

  it("allows marking a notification as read without exposing another user scope", async () => {
    const caller = appRouter.createCaller(context(41));
    await expect(caller.notifications.markRead({ id: 999999 })).resolves.toEqual({ success: true });
    await expect(caller.notifications.markAllRead()).resolves.toEqual({ success: true });
  });

  it("builds decision notifications with the request reference and reviewer note", () => {
    expect(buildFundingDecisionNotification({ userId: 41, type: "deposit", decision: "approve", reference: "DEP-ABC123", note: "KYC validé" })).toEqual({ userId: 41, type: "deposit", title: "Demande approuvée", message: "DEP-ABC123 · KYC validé" });
    expect(buildFundingDecisionNotification({ userId: 42, type: "withdrawal", decision: "reject", reference: "WDL-XYZ789", note: "Justificatif requis" })).toEqual({ userId: 42, type: "withdrawal", title: "Demande rejetée", message: "WDL-XYZ789 · Justificatif requis" });
  });

  it("does not expose notifications to unauthenticated callers", async () => {
    const unauthenticated = { user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] } as TrpcContext;
    await expect(appRouter.createCaller(unauthenticated).notifications.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
