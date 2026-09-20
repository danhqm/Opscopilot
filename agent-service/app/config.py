from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "mysql+pymysql://ops_copilot:change-me-local@localhost:3306/ops_copilot"
    chroma_url: str = "http://localhost:8000"
    mcp_server_url: str = "http://localhost:8100"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    embedding_batch_size: int = 64
    internal_api_token: str = "replace-with-an-internal-service-token"
    upload_dir: Path = Path("uploads")
    chunk_target_tokens: int = 700
    chunk_overlap_tokens: int = 100
    agent_history_messages: int = 24
    agent_max_turns: int = 8
    service_version: str = "0.5.0"


@lru_cache
def get_settings() -> Settings:
    return Settings()
