# syntax=docker/dockerfile:1.7

# Install dependencies once so the build and runtime stages use the lockfile exactly.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

# Build the Vite client and bundled Express/tRPC server.
FROM deps AS build
WORKDIR /app
COPY . .
ARG VITE_FRONTEND_FORGE_API_URL=
ARG VITE_FRONTEND_FORGE_API_KEY=
ARG VITE_ANALYTICS_ENDPOINT=
ARG VITE_ANALYTICS_WEBSITE_ID=
ENV VITE_FRONTEND_FORGE_API_URL=$VITE_FRONTEND_FORGE_API_URL \
    VITE_FRONTEND_FORGE_API_KEY=$VITE_FRONTEND_FORGE_API_KEY \
    VITE_ANALYTICS_ENDPOINT=$VITE_ANALYTICS_ENDPOINT \
    VITE_ANALYTICS_WEBSITE_ID=$VITE_ANALYTICS_WEBSITE_ID
RUN pnpm run build

# Keep the final image small and free of development-only dependencies.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate \
    && chown -R node:node /app
COPY --chown=node:node package.json pnpm-lock.yaml ./
COPY --chown=node:node patches ./patches
RUN pnpm install --prod --frozen-lockfile
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]

