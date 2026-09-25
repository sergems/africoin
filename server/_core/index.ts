import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { registerMarketStream } from "../marketStream";
import { getHealthResponse } from "./health";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  const server = createServer(app);
  registerMarketStream(server);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  app.get("/api/health", (_req, res) => {
    res.status(200).json(getHealthResponse());
  });
  app.all("/api/oauth/callback", (_req, res) => res.status(404).json({ error: "OAuth authentication is disabled." }));
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000", 10);
  const isDevelopment = process.env.NODE_ENV === "development";
  const port = isDevelopment ? await findAvailablePort(preferredPort) : preferredPort;
  const host = process.env.HOST || "0.0.0.0";

  if (isDevelopment && port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, host, () => {
    console.log(`Server running on ${host}:${port}`);
  });
}

startServer().catch(console.error);
