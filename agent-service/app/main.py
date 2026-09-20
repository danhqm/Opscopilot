import asyncio
import json
import logging
import secrets
from datetime import UTC, datetime
from urllib.request import urlopen

from fastapi import FastAPI, Header, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import text

from .agent_runtime import OpenAIAgentProvider
from .config import get_settings
from .chroma_store import ChromaStore
from .conversation_store import complete_turn, start_turn
from .database import engine
from .rag import ingest_document, retrieve
from .schemas import ChatStreamRequest, IngestionRequest, RetrievalRequest, WorkflowExecutionRequest
from .streaming import sse_event
from .workflow_runtime import execute_workflow


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(
            {
                "timestamp": datetime.now(UTC).isoformat(),
                "level": record.levelname.lower(),
                "service": "agent-service",
                "message": record.getMessage(),
            }
        )


handler = logging.StreamHandler()
handler.setFormatter(JsonFormatter())
logger = logging.getLogger("ops-copilot-agent")
logger.handlers = [handler]
logger.setLevel(logging.INFO)

settings = get_settings()
agent_provider = OpenAIAgentProvider(settings)
app = FastAPI(
    title="Ops Copilot Agent Service",
    version=settings.service_version,
    docs_url="/agent/docs",
    openapi_url="/agent/openapi.json",
)


def require_internal_token(x_internal_token: str | None) -> None:
    if x_internal_token is None or not secrets.compare_digest(x_internal_token, settings.internal_api_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal service token.")


@app.get("/agent/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "healthy", "service": "agent-service", "version": settings.service_version}


@app.get("/agent/ready", tags=["system"])
def readiness(response: Response) -> dict[str, object]:
    dependencies: dict[str, object] = {
        "mysql": "down",
        "chromadb": "down",
        "mcp_server": "down",
        "openai_key_configured": bool(settings.openai_api_key),
    }
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        dependencies["mysql"] = "up"
        ChromaStore(settings.chroma_url).heartbeat()
        dependencies["chromadb"] = "up"
        with urlopen(f"{settings.mcp_server_url.rstrip('/')}/mcp/health", timeout=3) as mcp_response:
            if mcp_response.status != 200:
                raise RuntimeError(f"MCP health check returned HTTP {mcp_response.status}.")
        dependencies["mcp_server"] = "up"
        return {"status": "ready", "dependencies": dependencies}
    except Exception:
        logger.exception("readiness check failed")
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "not_ready", "dependencies": dependencies}


@app.post("/agent/ingestion/process", tags=["rag"])
def process_document(
    payload: IngestionRequest, x_internal_token: str | None = Header(default=None)
) -> dict[str, object]:
    require_internal_token(x_internal_token)
    try:
        return ingest_document(str(payload.document_id), str(payload.user_id), settings)
    except LookupError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error


@app.post("/agent/retrieval/search", tags=["rag"])
def search_documents(
    payload: RetrievalRequest, x_internal_token: str | None = Header(default=None)
) -> dict[str, object]:
    require_internal_token(x_internal_token)
    try:
        return {
            "matches": retrieve(
                payload.query,
                str(payload.user_id),
                payload.top_k,
                str(payload.document_id) if payload.document_id else None,
                settings,
            )
        }
    except Exception as error:
        logger.exception("document retrieval failed", extra={"user_id": str(payload.user_id)})
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error


@app.post("/agent/chat/stream", tags=["agent"])
async def stream_chat(
    payload: ChatStreamRequest, x_internal_token: str | None = Header(default=None)
) -> StreamingResponse:
    require_internal_token(x_internal_token)
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Message cannot be blank.")

    try:
        started = await asyncio.to_thread(
            start_turn,
            str(payload.conversation_id),
            str(payload.user_id),
            message,
            settings.agent_history_messages,
        )
    except LookupError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error

    async def event_stream():
        yield sse_event(
            "start",
            {
                "conversationId": str(payload.conversation_id),
                "userMessageId": started.user_message_id,
            },
        )
        try:
            async for event in agent_provider.stream_reply(
                user_id=str(payload.user_id),
                conversation_id=str(payload.conversation_id),
                history=started.history,
            ):
                if event.kind == "delta" and event.delta:
                    yield sse_event("delta", {"delta": event.delta})
                    continue
                if event.kind != "completed" or event.completion is None:
                    continue

                completion = event.completion
                assistant_message_id = await asyncio.to_thread(
                    complete_turn,
                    str(payload.conversation_id),
                    completion.content,
                    completion.model,
                    completion.usage,
                    completion.tool_calls,
                    completion.citations,
                )
                yield sse_event(
                    "done",
                    {
                        "assistantMessageId": assistant_message_id,
                        "content": completion.content,
                        "model": completion.model,
                        "usage": completion.usage,
                        "citations": completion.citations,
                    },
                )
        except asyncio.CancelledError:
            logger.info(
                "chat stream cancelled",
                extra={"user_id": str(payload.user_id), "conversation_id": str(payload.conversation_id)},
            )
            raise
        except Exception:
            logger.exception(
                "chat stream failed",
                extra={"user_id": str(payload.user_id), "conversation_id": str(payload.conversation_id)},
            )
            yield sse_event(
                "error",
                {"code": "agent_unavailable", "message": "The agent could not complete this response."},
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/agent/workflows/execute", tags=["workflows"])
async def run_workflow(
    payload: WorkflowExecutionRequest,
    x_internal_token: str | None = Header(default=None),
) -> dict[str, object]:
    require_internal_token(x_internal_token)
    return await execute_workflow(payload, settings)
