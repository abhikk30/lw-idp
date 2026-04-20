# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
ARG SERVICE
ENV SERVICE=${SERVICE}
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline

FROM deps AS builder
# Build all workspace lib packages that gateway-svc depends on
RUN pnpm --filter "@lw-idp/errors" \
        --filter "@lw-idp/telemetry" \
        --filter "@lw-idp/service-kit" build
# Patch exports in each workspace lib so pnpm deploy bundles compiled JS
RUN apk add --no-cache jq && \
    for pkg in errors telemetry service-kit; do \
      pkgjson="/repo/packages/$pkg/package.json"; \
      jq '.exports = {".": "./dist/src/index.js"}' "$pkgjson" > /tmp/p.json && \
      mv /tmp/p.json "$pkgjson"; \
      echo "patched $pkg"; \
    done
# Build the service itself
RUN pnpm -F "./apps/${SERVICE}" build
# pnpm deploy creates a standalone directory with all prod deps resolved
RUN pnpm --filter "./apps/${SERVICE}" deploy --prod /deploy

FROM node:22-alpine AS runtime
ARG SERVICE
ENV SERVICE=${SERVICE}
ENV NODE_ENV=production
ENV PORT=4000
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=builder --chown=app:app /deploy/node_modules ./node_modules
COPY --from=builder --chown=app:app /repo/apps/${SERVICE}/dist ./dist
COPY --from=builder --chown=app:app /repo/apps/${SERVICE}/package.json ./package.json
USER app
EXPOSE 4000
CMD ["node", "dist/src/index.js"]
