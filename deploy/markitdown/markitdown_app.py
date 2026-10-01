"""MarkItDown 解析服务（服务端引擎）：暴露项目契约接口 POST /v1/convert/file。

请求: multipart/form-data, 字段名 "file"（pdf/docx/pptx/xlsx/html...）
响应: {"document": {"md_content": "<markdown>"}, "engine": "markitdown", "status": "ok"}
"""
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from markitdown import MarkItDown

app = FastAPI(title="cim-wiki markitdown parser", version="1.0.0")
converter = MarkItDown()

SUPPORTED = {
    ".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
    ".html", ".htm", ".epub", ".csv", ".json", ".xml", ".zip",
}


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
            "document": {"md_content": result.markdown or ""},
            "engine": "markitdown",
            "status": "ok",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"markitdown convert failed: {exc}") from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)
