"""Exercise HTTP-adapter behavior using fake engines, without downloading models."""

import importlib.util
import io
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile

ROOT = Path(__file__).resolve().parents[2]


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
