import { storageGetSignedUrl } from "./storage";
import {
  detectKycDocumentMimeType,
  isKycDocumentMimeType,
  MAX_KYC_DOCUMENT_BYTES,
  type KycDocumentMimeType,
} from "./kycDocumentStore";

async function readBodyWithinLimit(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_KYC_DOCUMENT_BYTES) {
    throw new Error("Legacy KYC document exceeds the maximum supported size.");
  }
  if (!response.body) throw new Error("Legacy KYC document has no response body.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_KYC_DOCUMENT_BYTES) {
        await reader.cancel();
        throw new Error("Legacy KYC document exceeds the maximum supported size.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size);
}

export async function downloadLegacyKycDocument(key: string, expectedMimeType: string): Promise<Buffer> {
  if (!isKycDocumentMimeType(expectedMimeType)) throw new Error("Legacy KYC document has an unsupported recorded type.");

  const signedUrl = await storageGetSignedUrl(key);
  const response = await fetch(signedUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("Legacy KYC document could not be fetched from its previous storage service.");

  const bytes = await readBodyWithinLimit(response);
  const detectedMimeType: KycDocumentMimeType | null = detectKycDocumentMimeType(bytes);
  if (!detectedMimeType || detectedMimeType !== expectedMimeType) {
    throw new Error("Legacy KYC document contents do not match the recorded MIME type.");
  }
  return bytes;
}
