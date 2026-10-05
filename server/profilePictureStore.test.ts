import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteLocalProfilePicture,
  isLocalProfilePictureKey,
  localProfilePictureKeyForRequest,
  localProfilePictureUrl,
  readLocalProfilePicture,
  saveLocalProfilePicture,
} from "./profilePictureStore";

let temporaryDirectory = "";
let previousStorageDirectory: string | undefined;

beforeEach(async () => {
  previousStorageDirectory = process.env.PROFILE_PICTURE_STORAGE_DIR;
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "africoin-profile-pictures-"));
  process.env.PROFILE_PICTURE_STORAGE_DIR = temporaryDirectory;
});

afterEach(async () => {
  if (previousStorageDirectory === undefined) delete process.env.PROFILE_PICTURE_STORAGE_DIR;
  else process.env.PROFILE_PICTURE_STORAGE_DIR = previousStorageDirectory;
  await rm(temporaryDirectory, { recursive: true, force: true });
});

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);

describe("local profile-picture storage", () => {
  it("writes a private image file and reads it back for its owner", async () => {
    const stored = await saveLocalProfilePicture(42, jpeg, "image/jpeg");
    const picture = await readLocalProfilePicture(stored.key, 42);

    expect(stored.key).toMatch(/^local-profile-pictures\/42\/[0-9a-f-]+\.jpg$/);
    expect(stored.url).toBe(localProfilePictureUrl(stored.key));
    expect(picture).toEqual({ bytes: jpeg, mimeType: "image/jpeg" });

    const directoryInfo = await stat(path.join(temporaryDirectory, "42"));
    expect(directoryInfo.mode & 0o777).toBe(0o700);
    const fileInfo = await stat(path.join(temporaryDirectory, "42", stored.key.split("/").at(-1)!));
    expect(fileInfo.mode & 0o777).toBe(0o600);
  });

  it("rejects another user, malformed keys and path traversal", async () => {
    const stored = await saveLocalProfilePicture(42, jpeg, "image/jpeg");

    expect(await readLocalProfilePicture(stored.key, 7)).toBeNull();
    expect(isLocalProfilePictureKey("local-profile-pictures/42/../../etc/passwd")).toBe(false);
    expect(localProfilePictureKeyForRequest(42, "../secret.jpg")).toBeNull();
    expect(localProfilePictureKeyForRequest(42, "avatar.jpg")).toBeNull();
  });

  it("removes replaced images safely", async () => {
    const stored = await saveLocalProfilePicture(42, jpeg, "image/jpeg");

    expect(await deleteLocalProfilePicture(stored.key, 7)).toBe(false);
    expect(await deleteLocalProfilePicture(stored.key, 42)).toBe(true);
    expect(await readLocalProfilePicture(stored.key, 42)).toBeNull();
  });

  it("rejects bytes that do not match their declared image type", async () => {
    await expect(saveLocalProfilePicture(42, Buffer.from("not an image"), "image/jpeg")).rejects.toThrow(
      "Invalid profile-picture data.",
    );
  });
});
