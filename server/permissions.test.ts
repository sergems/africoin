import { describe, expect, it } from "vitest";
import { hasPermission, permissionMatrix, roleLabel, roleScope } from "@shared/permissions";

describe("permission matrix", () => {
  it("keeps operational, compliance, and role-management scopes distinct", () => {
    expect(hasPermission("admin", "funding.review")).toBe(true);
    expect(hasPermission("admin", "user.status")).toBe(true);
    expect(hasPermission("admin", "kyc.review")).toBe(false);
    expect(hasPermission("admin", "user.role")).toBe(false);
    expect(hasPermission("compliance", "kyc.review")).toBe(true);
    expect(hasPermission("compliance", "limits.manage")).toBe(true);
    expect(hasPermission("compliance", "funding.review")).toBe(false);
    expect(hasPermission("super_admin", "system.manage")).toBe(true);
    expect(permissionMatrix.super_admin).toHaveLength(10);
  });

  it("exposes clear French labels and scopes", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("super_admin")).toBe("Super Admin");
    expect(roleLabel("compliance")).toBe("Conformité");
    expect(roleScope("compliance")).toContain("KYC");
    expect(roleScope("super_admin")).toContain("gestion des rôles");
  });
});
