import asyncio
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from mcp.server.mcpserver import Context, MCPServer
from sqlalchemy import text
from starlette.requests import Request
from starlette.responses import JSONResponse

from .config import get_settings
from .database import SessionLocal, engine
from .identity import require_user_id
from .prompt_guard import guard_untrusted_structure
from .queries import QueryName, run_query
from .retrieval import search_user_documents
from .webhooks import post_webhook


settings = get_settings()
server = MCPServer(
    name="ops-copilot-tools",
    title="Ops Copilot Tools",
    description="Tenant-scoped document, database, webhook, and task tools.",
    instructions="All tool calls are scoped to the authenticated Ops Copilot user.",
    version=settings.service_version,
)


def _insert_task(
    *,
    user_id: str,
    title: str,
    description: str | None,
    due_at: datetime | None,
) -> dict[str, object]:
    task_id = str(uuid4())
    now = datetime.now(UTC).replace(tzinfo=None)
    with SessionLocal() as session, session.begin():
        user_exists = session.execute(
            text("SELECT id FROM users WHERE id = :user_id"), {"user_id": user_id}
        ).first()
        if user_exists is None:
            raise PermissionError("Authenticated user no longer exists.")
        session.execute(
            text(
                """
                INSERT INTO tasks (id, user_id, title, description, due_at, status, created_at, updated_at)
                VALUES (:id, :user_id, :title, :description, :due_at, 'OPEN', :created_at, :updated_at)
                """
            ),
            {
                "id": task_id,
                "user_id": user_id,
                "title": title,
                "description": description,
                "due_at": due_at,
                "created_at": now,
                "updated_at": now,
            },
        )
    return {
        "task": {
            "id": task_id,
            "title": title,
            "description": description,
            "due_at": due_at.isoformat() if due_at else None,
            "status": "OPEN",
            "created_at": now.isoformat(),
        }
    }


@server.custom_route("/mcp/health", methods=["GET"], include_in_schema=False)
async def health(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "healthy", "service": "mcp-server", "version": settings.service_version})


@server.custom_route("/mcp/capabilities", methods=["GET"], include_in_schema=False)
async def capabilities(_request: Request) -> JSONResponse:
    return JSONResponse(
        {
            "protocol": "mcp-streamable-http",
            "transport": "/mcp",
            "tools": ["query_database", "search_documents", "send_webhook", "create_task"],
        }
    )


@server.tool(structured_output=True)
async def query_database(ctx: Context, query_name: QueryName, limit: int = 10) -> dict[str, object]:
    """Run one safe read-only database report for the current user.

    Args:
        query_name: One of document_status_summary, recent_tasks, or recent_workflow_runs.
        limit: Maximum rows for list reports, from 1 through 50.
    """
    user_id = require_user_id(ctx, settings)
    rows = await asyncio.to_thread(
        run_query,
        engine,
        user_id=user_id,
        query_name=query_name,
        limit=limit,
    )
    guarded_rows, security = guard_untrusted_structure(rows, trust="untrusted_database_output")
    return {
        "query_name": query_name,
        "rows": guarded_rows,
        "security": security,
    }


@server.tool(structured_output=True)
async def search_documents(ctx: Context, query: str, top_k: int = 5) -> dict[str, object]:
    """Search the current user's uploaded documents for relevant evidence.

    Args:
        query: Focused semantic search query.
        top_k: Number of matching chunks to return, from 1 through 8.
    """
    user_id = require_user_id(ctx, settings)
    matches = await asyncio.to_thread(
        search_user_documents,
        user_id=user_id,
        query=query,
        top_k=top_k,
        settings=settings,
    )
    return {"matches": matches, "security": {"trust": "untrusted_tool_output"}}


@server.tool(structured_output=True)
async def send_webhook(ctx: Context, url: str, payload: dict[str, Any]) -> dict[str, object]:
    """POST a small JSON payload to an explicitly requested public webhook URL.

    Args:
        url: Public HTTP(S) webhook destination. Local and private networks are blocked.
        payload: JSON object to send. The encoded payload cannot exceed 32 KiB.
    """
    require_user_id(ctx, settings)
    return await post_webhook(url, payload, settings.webhook_timeout_seconds)


@server.tool(structured_output=True)
async def create_task(
    ctx: Context,
    title: str,
    description: str | None = None,
    due_at: str | None = None,
) -> dict[str, object]:
    """Create a task for the current user when they explicitly request it.

    Args:
        title: Short task title.
        description: Optional details, up to 2,000 characters.
        due_at: Optional ISO-8601 due date/time. Timezone-aware values are normalized to UTC.
    """
    user_id = require_user_id(ctx, settings)
    normalized_title = title.strip()
    if not 1 <= len(normalized_title) <= 255:
        raise ValueError("title must contain between 1 and 255 characters.")
    if description is not None and len(description) > 2_000:
        raise ValueError("description cannot exceed 2,000 characters.")

    parsed_due_at: datetime | None = None
    if due_at:
        try:
            parsed_due_at = datetime.fromisoformat(due_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("due_at must be a valid ISO-8601 date/time.") from error
        if parsed_due_at.tzinfo is not None:
            parsed_due_at = parsed_due_at.astimezone(UTC).replace(tzinfo=None)

    return await asyncio.to_thread(
        _insert_task,
        user_id=user_id,
        title=normalized_title,
        description=description,
        due_at=parsed_due_at,
    )


app = server.streamable_http_app(
    streamable_http_path="/mcp",
    stateless_http=True,
    json_response=True,
    host="0.0.0.0",
)
