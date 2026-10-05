import { parse as parseCookieHeader } from "cookie";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import { COOKIE_NAME } from "@shared/const";
import { clientProfiles } from "../../drizzle/schema";
import { getDb, getUserByOpenId } from "../db";
import { localProfilePictureKeyForRequest, readLocalProfilePicture } from "../profilePictureStore";
import { sdk } from "./sdk";

export function registerProfilePictureRoute(app: Express) {
  app.get("/api/profile-pictures/:userId/:fileName", async (req, res) => {
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

      const requestedUserId = Number(req.params.userId);
      if (!Number.isSafeInteger(requestedUserId) || requestedUserId !== user.id) {
        res.status(404).end();
        return;
      }

      const key = localProfilePictureKeyForRequest(requestedUserId, req.params.fileName);
      if (!key) {
        res.status(404).end();
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(503).end();
        return;
      }

      const rows = await db
        .select({ avatarStorageKey: clientProfiles.avatarStorageKey })
        .from(clientProfiles)
        .where(eq(clientProfiles.userId, user.id))
        .limit(1);
      if (rows[0]?.avatarStorageKey !== key) {
        res.status(404).end();
        return;
      }

      const picture = await readLocalProfilePicture(key, user.id);
      if (!picture) {
        res.status(404).end();
        return;
      }

      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(200).type(picture.mimeType).send(picture.bytes);
    } catch (error) {
      console.error("[ProfilePicture] Failed to serve local profile picture:", error);
      if (!res.headersSent) res.status(500).end();
    }
  });
}
