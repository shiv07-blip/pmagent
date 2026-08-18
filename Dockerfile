FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/agent/package.json packages/agent/
COPY packages/api/package.json packages/api/
COPY packages/worker/package.json packages/worker/
COPY packages/web/package.json packages/web/

RUN npm ci

COPY packages/core/ packages/core/
COPY packages/db/ packages/db/
COPY packages/agent/ packages/agent/
COPY packages/api/ packages/api/
COPY packages/worker/ packages/worker/
COPY packages/web/ packages/web/

RUN npm run build

FROM node:22-slim AS runner

RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/packages/db/src/migrations packages/db/dist/migrations
COPY --from=builder /app/packages/db/package.json packages/db/
COPY --from=builder /app/packages/agent/dist packages/agent/dist
COPY --from=builder /app/packages/agent/package.json packages/agent/
COPY --from=builder /app/packages/api/dist packages/api/dist
COPY --from=builder /app/packages/api/package.json packages/api/
COPY --from=builder /app/packages/worker/dist packages/worker/dist
COPY --from=builder /app/packages/worker/package.json packages/worker/
COPY --from=builder /app/packages/web/dist packages/web/dist

COPY start.mjs ./

ENV NODE_ENV=production

EXPOSE 8080

CMD ["tini", "--", "node", "start.mjs"]
