import logging
from urllib.parse import urlparse

import chromadb
from openai import OpenAI

from .config import Settings
from .prompt_guard import guard_untrusted_text


logger = logging.getLogger("ops-copilot-mcp")


def _collection_name(user_id: str) -> str:
    return f"ops_user_{user_id.replace('-', '')}"


def search_user_documents(
    *,
    user_id: str,
    query: str,
    top_k: int,
    settings: Settings,
) -> list[dict[str, object]]:
    query = query.strip()
    if not 1 <= len(query) <= 2_000:
        raise ValueError("query must contain between 1 and 2,000 characters.")
    if not 1 <= top_k <= 8:
        raise ValueError("top_k must be between 1 and 8.")
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    embedding = OpenAI(api_key=settings.openai_api_key).embeddings.create(
        model=settings.openai_embedding_model,
        input=[query],
        dimensions=settings.embedding_dimensions,
        encoding_format="float",
        user=user_id,
    ).data[0].embedding

    parsed = urlparse(settings.chroma_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("CHROMA_URL must be an HTTP(S) URL.")
    client = chromadb.HttpClient(
        host=parsed.hostname,
        port=parsed.port or (443 if parsed.scheme == "https" else 80),
        ssl=parsed.scheme == "https",
    )
    collection = client.get_or_create_collection(
        name=_collection_name(user_id),
        metadata={"hnsw:space": "cosine"},
    )
    result = collection.query(
        query_embeddings=[embedding],
        n_results=top_k,
        include=["documents", "metadatas", "distances"],
    )
    documents = (result.get("documents") or [[]])[0]
    metadatas = (result.get("metadatas") or [[]])[0]
    distances = (result.get("distances") or [[]])[0]
    matches: list[dict[str, object]] = []
    for content, metadata, distance in zip(documents, metadatas, distances, strict=True):
        if content is None or metadata is None or distance is None:
            continue
        citation = {
            "document_id": str(metadata["document_id"]),
            "filename": str(metadata["filename"]),
            "chunk_index": int(metadata["chunk_index"]),
            "page": int(metadata["page"]) if "page" in metadata else None,
        }
        guarded = guard_untrusted_text(content)
        if guarded.prompt_injection_suspected:
            logger.warning(
                "possible prompt injection in retrieved document",
                extra={
                    "document_id": citation["document_id"],
                    "chunk_index": citation["chunk_index"],
                    "indicators": list(guarded.indicators),
                },
            )
        matches.append(
            {
                "content": guarded.content,
                "score": 1 - float(distance),
                "citation": citation,
                "security": guarded.security_metadata("untrusted_document"),
            }
        )
    return matches
