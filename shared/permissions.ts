export type PlatformRole = "user" | "compliance" | "admin" | "super_admin";

export type Permission =
  | "funding.review"
  | "kyc.review"
  | "compliance.alerts"
  | "limits.manage"
  | "user.status"
  | "user.role"
  | "approvals.read"
  | "approvals.decide"
  | "audit.read"
  | "system.manage";

export const permissionMatrix: Record<PlatformRole, readonly Permission[]> = {
  user: [],
  compliance: ["kyc.review", "compliance.alerts", "limits.manage", "approvals.read", "approvals.decide", "audit.read"],
  admin: ["funding.review", "user.status", "approvals.read", "approvals.decide", "audit.read"],
  super_admin: ["funding.review", "kyc.review", "compliance.alerts", "limits.manage", "user.status", "user.role", "approvals.read", "approvals.decide", "audit.read", "system.manage"],
};

export function hasPermission(role: PlatformRole, permission: Permission) {
  return permissionMatrix[role].includes(permission);
}

export function roleLabel(role: PlatformRole) {
  return { user: "Client", compliance: "Conformité", admin: "Admin", super_admin: "Super Admin" }[role];
}

export function roleScope(role: PlatformRole) {
  return {
    user: "Portail personnel",
    compliance: "KYC, alertes, limites et audit",
    admin: "Financement, comptes et audit",
    super_admin: "Contrôle complet et gestion des rôles",
  }[role];
}
