import { parse as parseCookieHeader } from "cookie";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import { COOKIE_NAME } from "@shared/const";
import { kycCases, kycDocuments } from "../../drizzle/schema";
import { getDb, getUserByOpenId } from "../db";
import { canReadKycDocument, isLocalKycDocumentKey, readLocalKycDocument } from "../kycDocumentStore";
import { downloadLegacyKycDocument } from "../legacyKycDocument";
import { sdk } from "./sdk";

function setPrivateDocumentHeaders(res: import("express").Response, mimeType: string) {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "pdf";
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `inline; filename="kyc-document.${extension}"`);
  res.type(mimeType);
}

export function registerKycDocumentRoute(app: Express) {
  app.get("/api/kyc-documents/:documentId", async (req, res) => {
    try {
      const cookies = parseCookieHeader(req.headers.cookie ?? "");
      const session = await sdk.verifySession(cookies[COOKIE_NAME]);
      if (!session) {
        res.status(401).end();
        return;
      }

      const user = await getUserByOpenId(session.openId);
      if (!user) {
        res.status(401).end();
        return;
      }

      const documentId = Number(req.params.documentId);
      if (!Number.isSafeInteger(documentId) || documentId <= 0) {
        res.status(404).end();
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(503).end();
        return;
      }

      const document = (await db.select({
        id: kycDocuments.id,
        caseId: kycCases.id,
        ownerUserId: kycCases.userId,
        storageKey: kycDocuments.storageKey,
        mimeType: kycDocuments.mimeType,
      })
        .from(kycDocuments)
        .innerJoin(kycCases, eq(kycDocuments.kycCaseId, kycCases.id))
        .where(eq(kycDocuments.id, documentId))
        .limit(1))[0];

      if (!document || !canReadKycDocument(user, document.ownerUserId)) {
        res.status(404).end();
        return;
      }

      if (document.storageKey.startsWith("local-kyc-documents/")) {
        if (!isLocalKycDocumentKey(document.storageKey)) {
          res.status(404).end();
          return;
        }
        const localFile = await readLocalKycDocument(document.storageKey, document.ownerUserId, document.caseId);
        if (!localFile || localFile.mimeType !== document.mimeType) {
          res.status(404).end();
          return;
        }
        setPrivateDocumentHeaders(res, localFile.mimeType);
        res.status(200).send(localFile.bytes);
        return;
      }

      // Temporary compatibility for documents uploaded before the Linode-local migration.
      const legacyBytes = await downloadLegacyKycDocument(document.storageKey, document.mimeType);
      setPrivateDocumentHeaders(res, document.mimeType);
      res.status(200).send(legacyBytes);
    } catch {
      console.error("[KycDocument] Failed to serve a private KYC document; details are withheld to protect storage metadata.");
      if (!res.headersSent) res.status(404).end();
    }
  });
}
