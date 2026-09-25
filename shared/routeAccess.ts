export const publicRoutes = ["/", "/tarifs-risques-conditions", "/inscription", "/connexion"] as const;

export function isPublicRoute(pathname: string) {
  return publicRoutes.includes(pathname as (typeof publicRoutes)[number]);
}

export const protectedRoutes = [
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
] as const;

export function isProtectedRoute(pathname: string) {
  return protectedRoutes.includes(pathname as (typeof protectedRoutes)[number]);
}

export function resolveRouteSurface(location: string, loading: boolean) {
  if (location === "/tarifs-risques-conditions") return "reference" as const;
  if (location === "/inscription" || location === "/connexion") return "auth" as const;
  if (isPublicRoute(location)) return "landing" as const;
  if (loading) return "loading" as const;
  return "protected" as const;
}

export function resolveDashboardAccessSurface(loading: boolean, user: unknown) {
  if (loading) return "loading" as const;
  if (!user) return "login" as const;
  return "workspace" as const;
}
