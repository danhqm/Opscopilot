from dataclasses import dataclass

import tiktoken

from .extraction import TextSection


@dataclass(frozen=True)
class TextChunk:
    index: int
    text: str
    token_count: int
    page: int | None = None


def chunk_sections(
    sections: list[TextSection],
    *,
    target_tokens: int = 700,
    overlap_tokens: int = 100,
    encoding_name: str = "cl100k_base",
) -> list[TextChunk]:
    if target_tokens <= 0 or overlap_tokens < 0 or overlap_tokens >= target_tokens:
        raise ValueError("Chunk sizes must satisfy target_tokens > overlap_tokens >= 0.")

    encoding = tiktoken.get_encoding(encoding_name)
    chunks: list[TextChunk] = []
    step = target_tokens - overlap_tokens
    for section in sections:
        tokens = encoding.encode(section.text)
        for start in range(0, len(tokens), step):
            token_slice = tokens[start : start + target_tokens]
            if not token_slice:
                continue
            chunks.append(
                TextChunk(
                    index=len(chunks),
                    text=encoding.decode(token_slice),
                    token_count=len(token_slice),
                    page=section.page,
                )
            )
            if start + target_tokens >= len(tokens):
                break
    if not chunks:
        raise ValueError("The document produced no text chunks.")
    return chunks
