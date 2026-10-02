import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerMarketStream } from "../marketStream";
import { registerKelpayCallbackRoute } from "../kelpay";
import { serveStatic } from "./static";
import { getHealthResponse } from "./health";
import { runDatabaseMigrations } from "../db";

async function startProductionServer() {
  const app = express();
  let databaseReady = false;
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  const server = createServer(app);
  app.use((req, res, next) => {
    if (req.path === "/api/health" || databaseReady) return next();
    return res.status(503).json({ status: "starting" });
  });
  registerMarketStream(server);
  registerKelpayCallbackRoute(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  app.get("/api/health", (_req, res) => {
    res.status(databaseReady ? 200 : 503).json(databaseReady ? getHealthResponse() : { status: "starting" });
  });
  app.all("/api/oauth/callback", (_req, res) =>
    res.status(404).json({ error: "OAuth authentication is disabled." }),
  );
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );
  serveStatic(app);

  const port = parseInt(process.env.PORT || "3000", 10);
  const host = process.env.HOST || "0.0.0.0";
  server.listen(port, host, () => {
    console.log(`Server running on ${host}:${port}`);
    void runDatabaseMigrations().then(() => {
      databaseReady = true;
    }).catch(error => {
      console.error("[Database] Startup migrations failed:", error);
      process.exit(1);
    });
  });
}

startProductionServer().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
