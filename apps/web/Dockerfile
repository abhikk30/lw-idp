# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline

FROM deps AS builder
# Pre-build the contracts package so its compiled .js + .d.ts artifacts are
# resolvable by Next's standalone tracer.
RUN pnpm --filter "@lw-idp/contracts" build
# @lw-idp/ui ships TSX source; Next's transpilePackages compiles it during the
# next build. No pre-build needed.
RUN pnpm -F "@lw-idp/web" build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
# Next standalone output: server bundle + minimal node_modules.
COPY --from=builder --chown=app:app /repo/apps/web/.next/standalone ./
# Static + public assets.
COPY --from=builder --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
