import logging
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select

from .chroma_store import ChromaStore
from .chunking import chunk_sections
from .config import Settings
from .database import DocumentRecord, SessionLocal
from .embeddings import EmbeddingProvider, OpenAIEmbeddingProvider
from .extraction import extract_text
from .prompt_guard import guard_untrusted_text


logger = logging.getLogger("ops-copilot-agent")


def _provider(settings: Settings) -> EmbeddingProvider:
    return OpenAIEmbeddingProvider(
        api_key=settings.openai_api_key,
        model=settings.openai_embedding_model,
        dimensions=settings.embedding_dimensions,
        batch_size=settings.embedding_batch_size,
    )


def _safe_document_path(storage_path: str, upload_dir: Path) -> Path:
    root = upload_dir.resolve()
    candidate = Path(storage_path).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Document path is outside the configured upload directory.")
    if not candidate.is_file():
        raise FileNotFoundError("Uploaded document file is missing.")
    return candidate


def ingest_document(document_id: str, user_id: str, settings: Settings) -> dict[str, object]:
    with SessionLocal() as session:
        document = session.scalar(
            select(DocumentRecord).where(DocumentRecord.id == document_id, DocumentRecord.user_id == user_id)
        )
        if document is None:
            raise LookupError("Document not found.")
        if document.status == "DONE":
            return {"document_id": document.id, "status": document.status, "chunk_count": document.chunk_count or 0}
        document.status = "PROCESSING"
        document.failure_reason = None
        document.updated_at = datetime.now(UTC).replace(tzinfo=None)
        session.commit()

        try:
            file_path = _safe_document_path(document.storage_path, settings.upload_dir)
            sections = extract_text(file_path)
            chunks = chunk_sections(
                sections,
                target_tokens=settings.chunk_target_tokens,
                overlap_tokens=settings.chunk_overlap_tokens,
            )
            provider = _provider(settings)
            embeddings = provider.embed([chunk.text for chunk in chunks], user_id=user_id)
            collection = ChromaStore(settings.chroma_url).upsert_document(
                user_id=user_id,
                document_id=document.id,
                filename=document.filename,
                chunks=chunks,
                embeddings=embeddings,
            )
            document.status = "DONE"
            document.chroma_collection_id = collection
            document.chunk_count = len(chunks)
            document.processed_at = datetime.now(UTC).replace(tzinfo=None)
            document.updated_at = document.processed_at
            document.failure_reason = None
            session.commit()
            return {"document_id": document.id, "status": document.status, "chunk_count": len(chunks)}
        except Exception as error:
            session.rollback()
            document = session.scalar(
                select(DocumentRecord).where(DocumentRecord.id == document_id, DocumentRecord.user_id == user_id)
            )
            if document is not None:
                document.status = "FAILED"
                document.failure_reason = str(error)[:2_000]
                document.updated_at = datetime.now(UTC).replace(tzinfo=None)
                session.commit()
            logger.exception("document ingestion failed", extra={"document_id": document_id, "user_id": user_id})
            raise


def retrieve(
    query: str, user_id: str, top_k: int, document_id: str | None, settings: Settings
) -> list[dict[str, object]]:
    query_embedding = _provider(settings).embed([query], user_id=user_id)[0]
    results = ChromaStore(settings.chroma_url).search(
        user_id=user_id,
        query_embedding=query_embedding,
        top_k=top_k,
        document_id=document_id,
    )
    matches: list[dict[str, object]] = []
    for result in results:
        guarded = guard_untrusted_text(result.content)
        if guarded.prompt_injection_suspected:
            logger.warning(
                "possible prompt injection in retrieved document",
                extra={
                    "document_id": result.document_id,
                    "chunk_index": result.chunk_index,
                    "indicators": list(guarded.indicators),
                },
            )
        matches.append(
            {
                "content": guarded.content,
                "score": 1 - result.distance,
                "citation": {
                    "document_id": result.document_id,
                    "filename": result.filename,
                    "chunk_index": result.chunk_index,
                    "page": result.page,
                },
                "security": guarded.security_metadata("untrusted_document"),
            }
        )
    return matches
