FROM node:22-alpine

WORKDIR /app

# 安装依赖
COPY web/package.json web/package-lock.json ./
RUN npm ci --prefer-offline --no-audit || npm install

# 复制前端代码
COPY web/ ./

EXPOSE 5174
ENV PORT=5174

CMD ["npm", "run", "docs:dev"]
