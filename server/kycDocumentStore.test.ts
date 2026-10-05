import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendKycMigrationManifestEntry,
  canReadKycDocument,
  deleteLocalKycDocument,
  detectKycDocumentMimeType,
  isLocalKycDocumentKey,
  MAX_KYC_DOCUMENT_BYTES,
  readLocalKycDocument,
  readKycMigrationManifest,
  saveLocalKycDocument,
} from "./kycDocumentStore";

const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const pdfBytes = Buffer.from("%PDF-1.7\n") ;
let directory = "";
let originalDirectory: string | undefined;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "africoin-kyc-store-"));
  originalDirectory = process.env.KYC_DOCUMENT_STORAGE_DIR;
  process.env.KYC_DOCUMENT_STORAGE_DIR = directory;
});

afterEach(async () => {
  if (originalDirectory === undefined) delete process.env.KYC_DOCUMENT_STORAGE_DIR;
  else process.env.KYC_DOCUMENT_STORAGE_DIR = originalDirectory;
  await rm(directory, { recursive: true, force: true });
});

describe("local KYC document storage", () => {
  it("recognizes only matching JPEG, PNG and PDF signatures", () => {
    expect(detectKycDocumentMimeType(jpegBytes)).toBe("image/jpeg");
    expect(detectKycDocumentMimeType(pngBytes)).toBe("image/png");
    expect(detectKycDocumentMimeType(pdfBytes)).toBe("application/pdf");
    expect(detectKycDocumentMimeType(Buffer.from("not a document"))).toBeNull();
  });

  it("stores files with opaque per-user/case keys and restrictive permissions", async () => {
    const saved = await saveLocalKycDocument(42, 7, pdfBytes, "application/pdf");
    expect(saved.key).toMatch(/^local-kyc-documents\/42\/7\/[0-9a-f-]+\.pdf$/);
    expect(isLocalKycDocumentKey(saved.key)).toBe(true);

    const result = await readLocalKycDocument(saved.key, 42, 7);
    expect(result).toEqual({ bytes: pdfBytes, mimeType: "application/pdf" });

    const userDirectory = path.join(directory, "42");
    const caseDirectory = path.join(userDirectory, "7");
    const filePath = path.join(caseDirectory, path.basename(saved.key));
    expect((await stat(userDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(caseDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("rejects mismatched MIME signatures, oversized data and traversal keys", async () => {
    await expect(saveLocalKycDocument(42, 7, pdfBytes, "image/png")).rejects.toThrow("Invalid KYC document data");
    await expect(saveLocalKycDocument(42, 7, Buffer.concat([pdfBytes, Buffer.alloc(MAX_KYC_DOCUMENT_BYTES)]), "application/pdf")).rejects.toThrow("Invalid KYC document data");
    expect(isLocalKycDocumentKey("local-kyc-documents/42/7/../../secret.pdf")).toBe(false);
    await expect(readLocalKycDocument("local-kyc-documents/42/7/../../secret.pdf", 42, 7)).resolves.toBeNull();
  });

  it("binds reads to the stored owner and case and supports safe cleanup", async () => {
    const saved = await saveLocalKycDocument(42, 7, jpegBytes, "image/jpeg");
    await expect(readLocalKycDocument(saved.key, 99, 7)).resolves.toBeNull();
    await expect(readLocalKycDocument(saved.key, 42, 8)).resolves.toBeNull();
    await expect(deleteLocalKycDocument(saved.key, 99, 7)).resolves.toBe(false);
    await expect(deleteLocalKycDocument(saved.key, 42, 7)).resolves.toBe(true);
    await expect(readLocalKycDocument(saved.key, 42, 7)).resolves.toBeNull();
  });

  it("records rollback metadata in a private manifest", async () => {
    const saved = await saveLocalKycDocument(42, 7, pdfBytes, "application/pdf");
    const entry = { documentId: 101, userId: 42, caseId: 7, originalKey: "private-kyc/42/old.pdf", localKey: saved.key };
    await appendKycMigrationManifestEntry(entry);
    await expect(readKycMigrationManifest()).resolves.toEqual([entry]);
    expect((await stat(path.join(directory, "migration-manifest.jsonl"))).mode & 0o777).toBe(0o600);
  });
});

describe("KYC document read authorization", () => {
  it("allows the document owner, compliance and Super Admin, but not unrelated users or Admin", () => {
    expect(canReadKycDocument({ id: 4, role: "user" }, 4)).toBe(true);
    expect(canReadKycDocument({ id: 5, role: "user" }, 4)).toBe(false);
    expect(canReadKycDocument({ id: 5, role: "compliance" }, 4)).toBe(true);
    expect(canReadKycDocument({ id: 5, role: "super_admin" }, 4)).toBe(true);
    expect(canReadKycDocument({ id: 5, role: "admin" }, 4)).toBe(false);
  });
});
