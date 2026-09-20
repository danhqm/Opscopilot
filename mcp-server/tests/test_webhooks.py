import pytest

from app.webhooks import _is_public_address, validate_webhook_url_syntax


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://localhost/hook",
        "http://service.local/hook",
        "https://user:password@example.com/hook",
    ],
)
def test_webhook_url_rejects_unsafe_syntax(url: str) -> None:
    with pytest.raises(ValueError):
        validate_webhook_url_syntax(url)


def test_webhook_address_filter_rejects_non_public_networks() -> None:
    assert not _is_public_address("127.0.0.1")
    assert not _is_public_address("10.0.0.5")
    assert not _is_public_address("169.254.169.254")
    assert _is_public_address("8.8.8.8")
