# ── Stage 1: build the Vue3 + Element Plus admin SPA ──────────────────────────
FROM node:22-alpine AS build

WORKDIR /app/admin

COPY admin/package.json admin/package-lock.json* ./
RUN npm ci --prefer-offline --no-audit || npm install

COPY admin/ ./
COPY wiki/.vitepress/theme/mermaid-renderer.mjs /app/wiki/.vitepress/theme/mermaid-renderer.mjs
RUN ln -s /app/admin/node_modules /app/wiki/node_modules
RUN npm run build

# ── Stage 2: serve static bundle + reverse-proxy /api via nginx ───────────────
FROM nginx:1.27-alpine

COPY deploy/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/admin/dist /usr/share/nginx/html/admin

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
