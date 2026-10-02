import { promisify } from "node:util";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function createVerificationToken() {
  return randomBytes(32).toString("hex");
}

export function hashVerificationToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, keyHex] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
