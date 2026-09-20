import pytest

from app.queries import QUERY_TEMPLATES, get_query_template


def test_database_query_allow_list_contains_only_named_templates() -> None:
    assert set(QUERY_TEMPLATES) == {
        "document_status_summary",
        "recent_tasks",
        "recent_workflow_runs",
    }
    for statement in QUERY_TEMPLATES.values():
        assert ":user_id" in str(statement)


def test_arbitrary_sql_is_rejected() -> None:
    with pytest.raises(ValueError, match="Unknown query template"):
        get_query_template("SELECT * FROM users")
