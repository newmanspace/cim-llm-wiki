"""Docling FastAPI 包装：暴露项目契约接口 POST /v1/convert/file。

请求: multipart/form-data, 字段名 "file"（docx/pptx/xlsx/html/pdf...）
响应: {"document": {"md_content": "<markdown>", "images": [{"ext","data"(base64)}...]},
       "engine": "docling", "status": "ok"}
images 按文档流顺序排列，与 md 中的 `<!-- image -->` 占位一一对应，由客户端落盘并重写引用。
"""
import tempfile
from pathlib import Path

from docling.document_converter import DocumentConverter
from fastapi import FastAPI, File, HTTPException, UploadFile

app = FastAPI(title="cim-wiki docling parser", version="1.0.0")
converter = DocumentConverter()

SUPPORTED = {".docx", ".pptx", ".xlsx", ".html", ".htm", ".pdf", ".md", ".png", ".jpg", ".jpeg", ".tiff"}


def collect_images(doc):
    imgs = []
    for pic in doc.pictures:
        uri = None
        try:
            if pic.image is not None and pic.image.uri is not None:
                uri = str(pic.image.uri)
        except Exception:
            uri = None
        if uri and uri.startswith("data:"):
            try:
                header, b64 = uri.split(",", 1)
                ext = header.split("/")[1].split(";")[0] or "png"
                imgs.append({"ext": ext, "data": b64})
            except Exception:
                continue
    return imgs


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.post("/v1/convert/file")
async def convert_file(file: UploadFile = File(...)):
    suffix = Path(file.filename or "upload.bin").suffix.lower()
    if suffix not in SUPPORTED:
        raise HTTPException(status_code=415, detail=f"unsupported file type: {suffix}")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        result = converter.convert(tmp_path)
        return {
            "document": {
                "md_content": result.document.export_to_markdown(),
                "images": collect_images(result.document),
            },
            "engine": "docling",
            "status": "ok",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"docling convert failed: {exc}") from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)
