# MarkItDown 解析服务（服务端引擎，项目契约: POST /v1/convert/file → {document:{md_content}}）
FROM python:3.11-slim

RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple \
    "markitdown[pdf,docx,pptx,xlsx]" fastapi "uvicorn[standard]" python-multipart

COPY markitdown_app.py /app/markitdown_app.py
WORKDIR /app

EXPOSE 5002
CMD ["uvicorn", "markitdown_app:app", "--host", "0.0.0.0", "--port", "5002"]
