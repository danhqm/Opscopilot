from dataclasses import dataclass
from pathlib import Path

from docx import Document as WordDocument
from pypdf import PdfReader


class ExtractionError(ValueError):
    pass


@dataclass(frozen=True)
class TextSection:
    text: str
    page: int | None = None


def extract_text(file_path: Path) -> list[TextSection]:
    extension = file_path.suffix.lower()
    if extension == ".pdf":
        sections = [
            TextSection(text=text, page=index)
            for index, page in enumerate(PdfReader(file_path).pages, start=1)
            if (text := (page.extract_text() or "").strip())
        ]
    elif extension == ".docx":
        text = "\n\n".join(
            paragraph.text.strip() for paragraph in WordDocument(file_path).paragraphs if paragraph.text.strip()
        )
        sections = [TextSection(text=text)] if text else []
    elif extension == ".txt":
        text = file_path.read_text(encoding="utf-8", errors="strict").strip()
        sections = [TextSection(text=text)] if text else []
    else:
        raise ExtractionError("Unsupported document type.")

    if not sections:
        raise ExtractionError("The document contains no extractable text.")
    return sections
