# One image, two processes. Web: the default command. Worker: `node --conditions=react-server dist/worker/index.mjs`. Migrate first: `node dist/server/db/migrate.mjs`.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --omit=optional || npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/db/migrations ./server/db/migrations
# Worker, migration and ops bundles keep their packages external, so they need these.
COPY --from=build /app/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts drizzle-orm@^0.45 pg@^8 zod@^4 server-only viem@^2 @noble/curves@^1.9 @noble/hashes@^1.8 @scure/base@^1.2
USER node
EXPOSE 3000
CMD ["node", "server.js"]
