import { describe, expect, it } from "vitest";
import { getHealthResponse } from "./_core/health";

describe("health response", () => {
  it("returns the stable public health payload", () => {
    expect(getHealthResponse()).toEqual({ status: "ok" });
  });
});

