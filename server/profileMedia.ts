export const MAX_PROFILE_PICTURE_BYTES = 5 * 1024 * 1024;

export type ProfilePictureMimeType = "image/jpeg" | "image/png";

export function isValidProfilePicture(mimeType: ProfilePictureMimeType, bytes: Uint8Array) {
  if (bytes.length === 0 || bytes.length > MAX_PROFILE_PICTURE_BYTES) return false;
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}
