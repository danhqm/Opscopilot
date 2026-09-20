from types import SimpleNamespace

from agents import Agent
from agents.items import ToolCallItem, ToolCallOutputItem

from app.agent_runtime import (
    AGENT_INSTRUCTIONS,
    _dedupe_citations,
    tool_audit_from_items,
    usage_from_result,
)


def test_agent_prompt_treats_retrieved_text_as_untrusted() -> None:
    normalized = AGENT_INSTRUCTIONS.lower()
    assert "untrusted data" in normalized
    assert "never instructions" in normalized
    assert "cite" in normalized
    assert "explicitly asks" in normalized


def test_usage_from_result_reads_aggregate_sdk_usage() -> None:
    result = SimpleNamespace(
        context_wrapper=SimpleNamespace(
            usage=SimpleNamespace(input_tokens=12, output_tokens=7, total_tokens=19)
        )
    )
    assert usage_from_result(result) == {
        "input_tokens": 12,
        "output_tokens": 7,
        "total_tokens": 19,
    }


def test_citations_are_deduplicated_by_source_location() -> None:
    citation = {"document_id": "doc", "filename": "runbook.txt", "chunk_index": 1, "page": None}
    assert _dedupe_citations([citation, dict(citation)]) == [citation]


def test_mcp_items_become_audit_records_and_citations() -> None:
    agent = Agent(name="test", instructions="test")
    raw_call = SimpleNamespace(
        call_id="call-1",
        name="search_documents",
        arguments='{"query":"failover","top_k":3}',
    )
    raw_output = {"call_id": "call-1"}
    citation = {
        "document_id": "doc",
        "filename": "runbook.txt",
        "chunk_index": 2,
        "page": None,
    }
    items = [
        ToolCallItem(agent=agent, raw_item=raw_call),
        ToolCallOutputItem(
            agent=agent,
            raw_item=raw_output,
            output={"matches": [{"citation": citation}, {"citation": dict(citation)}]},
        ),
    ]

    audit, citations = tool_audit_from_items(items)

    assert audit == [
        {
            "name": "search_documents",
            "arguments": {"query": "failover", "top_k": 3},
            "result": {"result_count": 2},
        }
    ]
    assert citations == [citation]


def test_action_audit_omits_webhook_payload() -> None:
    agent = Agent(name="test", instructions="test")
    items = [
        ToolCallItem(
            agent=agent,
            raw_item=SimpleNamespace(
                call_id="call-2",
                name="send_webhook",
                arguments='{"url":"https://example.com/hook","payload":{"secret":"value"}}',
            ),
        ),
        ToolCallOutputItem(
            agent=agent,
            raw_item={"call_id": "call-2"},
            output={"delivered": True, "status_code": 204},
        ),
    ]

    audit, _ = tool_audit_from_items(items)

    assert audit[0]["arguments"] == {
        "url": "https://example.com/hook",
        "payload_keys": ["secret"],
    }
    assert audit[0]["result"] == {"delivered": True, "status_code": 204}
