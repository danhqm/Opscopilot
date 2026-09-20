from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas import RetrievalRequest


def test_retrieval_request_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        RetrievalRequest.model_validate(
            {"user_id": str(uuid4()), "query": "status", "unexpected": True}
        )


def test_retrieval_request_requires_real_uuid() -> None:
    with pytest.raises(ValidationError, match="valid UUID"):
        RetrievalRequest.model_validate({"user_id": "x" * 36, "query": "status"})

