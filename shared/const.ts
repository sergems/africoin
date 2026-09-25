export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
export const OAUTH_STATE_COOKIE = "__Host-oauth_state";

type OAuthState = {
  redirectUri: string;
  nonce: string;
};

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeOAuthState(state: OAuthState) {
  return toBase64Url(JSON.stringify(state));
}

export function decodeOAuthState(value: string): OAuthState {
  const parsed = JSON.parse(fromBase64Url(value)) as Partial<OAuthState>;
  if (typeof parsed.redirectUri !== "string" || typeof parsed.nonce !== "string") {
    throw new Error("Invalid OAuth state");
  }
  return { redirectUri: parsed.redirectUri, nonce: parsed.nonce };
}
