from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select

from .database import ConversationRecord, MessageRecord, SessionLocal


@dataclass(frozen=True)
class StartedTurn:
    user_message_id: str
    history: list[dict[str, str]]


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def start_turn(
    conversation_id: str,
    user_id: str,
    content: str,
    history_limit: int,
) -> StartedTurn:
    """Verify ownership, persist the user turn, and return bounded model history."""
    with SessionLocal() as session, session.begin():
        conversation = session.scalar(
            select(ConversationRecord)
            .where(ConversationRecord.id == conversation_id, ConversationRecord.user_id == user_id)
            .with_for_update()
        )
        if conversation is None:
            raise LookupError("Conversation not found.")

        now = _now()
        message_id = str(uuid4())
        session.add(
            MessageRecord(
                id=message_id,
                conversation_id=conversation_id,
                role="USER",
                content=content,
                tool_calls_json=None,
                model=None,
                input_tokens=None,
                output_tokens=None,
                total_tokens=None,
                created_at=now,
            )
        )
        conversation.updated_at = now
        session.flush()

        recent = list(
            session.scalars(
                select(MessageRecord)
                .where(
                    MessageRecord.conversation_id == conversation_id,
                    MessageRecord.role.in_(["USER", "ASSISTANT"]),
                )
                .order_by(MessageRecord.created_at.desc(), MessageRecord.id.desc())
                .limit(max(2, history_limit))
            ).all()
        )

    history = [
        {"role": message.role.lower(), "content": message.content}
        for message in reversed(recent)
    ]
    return StartedTurn(user_message_id=message_id, history=history)


def complete_turn(
    conversation_id: str,
    content: str,
    model: str,
    usage: dict[str, int],
    tool_calls: list[dict[str, object]],
    citations: list[dict[str, object]],
) -> str:
    """Persist a completed assistant message and its auditable usage/tool metadata."""
    with SessionLocal() as session, session.begin():
        conversation = session.scalar(
            select(ConversationRecord).where(ConversationRecord.id == conversation_id).with_for_update()
        )
        if conversation is None:
            raise LookupError("Conversation not found.")

        now = _now()
        message_id = str(uuid4())
        session.add(
            MessageRecord(
                id=message_id,
                conversation_id=conversation_id,
                role="ASSISTANT",
                content=content,
                tool_calls_json={"tools": tool_calls, "citations": citations} if tool_calls or citations else None,
                model=model,
                input_tokens=usage["input_tokens"],
                output_tokens=usage["output_tokens"],
                total_tokens=usage["total_tokens"],
                created_at=now,
            )
        )
        conversation.updated_at = now

    return message_id
