# ── 统一入口网关：nginx 反向代理 wiki + admin + api ──────────────────────────
FROM nginx:1.27-alpine

COPY deploy/gateway/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/gateway/login.html /usr/share/nginx/html/login.html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
