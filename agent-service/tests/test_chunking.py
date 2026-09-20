import tiktoken

from app.chunking import chunk_sections
from app.extraction import TextSection


def test_chunking_enforces_limit_and_overlap() -> None:
    encoding = tiktoken.get_encoding("cl100k_base")
    source = " ".join(f"incident-{index}" for index in range(1_000))
    chunks = chunk_sections([TextSection(source, page=7)], target_tokens=100, overlap_tokens=20)

    assert len(chunks) > 2
    assert all(chunk.token_count <= 100 for chunk in chunks)
    assert all(chunk.page == 7 for chunk in chunks)

    first = encoding.encode(chunks[0].text)
    second = encoding.encode(chunks[1].text)
    assert first[-20:] == second[:20]


def test_chunking_rejects_invalid_sizes() -> None:
    try:
        chunk_sections([TextSection("hello")], target_tokens=100, overlap_tokens=100)
    except ValueError as error:
        assert "target_tokens" in str(error)
    else:
        raise AssertionError("Expected invalid chunk sizes to be rejected")
