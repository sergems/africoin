import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isValidProfilePicture } from "./profileMedia";

const KEY_PREFIX = "local-profile-pictures";
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const KEY_PATTERN = new RegExp(`^${KEY_PREFIX}/([1-9][0-9]*)/(${UUID_PATTERN})\\.(jpg|png)$`);

export type ProfilePictureMimeType = "image/jpeg" | "image/png";

export type StoredProfilePicture = {
  key: string;
  url: string;
  mimeType: ProfilePictureMimeType;
};

export type ProfilePictureFile = {
  bytes: Buffer;
  mimeType: ProfilePictureMimeType;
};

type ParsedKey = {
  userId: number;
  fileName: string;
  mimeType: ProfilePictureMimeType;
};

function storageDirectory() {
  const configuredDirectory = process.env.PROFILE_PICTURE_STORAGE_DIR?.trim();
  return path.resolve(configuredDirectory || path.join(process.cwd(), ".local-storage", "profile-pictures"));
}

function parseKey(key: string): ParsedKey | null {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;

  const userId = Number(match[1]);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;

  const extension = match[3];
  return {
    userId,
    fileName: `${match[2]}.${extension}`,
    mimeType: extension === "jpg" ? "image/jpeg" : "image/png",
  };
}

function filePath(key: string, userId: number) {
  const parsed = parseKey(key);
  if (!parsed || parsed.userId !== userId) return null;
  return { parsed, path: path.join(storageDirectory(), String(parsed.userId), parsed.fileName) };
}

export function isLocalProfilePictureKey(key: string): boolean {
  return parseKey(key) !== null;
}

export function localProfilePictureKeyForRequest(userId: number, fileName: string): string | null {
  if (!Number.isSafeInteger(userId) || userId <= 0 || fileName.includes("/")) return null;
  const key = `${KEY_PREFIX}/${userId}/${fileName}`;
  return parseKey(key) ? key : null;
}

export function localProfilePictureUrl(key: string): string | null {
  const parsed = parseKey(key);
  if (!parsed) return null;
  return `/api/profile-pictures/${parsed.userId}/${encodeURIComponent(parsed.fileName)}`;
}

export async function saveLocalProfilePicture(
  userId: number,
  bytes: Buffer,
  mimeType: ProfilePictureMimeType,
): Promise<StoredProfilePicture> {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid profile-picture owner.");
  if (!isValidProfilePicture(mimeType, bytes)) throw new Error("Invalid profile-picture data.");

  const extension = mimeType === "image/jpeg" ? "jpg" : "png";
  const fileName = `${randomUUID()}.${extension}`;
  const key = `${KEY_PREFIX}/${userId}/${fileName}`;
  const parsed = parseKey(key);
  if (!parsed) throw new Error("Could not create a valid profile-picture key.");

  const directory = path.join(storageDirectory(), String(userId));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, fileName), bytes, { flag: "wx", mode: 0o600 });

  const url = localProfilePictureUrl(key);
  if (!url) throw new Error("Could not create a profile-picture URL.");
  return { key, url, mimeType };
}

export async function readLocalProfilePicture(key: string, userId: number): Promise<ProfilePictureFile | null> {
  const resolved = filePath(key, userId);
  if (!resolved) return null;

  try {
    const bytes = await readFile(resolved.path);
    if (!isValidProfilePicture(resolved.parsed.mimeType, bytes)) return null;
    return { bytes, mimeType: resolved.parsed.mimeType };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteLocalProfilePicture(key: string, userId: number): Promise<boolean> {
  const resolved = filePath(key, userId);
  if (!resolved) return false;

  try {
    await unlink(resolved.path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
