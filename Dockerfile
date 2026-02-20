# Build
FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY pnpm-lock.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .

# Generate PWA assets before building
RUN pnpm run generate-pwa-assets

RUN NODE_OPTIONS="--max-old-space-size=6144" pnpm build

# Production
FROM node:20-alpine AS runner

WORKDIR /app

RUN npm install pm2@5.4.3 -g

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 xyra && \
    adduser --system --uid 1001 xyra

COPY --from=builder --chown=xyra:xyra /app/.output ./.output
COPY --from=builder --chown=xyra:xyra /app/ecosystem.config.cjs ./ecosystem.config.cjs

EXPOSE 3000

USER xyra

CMD ["pm2-runtime", "ecosystem.config.cjs"]