import { describe, expect, it } from "vitest";
import { COOKIE_NAME } from "../../shared/const";
import { getSessionCookieOptions } from "./cookies";
import type { Request } from "express";

function mockRequest(input: {
  protocol: string;
  hostname?: string;
  host?: string;
  origin?: string;
  forwardedProto?: string;
}): Request {
  return {
    protocol: input.protocol,
    hostname: input.hostname,
    headers: {
      host: input.host,
      origin: input.origin,
      "x-forwarded-proto": input.forwardedProto,
    },
  } as unknown as Request;
}

describe("session cookie compatibility", () => {
  it("uses an application-owned cookie name, not the platform-reserved name", () => {
    expect(COOKIE_NAME).toBe("africoin_user_session");
    expect(COOKIE_NAME).not.toBe("app_session_id");
  });

  it("sets SameSite=None and Secure for public HTTPS Preview behind an HTTP listener", () => {
    const options = getSessionCookieOptions(mockRequest({
      protocol: "http",
      hostname: "127.0.0.1",
      origin: "https://preview-africoin.example.manus.computer",
    }));

    expect(options).toMatchObject({ sameSite: "none", secure: true, httpOnly: true, path: "/" });
  });

  it("preserves secure cookies when the proxy forwards HTTPS metadata", () => {
    const options = getSessionCookieOptions(mockRequest({
      protocol: "http",
      hostname: "127.0.0.1",
      forwardedProto: "http, https",
    }));

    expect(options).toMatchObject({ sameSite: "none", secure: true });
  });

  it("keeps plain-HTTP localhost login compatible with browsers", () => {
    const options = getSessionCookieOptions(mockRequest({
      protocol: "http",
      hostname: "localhost",
      origin: "http://localhost:3000",
    }));

    expect(options).toMatchObject({ sameSite: "lax", secure: false, httpOnly: true, path: "/" });
  });

  it("defaults non-local deployments to Secure even without proxy scheme headers", () => {
    const options = getSessionCookieOptions(mockRequest({ protocol: "http", hostname: "app.africoin.example" }));
    expect(options).toMatchObject({ sameSite: "none", secure: true });
  });
});
