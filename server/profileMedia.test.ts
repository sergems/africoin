import { describe, expect, it } from "vitest";
import { isValidProfilePicture, MAX_PROFILE_PICTURE_BYTES } from "./profileMedia";

describe("profile-picture validation", () => {
  it("accepts matching JPEG and PNG signatures", () => {
    expect(isValidProfilePicture("image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe(true);
    expect(isValidProfilePicture("image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  });

  it("rejects mismatched signatures and empty uploads", () => {
    expect(isValidProfilePicture("image/jpeg", Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isValidProfilePicture("image/png", new Uint8Array())).toBe(false);
  });

  it("rejects uploads larger than five MiB", () => {
    expect(isValidProfilePicture("image/png", new Uint8Array(MAX_PROFILE_PICTURE_BYTES + 1))).toBe(false);
  });
});
