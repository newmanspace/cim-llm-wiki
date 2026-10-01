# Docling 解析服务（对齐项目契约: POST /v1/convert/file, multipart "file" → {document:{md_content}}）
# 国内拉取: docker pull swr.cn-north-4.myhuaweicloud.com/ddn-k8s/quay.io/docling-project/docling-serve:latest
#           docker tag 上述镜像 quay.io/docling-project/docling-serve:latest
FROM quay.io/docling-project/docling-serve:latest

USER root
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple \
    fastapi "uvicorn[standard]" python-multipart
COPY docling_app.py /app/docling_app.py
WORKDIR /app

EXPOSE 5001
CMD ["uvicorn", "docling_app:app", "--host", "0.0.0.0", "--port", "5001"]
