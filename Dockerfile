# syntax=docker/dockerfile:1
# Multi-target build for the pnpm workspace:
#   docker build --target api    -t awm-monitoring-api .
#   docker build --target worker -t awm-monitoring-worker .
# The api image also contains and serves the built dashboard (same origin, no CORS).
# Stage order matters: `api` is LAST so platforms that build a Dockerfile without
# a --target option (e.g. Render) produce the web-facing image by default.

FROM node:20-alpine AS build
# libc6-compat + openssl: required by the Prisma engines on musl.
RUN apk add --no-cache libc6-compat openssl
# Pinned install instead of corepack: immune to corepack signature-key rotations.
RUN npm install -g pnpm@9.15.9
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY apps/dashboard ./apps/dashboard
RUN pnpm install --frozen-lockfile
# The Prisma client must exist before @awm/db compiles (generate runs on musl
# here, so the image gets the right linux-musl engines automatically). The
# dummy DATABASE_URL never connects — generate only needs the schema.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    pnpm --filter @awm/db exec prisma generate
# -r runs in workspace topological order (shared/config/db before apps); turbo
# is skipped on purpose — one less binary to trust inside the image.
RUN pnpm -r run build

FROM node:20-alpine AS worker
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${WORKER_PORT:-3001}/health" || exit 1
CMD ["node", "apps/worker/dist/main.js"]

FROM node:20-alpine AS api
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1
CMD ["node", "apps/api/dist/main.js"]
