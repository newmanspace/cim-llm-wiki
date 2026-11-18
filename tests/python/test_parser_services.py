"""Exercise HTTP-adapter behavior using fake engines, without downloading models."""

import importlib.util
import io
import sys
import types
import unittest
from zipfile import ZipFile
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile

ROOT = Path(__file__).resolve().parents[2]


def docx_bytes(height="0", target="../NULL", referenced=True):
    relationship_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    document = f'''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:r="{relationship_ns}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
        xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14">
        <w:p>Preserve text</w:p><w:r><w:drawing><wp:inline><wp:extent cx="635" cy="{height}"/>
        <a:blip r:embed="{'rId15' if referenced else 'valid'}"/></wp:inline></w:drawing></w:r>
        <w:r><w:drawing><wp:inline><wp:extent cx="100" cy="100"/>
        <a:blip r:embed="valid"/></wp:inline></w:drawing></w:r></w:document>'''
    relationships = f'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId15" Type="{relationship_ns}/image" Target="{target}"/>
        <Relationship Id="valid" Type="{relationship_ns}/image" Target="media/image.png"/>
        <Relationship Id="external" Type="{relationship_ns}/hyperlink"
          Target="https://example.test/link" TargetMode="External"/>
        </Relationships>'''
    stream = io.BytesIO()
    with ZipFile(stream, "w") as archive:
        archive.writestr("word/document.xml", document)
        archive.writestr("word/_rels/document.xml.rels", relationships)
        archive.writestr("word/media/image.png", b"preserved image bytes")
    return stream.getvalue()


def load_service(engine):
    dependency = types.ModuleType(
        "docling.document_converter" if engine == "docling" else "markitdown"
    )
    setattr(
        dependency,
        "DocumentConverter" if engine == "docling" else "MarkItDown",
        lambda: None,
    )
    spec = importlib.util.spec_from_file_location(
        f"{engine}_app", ROOT / "deploy" / engine / f"{engine}_app.py"
    )
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {dependency.__name__: dependency}):
        spec.loader.exec_module(module)
    return module


class ParserServices(unittest.IsolatedAsyncioTestCase):
    async def test_docling_normalizes_only_invisible_or_unused_missing_images(self):
        module = load_service("docling")
        for referenced in (True, False):
            with self.subTest(referenced=referenced):
                source = docx_bytes(referenced=referenced)
                converted_paths = []

                def convert(path, captured=converted_paths, original_bytes=source, used=referenced):
                    captured.append(Path(path))
                    with ZipFile(path) as normalized, ZipFile(io.BytesIO(original_bytes)) as original:
                        self.assertEqual(set(normalized.namelist()), set(original.namelist()))
                        for name in original.namelist():
                            if name.endswith(".rels"):
                                relationships = normalized.read(name)
                                self.assertNotIn(b"rId15", relationships)
                                self.assertIn(b"valid", relationships)
                                self.assertIn(b"external", relationships)
                            elif name == "word/document.xml" and used:
                                self.assertIn(b"Preserve text", normalized.read(name))
                                self.assertNotIn(b"rId15", normalized.read(name))
                                self.assertIn(b'r:embed="valid"', normalized.read(name))
                                self.assertIn(b'xmlns:w14=', normalized.read(name))
                                self.assertIn(b'mc:Ignorable="w14"', normalized.read(name))
                                self.assertEqual(normalized.read(name).count(b"<wp:inline>"), 1)
                            else:
                                self.assertEqual(normalized.read(name), original.read(name))
                    picture = types.SimpleNamespace(image=types.SimpleNamespace(
                        uri="data:image/png;base64,cGljdHVyZQ=="
                    ))
                    return types.SimpleNamespace(document=types.SimpleNamespace(
                        export_to_markdown=lambda: "# Preserved\n<!-- image -->", pictures=[picture]
                    ))

                module.converter = types.SimpleNamespace(convert=convert)
                upload = io.BytesIO(source)
                result = await module.convert_file(UploadFile(upload, filename="original.docx"))
                self.assertEqual(result["status"], "ok")
                self.assertEqual(result["warnings"][0]["id"], "rId15")
                self.assertEqual(len(result["document"]["images"]), 1)
                self.assertEqual(upload.getvalue(), source)
                self.assertFalse(converted_paths[0].exists())
                self.assertFalse(converted_paths[0].parent.exists())

    async def test_docling_preserves_valid_docx_without_repacking(self):
        module = load_service("docling")
        source = docx_bytes(height="100", target="media/image.png")

        def convert(path):
            self.assertEqual(Path(path).read_bytes(), source)
            return types.SimpleNamespace(document=types.SimpleNamespace(
                export_to_markdown=lambda: "valid", pictures=[]
            ))

        module.converter = types.SimpleNamespace(convert=convert)
        result = await module.convert_file(UploadFile(io.BytesIO(source), filename="valid.docx"))
        self.assertEqual(result["warnings"], [])

    async def test_docling_does_not_silently_drop_missing_visible_images(self):
        module = load_service("docling")
        module.converter = types.SimpleNamespace(convert=lambda _: self.fail("must not convert"))
        for source in (docx_bytes(height="100"), b"not a zip"):
            with self.assertRaises(HTTPException) as failure:
                await module.convert_file(UploadFile(io.BytesIO(source), filename="input.docx"))
            self.assertEqual(failure.exception.status_code, 422)

    async def test_docling_cleans_normalized_copy_on_engine_failure(self):
        module = load_service("docling")
        paths = []

        def fail(path):
            paths.append(Path(path))
            raise RuntimeError("conversion failed")

        module.converter = types.SimpleNamespace(convert=fail)
        with self.assertRaises(HTTPException) as failure:
            await module.convert_file(UploadFile(io.BytesIO(docx_bytes()), filename="input.docx"))
        self.assertEqual(failure.exception.status_code, 500)
        self.assertFalse(paths[0].parent.exists())

    async def test_conversion_cleanup_and_error_contract(self):
        for engine in ("docling", "markitdown"):
            with self.subTest(engine=engine):
                module = load_service(engine)
                self.assertEqual(module.healthz(), {"status": "ok"})
                paths = []

                def convert(path, captured=paths):
                    captured.append(Path(path))
                    self.assertEqual(Path(path).read_bytes(), b"original source")
                    document = types.SimpleNamespace(
                        export_to_markdown=lambda: "# Parsed", pictures=[]
                    )
                    return types.SimpleNamespace(document=document, markdown="# Parsed")

                module.converter = types.SimpleNamespace(convert=convert)
                result = await module.convert_file(
                    UploadFile(io.BytesIO(b"original source"), filename="source.xlsx")
                )
                self.assertEqual(result["document"]["md_content"], "# Parsed")
                self.assertEqual(result["engine"], engine)
                self.assertFalse(paths[-1].exists())

                def fail(path, captured=paths):
                    captured.append(Path(path))
                    raise RuntimeError("conversion failed")

                module.converter = types.SimpleNamespace(convert=fail)
                with self.assertRaises(HTTPException) as failure:
                    await module.convert_file(
                        UploadFile(
                            io.BytesIO(b"original source"), filename="source.xlsx"
                        )
                    )
                self.assertEqual(failure.exception.status_code, 500)
                self.assertFalse(paths[-1].exists())
                for filename in ("payload.exe", None):
                    with self.assertRaises(HTTPException) as failure:
                        await module.convert_file(
                            UploadFile(io.BytesIO(b"source"), filename=filename)
                        )
                    self.assertEqual(failure.exception.status_code, 415)

    def test_docling_collects_only_valid_inline_images(self):
        module = load_service("docling")

        class BrokenPicture:
            @property
            def image(self):
                raise ValueError("unavailable image")

        pictures = [BrokenPicture(), types.SimpleNamespace(image=None)]
        for uri in [
            None,
            "https://example.test/image.png",
            "data:image/png;base64,aGVsbG8=",
            "data:invalid",
        ]:
            pictures.append(types.SimpleNamespace(image=types.SimpleNamespace(uri=uri)))
        images = module.collect_images(types.SimpleNamespace(pictures=pictures))
        self.assertEqual(images, [{"ext": "png", "data": "aGVsbG8="}])
