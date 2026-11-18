"""Docling FastAPI 包装：暴露项目契约接口 POST /v1/convert/file。

请求: multipart/form-data, 字段名 "file"（docx/pptx/xlsx/html/pdf...）
响应: {"document": {"md_content": "<markdown>", "images": [{"ext","data"(base64)}...]},
       "engine": "docling", "status": "ok"}
images 按文档流顺序排列，与 md 中的 `<!-- image -->` 占位一一对应，由客户端落盘并重写引用。
"""

import tempfile
import logging
import posixpath
from pathlib import Path
from typing import Annotated
from urllib.parse import unquote, urlsplit
from zipfile import BadZipFile, ZipFile

from lxml import etree as ET
from docling.document_converter import DocumentConverter
from fastapi import FastAPI, File, HTTPException, UploadFile

app = FastAPI(title="cim-wiki docling parser", version="1.0.0")
converter = DocumentConverter()

SUPPORTED = {
    ".docx",
    ".pptx",
    ".xlsx",
    ".html",
    ".htm",
    ".pdf",
    ".md",
    ".png",
    ".jpg",
    ".jpeg",
    ".tiff",
}

REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
STRICT_REL_NS = "http://purl.oclc.org/ooxml/officeDocument/relationships"
WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"


def parse_xml(data):
    root = ET.fromstring(data, parser=ET.XMLParser(resolve_entities=False, no_network=True))
    if root.getroottree().docinfo.doctype:
        raise ValueError("DOCTYPE is not supported in DOCX parts")
    return root


def relationship_owner(name):
    if name == "_rels/.rels":
        return ""
    return posixpath.join(
        posixpath.dirname(posixpath.dirname(name)),
        posixpath.basename(name)[:-5],
    )


def relationship_target(owner, target):
    uri = urlsplit(target)
    if not target or uri.scheme or uri.netloc:
        raise ValueError("invalid internal relationship target")
    path = unquote(uri.path)
    resolved = posixpath.normpath(
        path.lstrip("/") if path.startswith("/")
        else posixpath.join(posixpath.dirname(owner), path)
    )
    if resolved == ".." or resolved.startswith("../") or "\\" in resolved:
        raise ValueError("relationship target escapes package")
    return resolved


def invisible_image_reference(element):
    if element.tag != "{http://schemas.openxmlformats.org/drawingml/2006/main}blip":
        return None
    current = element
    while current.getparent() is not None:
        current = current.getparent()
        if current.tag not in (f"{{{WP_NS}}}inline", f"{{{WP_NS}}}anchor"):
            continue
        extent = current.find(f"{{{WP_NS}}}extent")
        if extent is not None and (
            extent.get("cx") == "0" or extent.get("cy") == "0"
        ):
            parent = current.getparent()
            if (parent is not None and len(parent) == 1
                    and parent.tag == "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing"):
                return parent
            return current
        return None
    return None


def removable_image_relationship(archive, owner, relationship, owner_roots):
    if relationship.get("Type") not in (f"{REL_NS}/image", f"{STRICT_REL_NS}/image") or not owner:
        return None
    if owner not in owner_roots:
        owner_roots[owner] = parse_xml(archive.read(owner))
    root = owner_roots[owner]
    refs = [
        element for element in root.iter()
        if any(
            key.startswith((f"{{{REL_NS}}}", f"{{{STRICT_REL_NS}}}"))
            and value == relationship.get("Id")
            for key, value in element.attrib.items()
        )
    ]
    containers = [invisible_image_reference(element) for element in refs]
    return None if any(item is None for item in containers) else containers


def prepare_docx(source, destination):
    """Normalize Office-tolerated image placeholders in a disposable copy only."""
    warnings = []
    with ZipFile(source) as archive:
        files = {entry.filename for entry in archive.infolist() if not entry.is_dir()}
        replacements = {}
        owner_roots = {}
        changed_owners = set()
        for name in sorted(files):
            if not name.endswith(".rels"):
                continue
            owner = relationship_owner(name)
            root = parse_xml(archive.read(name))
            for relationship in list(root):
                if relationship.get("TargetMode") == "External":
                    continue
                target = relationship.get("Target", "")
                if relationship_target(owner, target) in files:
                    continue
                detail = f"{name}: {relationship.get('Id')} -> {target}"
                containers = removable_image_relationship(archive, owner, relationship, owner_roots)
                if containers is None:
                    raise ValueError(f"missing referenced document resource: {detail}")
                for container in containers:
                    parent = container.getparent()
                    if parent is not None:
                        parent.remove(container)
                        changed_owners.add(owner)
                root.remove(relationship)
                warnings.append({
                    "code": "docx_invisible_image_relationship_removed",
                    "relationship_file": name,
                    "id": relationship.get("Id"),
                    "target": target,
                })
            if any(item["relationship_file"] == name for item in warnings):
                replacements[name] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
        for owner in changed_owners:
            replacements[owner] = ET.tostring(owner_roots[owner], encoding="utf-8", xml_declaration=True)
        if replacements:
            with ZipFile(destination, "w") as output:
                for entry in archive.infolist():
                    output.writestr(entry, replacements.get(entry.filename, archive.read(entry)))
    return warnings


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
            except (ValueError, IndexError):
                logging.getLogger(__name__).warning(
                    "Skipping malformed inline image URI"
                )
                continue
    return imgs


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.post("/v1/convert/file")
async def convert_file(file: Annotated[UploadFile, File()]):
    suffix = Path(file.filename or "upload.bin").suffix.lower()
    if suffix not in SUPPORTED:
        raise HTTPException(status_code=415, detail=f"unsupported file type: {suffix}")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        with tempfile.TemporaryDirectory(prefix="docling-normalized-") as workdir:
            normalized = Path(workdir) / "input.docx"
            warnings = []
            if suffix == ".docx":
                try:
                    warnings = prepare_docx(tmp_path, normalized)
                except (ValueError, BadZipFile, ET.XMLSyntaxError, KeyError) as exc:
                    raise HTTPException(status_code=422, detail=str(exc)) from exc
            if warnings:
                logging.getLogger(__name__).warning("DOCX normalization: %s", warnings)
            result = converter.convert(str(normalized) if warnings else tmp_path)
            return {
                "document": {
                    "md_content": result.document.export_to_markdown(),
                    "images": collect_images(result.document),
                },
                "engine": "docling",
                "status": "ok",
                "warnings": warnings,
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"docling convert failed: {exc}"
        ) from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)
