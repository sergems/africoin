import type { Express } from "express";

export function registerOAuthRoutes(app: Express) {
  app.all("/api/oauth/callback", (_req, res) => {
    res.status(501).json({ error: "OAuth authentication is disabled. Use local email authentication." });
  });
}
