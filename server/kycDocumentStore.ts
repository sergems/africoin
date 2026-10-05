import { randomUUID } from "node:crypto";
import { appendFile, chmod, lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasPermission, type PlatformRole } from "@shared/permissions";

export const MAX_KYC_DOCUMENT_BYTES = 10 * 1024 * 1024;
const KEY_PREFIX = "local-kyc-documents";
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const KEY_PATTERN = new RegExp(`^${KEY_PREFIX}/([1-9][0-9]*)/([1-9][0-9]*)/(${UUID_PATTERN})[.](jpg|png|pdf)$`);
const PDF_MAGIC = Buffer.from("%PDF-");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type KycDocumentMimeType = "image/jpeg" | "image/png" | "application/pdf";

export type StoredKycDocument = {
  key: string;
  mimeType: KycDocumentMimeType;
};

export type KycDocumentFile = {
  bytes: Buffer;
  mimeType: KycDocumentMimeType;
};

export type KycMigrationManifestEntry = {
  documentId: number;
  userId: number;
  caseId: number;
  originalKey: string;
  localKey: string;
};

type ParsedKey = {
  userId: number;
  caseId: number;
  fileName: string;
  mimeType: KycDocumentMimeType;
};

function storageDirectory() {
  const configuredDirectory = process.env.KYC_DOCUMENT_STORAGE_DIR?.trim();
  return path.resolve(configuredDirectory || path.join(process.cwd(), ".local-storage", "kyc-documents"));
}

export function isKycDocumentMimeType(value: string): value is KycDocumentMimeType {
  return value === "image/jpeg" || value === "image/png" || value === "application/pdf";
}

export function detectKycDocumentMimeType(bytes: Buffer): KycDocumentMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= PNG_MAGIC.length && bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return "image/png";
  if (bytes.length >= PDF_MAGIC.length && bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return "application/pdf";
  return null;
}

function parseKey(key: string): ParsedKey | null {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;

  const userId = Number(match[1]);
  const caseId = Number(match[2]);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(caseId) || caseId <= 0) return null;

  const extension = match[4];
  const mimeType: KycDocumentMimeType = extension === "jpg"
    ? "image/jpeg"
    : extension === "png"
      ? "image/png"
      : "application/pdf";
  return { userId, caseId, fileName: `${match[3]}.${extension}`, mimeType };
}

function filePath(key: string, userId: number, caseId: number) {
  const parsed = parseKey(key);
  if (!parsed || parsed.userId !== userId || parsed.caseId !== caseId) return null;
  return { parsed, path: path.join(storageDirectory(), String(parsed.userId), String(parsed.caseId), parsed.fileName) };
}

export function isLocalKycDocumentKey(key: string): boolean {
  return parseKey(key) !== null;
}

export function kycDocumentUrl(documentId: number): string | null {
  if (!Number.isSafeInteger(documentId) || documentId <= 0) return null;
  return `/api/kyc-documents/${documentId}`;
}

export function canReadKycDocument(viewer: { id: number; role: PlatformRole }, ownerUserId: number): boolean {
  return viewer.id === ownerUserId || hasPermission(viewer.role, "kyc.review");
}

export async function saveLocalKycDocument(
  userId: number,
  caseId: number,
  bytes: Buffer,
  mimeType: KycDocumentMimeType,
): Promise<StoredKycDocument> {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(caseId) || caseId <= 0) {
    throw new Error("Invalid KYC document owner or case.");
  }
  if (bytes.length === 0 || bytes.length > MAX_KYC_DOCUMENT_BYTES || detectKycDocumentMimeType(bytes) !== mimeType) {
    throw new Error("Invalid KYC document data.");
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "pdf";
  const fileName = `${randomUUID()}.${extension}`;
  const key = `${KEY_PREFIX}/${userId}/${caseId}/${fileName}`;
  if (!parseKey(key)) throw new Error("Could not create a valid KYC document key.");

  const directory = path.join(storageDirectory(), String(userId), String(caseId));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, fileName), bytes, { flag: "wx", mode: 0o600 });
  return { key, mimeType };
}

export async function readLocalKycDocument(key: string, userId: number, caseId: number): Promise<KycDocumentFile | null> {
  const resolved = filePath(key, userId, caseId);
  if (!resolved) return null;

  try {
    const metadata = await lstat(resolved.path);
    if (!metadata.isFile() || metadata.size > MAX_KYC_DOCUMENT_BYTES) return null;
    const bytes = await readFile(resolved.path);
    if (bytes.length > MAX_KYC_DOCUMENT_BYTES || detectKycDocumentMimeType(bytes) !== resolved.parsed.mimeType) return null;
    return { bytes, mimeType: resolved.parsed.mimeType };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteLocalKycDocument(key: string, userId: number, caseId: number): Promise<boolean> {
  const resolved = filePath(key, userId, caseId);
  if (!resolved) return false;

  try {
    await unlink(resolved.path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

const migrationManifestPath = () => path.join(storageDirectory(), "migration-manifest.jsonl");

function isManifestEntry(value: unknown): value is KycMigrationManifestEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<KycMigrationManifestEntry>;
  return Number.isSafeInteger(entry.documentId) && Number(entry.documentId) > 0
    && Number.isSafeInteger(entry.userId) && Number(entry.userId) > 0
    && Number.isSafeInteger(entry.caseId) && Number(entry.caseId) > 0
    && typeof entry.originalKey === "string" && entry.originalKey.length > 0
    && typeof entry.localKey === "string"
    && parseKey(entry.localKey)?.userId === entry.userId
    && parseKey(entry.localKey)?.caseId === entry.caseId;
}

export async function appendKycMigrationManifestEntry(entry: KycMigrationManifestEntry): Promise<void> {
  if (!isManifestEntry(entry) || isLocalKycDocumentKey(entry.originalKey)) {
    throw new Error("Invalid KYC migration manifest entry.");
  }
  const directory = storageDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const manifestPath = migrationManifestPath();
  await appendFile(manifestPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(manifestPath, 0o600);
}

export async function readKycMigrationManifest(): Promise<KycMigrationManifestEntry[]> {
  let contents: string;
  try {
    contents = await readFile(migrationManifestPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return contents.split(/\r?\n/).filter(Boolean).map(line => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error("KYC migration manifest is malformed; no rollback was performed.");
    }
    if (!isManifestEntry(parsed)) throw new Error("KYC migration manifest contains an invalid entry; no rollback was performed.");
    return parsed;
  });
}
