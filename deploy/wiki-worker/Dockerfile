FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit
COPY packages/wiki-core/ ./packages/wiki-core/
COPY packages/wiki-service/build-socket.mjs packages/wiki-service/build-config.mjs ./packages/wiki-service/
COPY packages/wiki-worker/ ./packages/wiki-worker/
COPY contracts/ ./contracts/
COPY .agents/skills/cim-wiki/assets/ ./.agents/skills/cim-wiki/assets/
COPY wiki/package.json wiki/package-lock.json ./wiki/
RUN npm ci --prefix wiki --ignore-scripts --no-audit
COPY wiki/.vitepress/ ./wiki/.vitepress/
COPY wiki/scripts/ ./wiki/scripts/
RUN chmod -R a+rX /app/.agents/skills/cim-wiki/assets
ENV CIM_WIKI_WORKSPACE=/app
USER 1000:0
CMD ["node", "packages/wiki-worker/server.mjs"]
