from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class IngestionRequest(StrictRequest):
    document_id: UUID
    user_id: UUID


class RetrievalRequest(StrictRequest):
    user_id: UUID
    query: str = Field(min_length=1, max_length=2_000)
    top_k: int = Field(default=5, ge=1, le=20)
    document_id: UUID | None = None


class ChatStreamRequest(StrictRequest):
    user_id: UUID
    conversation_id: UUID
    message: str = Field(min_length=1, max_length=8_000)


class WorkflowAgentStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_-]*$")
    type: Literal["agent"]
    prompt: str = Field(min_length=1, max_length=8_000)


class WorkflowToolStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_-]*$")
    type: Literal["tool"]
    tool: Literal["query_database", "search_documents", "send_webhook", "create_task"]
    arguments: dict[str, Any]


WorkflowStep = Annotated[WorkflowAgentStep | WorkflowToolStep, Field(discriminator="type")]


class WorkflowExecutionRequest(StrictRequest):

    user_id: UUID
    workflow_id: UUID
    run_id: UUID
    steps: list[WorkflowStep] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def unique_step_ids(self) -> "WorkflowExecutionRequest":
        ids = [step.id for step in self.steps]
        if len(ids) != len(set(ids)):
            raise ValueError("Workflow step IDs must be unique.")
        return self
