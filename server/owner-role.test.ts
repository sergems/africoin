import { describe, expect, it } from "vitest";
import { resolveUpsertRole } from "./db";

describe("owner role invariant", () => {
  it("always resolves the configured owner to super_admin", () => {
    expect(resolveUpsertRole("owner-1", "user", "owner-1")).toBe("super_admin");
    expect(resolveUpsertRole("owner-1", "admin", "owner-1")).toBe("super_admin");
    expect(resolveUpsertRole("client-1", "admin", "owner-1")).toBe("admin");
    expect(resolveUpsertRole("client-1", undefined, "owner-1")).toBeUndefined();
  });
});
