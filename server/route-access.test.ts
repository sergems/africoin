import { describe, expect, it } from "vitest";
import { isProtectedRoute, isPublicRoute, protectedRoutes, resolveDashboardAccessSurface, resolveRouteSurface } from "@shared/routeAccess";

describe("public and protected route contract", () => {
  it("renders public surfaces without authentication", () => {
    expect(isPublicRoute("/")).toBe(true);
    expect(isPublicRoute("/tarifs-risques-conditions")).toBe(true);
    expect(resolveRouteSurface("/", false)).toBe("landing");
    expect(resolveRouteSurface("/", true)).toBe("landing");
    expect(resolveRouteSurface("/tarifs-risques-conditions", true)).toBe("reference");
  });

  it("renders loading before protected workspace access is resolved", () => {
    expect(resolveRouteSurface("/dashboard", true)).toBe("loading");
    expect(resolveRouteSurface("/market", true)).toBe("loading");
  });

  it("shows the login fallback before exposing a protected workspace", () => {
    expect(resolveDashboardAccessSurface(true, null)).toBe("loading");
    expect(resolveDashboardAccessSurface(false, null)).toBe("login");
    expect(resolveDashboardAccessSurface(false, { id: 41, role: "user" })).toBe("workspace");
  });

  it("keeps every platform workspace behind the authenticated shell", () => {
    expect(protectedRoutes).toEqual([
      "/dashboard",
      "/market",
      "/watchlist",
      "/wallets",
      "/activity",
      "/documents",
      "/settings",
      "/compliance",
      "/admin",
      "/admin/users",
      "/admin/markets",
      "/admin/permissions",
    ]);
    expect(protectedRoutes.every(isProtectedRoute)).toBe(true);
    expect(resolveRouteSurface("/dashboard", false)).toBe("protected");
    expect(resolveRouteSurface("/admin", false)).toBe("protected");
    expect(resolveRouteSurface("/admin/users", false)).toBe("protected");
    expect(resolveRouteSurface("/admin/permissions", false)).toBe("protected");
    expect(isPublicRoute("/admin")).toBe(false);
  });
});
