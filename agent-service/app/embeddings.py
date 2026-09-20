from collections.abc import Sequence
from typing import Protocol

from openai import OpenAI


class EmbeddingProvider(Protocol):
    def embed(self, texts: Sequence[str], *, user_id: str) -> list[list[float]]: ...


class OpenAIEmbeddingProvider:
    def __init__(self, *, api_key: str, model: str, dimensions: int = 1536, batch_size: int = 64) -> None:
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured.")
        self.client = OpenAI(api_key=api_key)
        self.model = model
        self.dimensions = dimensions
        self.batch_size = batch_size

    def embed(self, texts: Sequence[str], *, user_id: str) -> list[list[float]]:
        embeddings: list[list[float]] = []
        for start in range(0, len(texts), self.batch_size):
            batch = list(texts[start : start + self.batch_size])
            response = self.client.embeddings.create(
                model=self.model,
                input=batch,
                dimensions=self.dimensions,
                encoding_format="float",
                user=user_id,
            )
            embeddings.extend(item.embedding for item in sorted(response.data, key=lambda item: item.index))
        if len(embeddings) != len(texts):
            raise RuntimeError("Embedding provider returned an unexpected vector count.")
        return embeddings
