import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerMarketStream } from "../marketStream";
import { serveStatic } from "./static";
import { getHealthResponse } from "./health";

async function startProductionServer() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  const server = createServer(app);
  registerMarketStream(server);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  app.get("/api/health", (_req, res) => {
    res.status(200).json(getHealthResponse());
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
  });
}

startProductionServer().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
