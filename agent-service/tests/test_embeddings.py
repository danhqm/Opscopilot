from types import SimpleNamespace

import pytest

from app.embeddings import OpenAIEmbeddingProvider


class FakeEmbeddings:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def create(self, **kwargs: object) -> SimpleNamespace:
        self.calls.append(kwargs)
        inputs = kwargs["input"]
        assert isinstance(inputs, list)
        data = [SimpleNamespace(index=index, embedding=[float(len(text)), float(index)]) for index, text in enumerate(inputs)]
        return SimpleNamespace(data=list(reversed(data)))


def test_openai_provider_batches_and_restores_response_order() -> None:
    provider = OpenAIEmbeddingProvider(api_key="test-key", model="text-embedding-3-small", dimensions=1536, batch_size=2)
    fake_embeddings = FakeEmbeddings()
    provider.client = SimpleNamespace(embeddings=fake_embeddings)  # type: ignore[assignment]

    result = provider.embed(["a", "four", "xyz"], user_id="user-123")

    assert result == [[1.0, 0.0], [4.0, 1.0], [3.0, 0.0]]
    assert [call["input"] for call in fake_embeddings.calls] == [["a", "four"], ["xyz"]]
    assert all(call["dimensions"] == 1536 for call in fake_embeddings.calls)
    assert all(call["encoding_format"] == "float" for call in fake_embeddings.calls)
    assert all(call["user"] == "user-123" for call in fake_embeddings.calls)


def test_openai_provider_requires_a_key() -> None:
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        OpenAIEmbeddingProvider(api_key="", model="text-embedding-3-small")
