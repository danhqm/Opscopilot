import secrets
from uuid import UUID

from mcp.server.mcpserver import Context

from .config import Settings


def require_user_id(ctx: Context, settings: Settings) -> str:
    """Trust tenant headers only after authenticating the internal service caller."""
    headers = {key.lower(): value for key, value in (ctx.headers or {}).items()}
    token = headers.get("x-internal-token")
    if token is None or not secrets.compare_digest(token, settings.internal_api_token):
        raise PermissionError("Invalid internal service token.")

    raw_user_id = headers.get("x-user-id", "")
    try:
        return str(UUID(raw_user_id))
    except ValueError as error:
        raise PermissionError("A valid user identity is required.") from error
