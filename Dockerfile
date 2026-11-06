# One image, two processes.
#   Web:     the default command.
#   Worker:  node dist/worker/index.mjs
#   Migrate: node dist/server/db/migrate.mjs   (run before starting a new version)
#   Ops:     node dist/scripts/ops.mjs status
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Set true only for a staging image that runs in test mode. Production leaves it unset, so the browser
# only ever trusts NEAR's own signing key.
ARG NEXT_PUBLIC_TEST_BUILD=
ENV NEXT_PUBLIC_TEST_BUILD=$NEXT_PUBLIC_TEST_BUILD
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
# Bundled with their dependencies, so they need nothing installed.
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/db/migrations ./server/db/migrations
USER node
EXPOSE 3000
CMD ["node", "server.js"]
