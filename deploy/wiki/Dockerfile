FROM nginx:1.27-alpine
COPY deploy/wiki/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5174
CMD ["nginx", "-g", "daemon off;"]
