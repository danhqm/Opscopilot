# Phase 1 review checklist

## Happy path

1. Start the Compose stack and open `http://localhost:8080`.
2. Create an account with an email and a password of at least 10 characters.
3. Confirm the authenticated state shows the correct email.
4. Sign out, then sign back in with the same credentials.
5. Confirm `GET /api/ready` reports both MySQL and Redis as `up`.

## Failure cases

- Creating the same account twice returns `409 email_in_use`.
- A wrong password returns `401 invalid_credentials` without revealing whether an email exists.
- Invalid email or short password input returns a structured `400 validation_error`.
- Reusing a rotated refresh token returns `401 invalid_refresh`.
- An invalid bearer token returns `401 invalid_token`.

## Phase boundary

No document ingestion, embeddings, ChromaDB collections, agent chat, MCP tools, or scheduled execution is implemented yet. Their containers and schema boundaries exist only so subsequent phases extend the architecture without a rewrite.

