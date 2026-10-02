# ── Stage 1: build the Vue3 + Element Plus admin SPA ──────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY admin/package.json admin/package-lock.json* ./
RUN npm ci --prefer-offline --no-audit || npm install

COPY admin/ ./
RUN npm run build

# ── Stage 2: serve static bundle + reverse-proxy /api via nginx ───────────────
FROM nginx:1.27-alpine

COPY deploy/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/admin

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
