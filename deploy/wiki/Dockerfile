FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit
COPY contracts/ ./contracts/
COPY packages/wiki-core/ ./packages/wiki-core/
COPY .agents/skills/cim-wiki/assets/ ./.agents/skills/cim-wiki/assets/

WORKDIR /app/wiki

# 安装依赖
COPY wiki/package.json wiki/package-lock.json ./
RUN npm ci --prefer-offline --no-audit

# 复制前端代码
COPY wiki/ ./

EXPOSE 5174
ENV PORT=5174

CMD ["sh", "-c", "npm run docs:build && npm run docs:preview"]
