from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "mysql+pymysql://ops_copilot:change-me-local@localhost:3306/ops_copilot"
    chroma_url: str = "http://localhost:8000"
    openai_api_key: str = ""
    openai_embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    internal_api_token: str = "replace-with-an-internal-service-token"
    webhook_timeout_seconds: float = 10.0
    service_version: str = "0.4.0"


@lru_cache
def get_settings() -> Settings:
    return Settings()
