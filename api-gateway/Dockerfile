FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM dependencies AS builder
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM builder AS production-dependencies
RUN npm prune --omit=dev

FROM builder AS test
ENV NODE_ENV=test
CMD ["npm", "run", "test:integration"]

FROM builder AS migrator
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs opscopilot && mkdir -p /app/uploads && chown opscopilot:nodejs /app/uploads
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
USER opscopilot
EXPOSE 4000
CMD ["node", "dist/server.js"]
