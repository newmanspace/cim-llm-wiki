FROM node:22-alpine

WORKDIR /app

# 安装依赖
COPY wiki/package.json wiki/package-lock.json ./
RUN npm ci --prefer-offline --no-audit || npm install

# 复制前端代码
COPY wiki/ ./

EXPOSE 5174
ENV PORT=5174

CMD ["npm", "run", "docs:dev"]
