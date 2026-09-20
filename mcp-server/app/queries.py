from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from sqlalchemy import Engine, text


QueryName = Literal["document_status_summary", "recent_tasks", "recent_workflow_runs"]

# SQL is selected only from this code-owned allow-list. The model can choose a
# template and bounded parameters, but can never supply SQL text or identifiers.
QUERY_TEMPLATES = {
    "document_status_summary": text(
        """
        SELECT status, COUNT(*) AS document_count
        FROM documents
        WHERE user_id = :user_id
        GROUP BY status
        ORDER BY status
        """
    ),
    "recent_tasks": text(
        """
        SELECT id, title, description, due_at, status, created_at
        FROM tasks
        WHERE user_id = :user_id
        ORDER BY created_at DESC
        LIMIT :limit
        """
    ),
    "recent_workflow_runs": text(
        """
        SELECT wr.id, w.name AS workflow_name, wr.status, wr.started_at, wr.finished_at, wr.created_at
        FROM workflow_runs AS wr
        INNER JOIN workflows AS w ON w.id = wr.workflow_id
        WHERE w.user_id = :user_id
        ORDER BY wr.created_at DESC
        LIMIT :limit
        """
    ),
}


def get_query_template(query_name: str):
    try:
        return QUERY_TEMPLATES[query_name]
    except KeyError as error:
        raise ValueError("Unknown query template.") from error


def _json_value(value: object) -> object:
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def run_query(engine: Engine, *, user_id: str, query_name: str, limit: int) -> list[dict[str, object]]:
    if not 1 <= limit <= 50:
        raise ValueError("limit must be between 1 and 50.")
    statement = get_query_template(query_name)
    with engine.connect() as connection:
        rows = connection.execute(statement, {"user_id": user_id, "limit": limit}).mappings().all()
    return [{key: _json_value(value) for key, value in row.items()} for row in rows]
