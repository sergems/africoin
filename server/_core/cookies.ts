import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLocalHostname(hostname: string | undefined) {
  const host = (hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (LOCAL_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;

  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [first, second] = octets;
  return first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second !== undefined && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function forwardedProtocols(req: Request) {
  const value = req.headers["x-forwarded-proto"];
  const values = Array.isArray(value) ? value : value ? value.split(",") : [];
  return values.map(protocol => protocol.trim().toLowerCase());
}

function requestHostname(req: Request) {
  if (req.hostname) return req.hostname;
  const hostHeader = req.headers.host;
  if (!hostHeader) return undefined;
  if (hostHeader.startsWith("[")) return hostHeader.slice(1, hostHeader.indexOf("]"));
  return hostHeader.split(":")[0];
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https" || forwardedProtocols(req).includes("https")) return true;

  const origin = req.headers.origin;
  if (typeof origin === "string") {
    try {
      const originUrl = new URL(origin);
      if (originUrl.protocol === "https:") return true;
      if (originUrl.protocol === "http:") return !isLocalHostname(originUrl.hostname);
    } catch {
      // Ignore an invalid Origin and fall back to the request's local/proxy metadata.
    }
  }

  // Preview may terminate public HTTPS before forwarding the request to an HTTP listener.
  // Treat non-local hosts as HTTPS by default; only explicit local development stays HTTP.
  return !isLocalHostname(requestHostname(req));
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const secure = isSecureRequest(req);
  return {
    httpOnly: true,
    path: "/",
    sameSite: secure ? "none" : "lax",
    secure,
  };
}
