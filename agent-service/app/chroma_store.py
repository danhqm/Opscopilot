from dataclasses import dataclass
from urllib.parse import urlparse

import chromadb
from chromadb.api import ClientAPI

from .chunking import TextChunk


def collection_name(user_id: str) -> str:
    return f"ops_user_{user_id.replace('-', '')}"


@dataclass(frozen=True)
class SearchResult:
    content: str
    distance: float
    document_id: str
    filename: str
    chunk_index: int
    page: int | None


class ChromaStore:
    def __init__(self, url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("CHROMA_URL must be an HTTP(S) URL.")
        self.client: ClientAPI = chromadb.HttpClient(
            host=parsed.hostname,
            port=parsed.port or (443 if parsed.scheme == "https" else 80),
            ssl=parsed.scheme == "https",
        )

    def heartbeat(self) -> int:
        return self.client.heartbeat()

    def upsert_document(
        self,
        *,
        user_id: str,
        document_id: str,
        filename: str,
        chunks: list[TextChunk],
        embeddings: list[list[float]],
    ) -> str:
        if len(chunks) != len(embeddings):
            raise ValueError("Each chunk must have exactly one embedding.")
        name = collection_name(user_id)
        collection = self.client.get_or_create_collection(name=name, metadata={"hnsw:space": "cosine"})
        collection.delete(where={"document_id": document_id})
        metadatas: list[dict[str, str | int]] = []
        for chunk in chunks:
            metadata: dict[str, str | int] = {
                "user_id": user_id,
                "document_id": document_id,
                "filename": filename,
                "chunk_index": chunk.index,
            }
            if chunk.page is not None:
                metadata["page"] = chunk.page
            metadatas.append(metadata)
        collection.upsert(
            ids=[f"{document_id}-{chunk.index}" for chunk in chunks],
            embeddings=embeddings,
            documents=[chunk.text for chunk in chunks],
            metadatas=metadatas,
        )
        return name

    def search(
        self,
        *,
        user_id: str,
        query_embedding: list[float],
        top_k: int,
        document_id: str | None = None,
    ) -> list[SearchResult]:
        collection = self.client.get_or_create_collection(
            name=collection_name(user_id), metadata={"hnsw:space": "cosine"}
        )
        result = collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            where={"document_id": document_id} if document_id else None,
            include=["documents", "metadatas", "distances"],
        )
        documents = (result.get("documents") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        matches: list[SearchResult] = []
        for content, metadata, distance in zip(documents, metadatas, distances, strict=True):
            if content is None or metadata is None or distance is None:
                continue
            matches.append(
                SearchResult(
                    content=content,
                    distance=float(distance),
                    document_id=str(metadata["document_id"]),
                    filename=str(metadata["filename"]),
                    chunk_index=int(metadata["chunk_index"]),
                    page=int(metadata["page"]) if "page" in metadata else None,
                )
            )
        return matches
