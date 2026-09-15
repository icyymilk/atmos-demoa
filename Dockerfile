FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --fetch-timeout=30000 --fetch-retries=2
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production WRANGLER_SEND_METRICS=false ATMOS_HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/.atmos /app/.wrangler/state /app/.sites-runtime && chown -R node:node /app/.atmos /app/.wrangler /app/.sites-runtime
USER node
EXPOSE 8787
VOLUME ["/app/.atmos", "/app/.wrangler/state"]
HEALTHCHECK --interval=30s --timeout=6s --start-period=90s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
