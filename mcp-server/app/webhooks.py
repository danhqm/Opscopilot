import asyncio
import ipaddress
import json
import socket
from urllib.parse import urlparse

import httpx


def validate_webhook_url_syntax(url: str) -> tuple[str, int]:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Webhook URL must use HTTP or HTTPS and include a hostname.")
    if parsed.username or parsed.password or parsed.fragment:
        raise ValueError("Webhook URL cannot include credentials or a fragment.")
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith(".localhost") or hostname.endswith(".local"):
        raise ValueError("Webhook URL cannot target a local host.")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as error:
        raise ValueError("Webhook URL contains an invalid port.") from error
    return hostname, port


def _is_public_address(value: str) -> bool:
    return ipaddress.ip_address(value).is_global


async def validate_webhook_destination(url: str) -> None:
    hostname, port = validate_webhook_url_syntax(url)
    addresses = await asyncio.get_running_loop().run_in_executor(
        None,
        lambda: socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM),
    )
    if not addresses:
        raise ValueError("Webhook hostname did not resolve.")
    if any(not _is_public_address(address[4][0]) for address in addresses):
        raise ValueError("Webhook URL cannot target private, loopback, or link-local networks.")


async def post_webhook(url: str, payload: dict[str, object], timeout_seconds: float) -> dict[str, object]:
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(encoded) > 32_768:
        raise ValueError("Webhook payload exceeds 32 KiB.")
    await validate_webhook_destination(url)
    async with httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=False) as client:
        response = await client.post(url, content=encoded, headers={"content-type": "application/json"})
    return {"delivered": response.is_success, "status_code": response.status_code}
