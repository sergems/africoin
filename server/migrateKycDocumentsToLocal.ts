import { asc, and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";
import { kycCases, kycDocuments } from "../drizzle/schema";
import {
  appendKycMigrationManifestEntry,
  deleteLocalKycDocument,
  isKycDocumentMimeType,
  isLocalKycDocumentKey,
  readKycMigrationManifest,
  saveLocalKycDocument,
} from "./kycDocumentStore";
import { downloadLegacyKycDocument } from "./legacyKycDocument";

const PAGE_SIZE = 100;
const LOCAL_KEY_PREFIX = "local-kyc-documents/";

type LegacyDocumentRow = {
  id: number;
  caseId: number;
  userId: number;
  storageKey: string;
  mimeType: string;
};

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: node dist/migrateKycDocumentsToLocal.js [--dry-run | --apply | --rollback]");
    console.log("Default is a read-only dry run. --apply copies legacy files and updates keys; --rollback restores keys from the private manifest. Neither operation deletes files.");
    return;
  }
  if (args.some(argument => !["--dry-run", "--apply", "--rollback"].includes(argument)) || args.filter(argument => ["--dry-run", "--apply", "--rollback"].includes(argument)).length > 1) {
    throw new Error("Use only one of --dry-run, --apply, or --rollback.");
  }

  const apply = args.includes("--apply");
  const rollback = args.includes("--rollback");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required; no files or database rows were changed.");

  const pool = createPool(databaseUrl);
  const db = drizzle(pool);
  try {
    const legacyRows: LegacyDocumentRow[] = [];
    let localCount = 0;
    let invalidLocalKeyCount = 0;
    let afterId = 0;

    while (true) {
      const page = await db.select({
        id: kycDocuments.id,
        caseId: kycCases.id,
        userId: kycCases.userId,
        storageKey: kycDocuments.storageKey,
        mimeType: kycDocuments.mimeType,
      })
        .from(kycDocuments)
        .innerJoin(kycCases, eq(kycDocuments.kycCaseId, kycCases.id))
        .where(gt(kycDocuments.id, afterId))
        .orderBy(asc(kycDocuments.id))
        .limit(PAGE_SIZE);

      if (page.length === 0) break;
      afterId = page[page.length - 1].id;
      for (const row of page) {
        if (isLocalKycDocumentKey(row.storageKey)) {
          localCount += 1;
        } else if (row.storageKey.startsWith("local-kyc-documents/")) {
          invalidLocalKeyCount += 1;
        } else {
          legacyRows.push(row);
        }
      }
    }

    console.log(`KYC storage preflight: ${localCount} already local; ${legacyRows.length} legacy references; ${invalidLocalKeyCount} invalid local keys.`);
    if (rollback) {
      if (invalidLocalKeyCount > 0) throw new Error("Invalid local KYC keys were found; no rollback was started.");
      const manifestEntries = await readKycMigrationManifest();
      const manifestByDocument = new Map<number, Array<(typeof manifestEntries)[number]>>();
      for (const entry of manifestEntries) {
        const entries = manifestByDocument.get(entry.documentId) ?? [];
        entries.push(entry);
        manifestByDocument.set(entry.documentId, entries);
      }
      const currentDocuments = await db.select({ id: kycDocuments.id, storageKey: kycDocuments.storageKey }).from(kycDocuments);
      const currentById = new Map(currentDocuments.map(row => [row.id, row.storageKey] as const));
      const unmappedLocalCount = currentDocuments.filter(row => row.storageKey.startsWith(LOCAL_KEY_PREFIX)
        && !(manifestByDocument.get(row.id) ?? []).some(entry => entry.localKey === row.storageKey)).length;
      if (unmappedLocalCount > 0) {
        throw new Error(`${unmappedLocalCount} locally uploaded KYC document(s) are not in the migration manifest; rollback was stopped to avoid making them unreadable in the previous app version.`);
      }

      let restored = 0;
      let skipped = 0;
      let failed = 0;
      for (const [documentId, entries] of Array.from(manifestByDocument.entries())) {
        const current = currentById.get(documentId);
        if (entries.some(entry => entry.originalKey === current)) {
          skipped += 1;
          continue;
        }
        const matchingEntry = entries.find(entry => entry.localKey === current);
        if (!matchingEntry) {
          failed += 1;
          console.error(`Could not restore KYC document record ${documentId}; its storage key has changed.`);
          continue;
        }
        const result = await db.update(kycDocuments)
          .set({ storageKey: matchingEntry.originalKey })
          .where(and(eq(kycDocuments.id, documentId), eq(kycDocuments.storageKey, matchingEntry.localKey)));
        const updateInfo = result[0] as { affectedRows?: number };
        if (updateInfo?.affectedRows === 1) restored += 1;
        else failed += 1;
      }
      console.log(`KYC pointer rollback complete: ${restored} references restored, ${skipped} already restored, ${failed} conflicts. Local files and legacy source objects were not deleted.`);
      if (failed > 0) process.exitCode = 1;
      return;
    }
    if (!apply) {
      console.log("Read-only dry run complete. Use --apply only after taking the database and file backups described in the deployment guide.");
      if (invalidLocalKeyCount > 0) process.exitCode = 1;
      return;
    }
    if (invalidLocalKeyCount > 0) throw new Error("Invalid local KYC keys were found; no migration was started.");
    if (legacyRows.length > 0 && (!process.env.BUILT_IN_FORGE_API_URL || !process.env.BUILT_IN_FORGE_API_KEY)) {
      throw new Error("Legacy KYC documents exist, but the previous storage credentials are not configured. No files or database rows were changed.");
    }

    let migrated = 0;
    let failed = 0;
    for (const row of legacyRows) {
      let newKey: string | undefined;
      try {
        if (!isKycDocumentMimeType(row.mimeType)) throw new Error("Unsupported recorded MIME type.");
        const bytes = await downloadLegacyKycDocument(row.storageKey, row.mimeType);
        const stored = await saveLocalKycDocument(row.userId, row.caseId, bytes, row.mimeType);
        newKey = stored.key;
        await appendKycMigrationManifestEntry({
          documentId: row.id,
          userId: row.userId,
          caseId: row.caseId,
          originalKey: row.storageKey,
          localKey: stored.key,
        });

        const result = await db.update(kycDocuments)
          .set({ storageKey: stored.key })
          .where(and(eq(kycDocuments.id, row.id), eq(kycDocuments.storageKey, row.storageKey)));
        const updateInfo = result[0] as { affectedRows?: number };
        if (updateInfo?.affectedRows !== 1) throw new Error("The database reference changed during migration.");
        migrated += 1;
        console.log(`Migrated KYC document record ${row.id}.`);
      } catch {
        failed += 1;
        if (newKey) {
          try {
            await deleteLocalKycDocument(newKey, row.userId, row.caseId);
          } catch {
            // Preserve the database pointer and report the record; an orphan file can be cleaned up after review.
          }
        }
        console.error(`Could not migrate KYC document record ${row.id}; its existing database reference was left unchanged.`);
      }
    }

    console.log(`KYC migration complete: ${migrated} copied and database references updated; ${failed} failed; ${localCount} already local. Legacy source objects were not deleted.`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("KYC local migration stopped. Check server configuration and logs; no credentials are printed by this tool.");
  process.exitCode = 1;
});
