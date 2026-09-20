from types import SimpleNamespace

import pytest

from app.config import Settings
from app.identity import require_user_id


USER_ID = "6e2867ae-0e77-4bf8-a03a-32cae24f7199"


def test_user_header_is_accepted_only_with_internal_token() -> None:
    settings = Settings(internal_api_token="test-internal-token")
    context = SimpleNamespace(
        headers={
            "x-internal-token": "test-internal-token",
            "x-user-id": USER_ID,
        }
    )

    assert require_user_id(context, settings) == USER_ID


def test_untrusted_caller_cannot_assert_a_user_identity() -> None:
    settings = Settings(internal_api_token="test-internal-token")
    context = SimpleNamespace(
        headers={
            "x-internal-token": "wrong-token",
            "x-user-id": USER_ID,
        }
    )

    with pytest.raises(PermissionError, match="internal service token"):
        require_user_id(context, settings)


def test_invalid_user_id_is_rejected() -> None:
    settings = Settings(internal_api_token="test-internal-token")
    context = SimpleNamespace(
        headers={
            "x-internal-token": "test-internal-token",
            "x-user-id": "not-a-uuid",
        }
    )

    with pytest.raises(PermissionError, match="valid user identity"):
        require_user_id(context, settings)
