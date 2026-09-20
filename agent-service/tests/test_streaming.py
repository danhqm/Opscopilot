import json

from app.streaming import sse_event


def test_sse_event_uses_a_single_json_data_line() -> None:
    encoded = sse_event("delta", {"delta": "first\nsecond"})
    assert encoded.startswith("event: delta\ndata: ")
    assert encoded.endswith("\n\n")
    payload = encoded.splitlines()[1].removeprefix("data: ")
    assert json.loads(payload) == {"delta": "first\nsecond"}
