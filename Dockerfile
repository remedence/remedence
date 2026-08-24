ARG BUN_BASE_IMAGE
ARG NODE_BASE_IMAGE

FROM ${BUN_BASE_IMAGE} AS build
WORKDIR /src
COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY tools ./tools
COPY api ./api
COPY scripts ./scripts
RUN bun install --frozen-lockfile
RUN bun run build

FROM ${NODE_BASE_IMAGE} AS runtime
ENV NODE_ENV=production \
    REMEDENCE_DATA_DIR=/var/lib/remedence
WORKDIR /app
COPY --from=build /src/package.json ./package.json
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/apps/api/package.json ./apps/api/package.json
COPY --from=build /src/apps/api/dist ./apps/api/dist
COPY --from=build /src/apps/web/dist ./apps/web/dist
COPY --from=build /src/packages ./packages
COPY --from=build /src/api ./api
COPY --from=build /src/scripts ./scripts
RUN mkdir -p /var/lib/remedence && chown -R node:node /app /var/lib/remedence
USER node
EXPOSE 43180
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:43180/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "apps/api/dist/server.js"]
