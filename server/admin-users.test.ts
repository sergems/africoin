import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { buildUserAdminAudit, canChangeUserRole, canChangeUserStatus } from "./adminUsers";

function context(role: "user" | "compliance" | "admin" | "super_admin" = "user"): TrpcContext {
  return { user: { id: 900001, openId: `admin-users-${role}`, name: "Admin Users Test", email: "admin-users@example.com", loginMethod: "test", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => undefined } as TrpcContext["res"] };
}

describe("admin user management", () => {
  it("rejects non-admin access to the user listing", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.adminUsers.list({ search: "", role: "all", status: "all", page: 1, pageSize: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("prevents self role changes and self restriction", () => {
    expect(canChangeUserRole(1, 1, "admin", "user")).toBe(false);
    expect(canChangeUserRole(1, 2, "user", "admin")).toBe(true);
    expect(canChangeUserStatus(1, 1, "blocked")).toBe(false);
    expect(canChangeUserStatus(1, 1, "active")).toBe(true);
    expect(canChangeUserStatus(1, 2, "blocked")).toBe(true);
  });

  it("builds an append-only audit payload with reason and before/after values", () => {
    expect(buildUserAdminAudit("admin.user_status_updated", 42, "Risque confirmé", "active", "restricted")).toMatchObject({ action: "admin.user_status_updated", entityType: "user", entityId: "42", severity: "warning", metadata: { reason: "Risque confirmé", previousValue: "active", nextValue: "restricted" } });
  });

  it("keeps the admin list contract typed with safe pagination inputs", async () => {
    const caller = appRouter.createCaller(context("admin"));
    const result = await caller.adminUsers.list({ search: "", role: "all", status: "all", page: 1, pageSize: 20 });
    expect(result).toMatchObject({ page: 1, pageSize: 20 });
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("protects detail and mutations from non-admin callers", async () => {
    const caller = appRouter.createCaller(context("compliance"));
    await expect(caller.adminUsers.detail({ userId: 999999999 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.adminUsers.updateStatus({ userId: 999999999, status: "blocked", reason: "Risque confirmé" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.adminUsers.updateRole({ userId: 999999999, role: "user", reason: "Correction de rôle" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps role assignment reserved for Super Admin", async () => {
    const adminCaller = appRouter.createCaller(context("admin"));
    const superAdminCaller = appRouter.createCaller(context("super_admin"));
    await expect(adminCaller.adminUsers.updateRole({ userId: 999999999, role: "compliance", reason: "Attribution contrôlée" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(superAdminCaller.adminUsers.updateRole({ userId: 999999999, role: "compliance", reason: "Attribution contrôlée" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps account editing, deletion, and wallet adjustments reserved for Super Admin", async () => {
    const adminCaller = appRouter.createCaller(context("admin"));
    const superAdminCaller = appRouter.createCaller(context("super_admin"));
    await expect(adminCaller.adminUsers.updateAccount({ userId: 999999999, name: "Compte", email: "compte@example.com", reason: "Correction contrôlée" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(adminCaller.adminUsers.deleteAccount({ userId: 999999999, reason: "Suppression contrôlée" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(adminCaller.adminUsers.adjustWallet({ userId: 999999999, currency: "USD", direction: "credit", amount: 10, reason: "Crédit contrôlé" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(superAdminCaller.adminUsers.updateAccount({ userId: 999999999, name: "Compte", email: "compte@example.com", reason: "Correction contrôlée" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(superAdminCaller.adminUsers.deleteAccount({ userId: 999999999, reason: "Suppression contrôlée" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(superAdminCaller.adminUsers.adjustWallet({ userId: 999999999, currency: "USD", direction: "credit", amount: 10, reason: "Crédit contrôlé" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns a safe not-found result for an admin detail and rejects unknown mutations", async () => {
    const caller = appRouter.createCaller(context("admin"));
    await expect(caller.adminUsers.detail({ userId: 999999999 })).resolves.toBeNull();
    await expect(caller.adminUsers.updateStatus({ userId: 999999999, status: "blocked", reason: "Risque confirmé" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.adminUsers.updateRole({ userId: 999999999, role: "user", reason: "Correction de rôle" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects procedure-level self-protection attempts before persistence", async () => {
    const caller = appRouter.createCaller(context("admin"));
    await expect(caller.adminUsers.updateStatus({ userId: 900001, status: "blocked", reason: "Auto blocage interdit" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.adminUsers.updateRole({ userId: 900001, role: "user", reason: "Auto changement interdit" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
