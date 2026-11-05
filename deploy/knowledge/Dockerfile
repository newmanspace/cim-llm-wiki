FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit
COPY packages/wiki-core/ ./packages/wiki-core/
COPY packages/wiki-service/ ./packages/wiki-service/
COPY contracts/ ./contracts/
COPY .agents/skills/cim-wiki/assets/ ./.agents/skills/cim-wiki/assets/
ENV KNOWLEDGE_HOST=0.0.0.0 KNOWLEDGE_PORT=8090 CIM_WIKI_WORKSPACE=/app
EXPOSE 8090
CMD ["node", "packages/wiki-service/server.mjs"]
