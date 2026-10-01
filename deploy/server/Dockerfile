FROM alpine:latest
WORKDIR /app

# 从构建目录复制静态 Go 二进制 (无需安装外部 apk，零网络依赖)
COPY bin/cim-wiki-server /app/cim-wiki-server
RUN chmod +x /app/cim-wiki-server

EXPOSE 8080
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=8080
ENV WIKI_OUTPUT_DIR=/app/data/wiki
ENV WIKI_RAW_DIR=/app/data/raw
ENV MINERU_ENDPOINT=http://mineru:8888
ENV DOCLING_ENDPOINT=http://docling:5001
ENV MARKITDOWN_ENDPOINT=http://markitdown:5002

ENTRYPOINT ["/app/cim-wiki-server"]
