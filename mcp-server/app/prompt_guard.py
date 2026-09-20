import re
import unicodedata
from dataclasses import dataclass


_INDICATOR_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "instruction_override",
        re.compile(r"\b(ignore|disregard|forget|override)\b.{0,60}\b(previous|prior|above|system|developer)\b", re.I | re.S),
    ),
    (
        "prompt_extraction",
        re.compile(r"\b(reveal|show|print|repeat|expose)\b.{0,60}\b(system|developer|hidden)\s+(prompt|instructions?)\b", re.I | re.S),
    ),
    (
        "role_reassignment",
        re.compile(r"\b(you are now|act as|pretend to be|new role)\b", re.I),
    ),
    (
        "tool_coercion",
        re.compile(r"\b(call|invoke|execute|run|use)\b.{0,50}\b(tool|function|create_task|send_webhook)\b", re.I | re.S),
    ),
    (
        "secret_exfiltration",
        re.compile(r"\b(reveal|send|upload|exfiltrate|leak|steal)\b.{0,70}\b(secret|api[ _-]?key|password|token|credential)\b", re.I | re.S),
    ),
)


@dataclass(frozen=True)
class GuardedText:
    content: str
    prompt_injection_suspected: bool
    indicators: tuple[str, ...]
    content_truncated: bool

    def security_metadata(self, trust: str) -> dict[str, object]:
        return {
            "trust": trust,
            "prompt_injection_suspected": self.prompt_injection_suspected,
            "indicators": list(self.indicators),
            "content_truncated": self.content_truncated,
        }


def _remove_invisible_controls(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    return "".join(
        character
        for character in normalized
        if character in "\n\r\t" or unicodedata.category(character) not in {"Cc", "Cf"}
    )


def guard_untrusted_text(value: str, *, max_chars: int = 12_000) -> GuardedText:
    sanitized = _remove_invisible_controls(value)
    truncated = len(sanitized) > max_chars
    content = sanitized[:max_chars]
    indicators = tuple(name for name, pattern in _INDICATOR_PATTERNS if pattern.search(content))
    return GuardedText(
        content=content,
        prompt_injection_suspected=bool(indicators),
        indicators=indicators,
        content_truncated=truncated,
    )


def guard_untrusted_structure(value: object, *, trust: str) -> tuple[object, dict[str, object]]:
    indicators: set[str] = set()
    truncated = False

    def visit(item: object) -> object:
        nonlocal truncated
        if isinstance(item, str):
            guarded = guard_untrusted_text(item)
            indicators.update(guarded.indicators)
            truncated = truncated or guarded.content_truncated
            return guarded.content
        if isinstance(item, dict):
            return {str(key): visit(child) for key, child in item.items()}
        if isinstance(item, list | tuple):
            return [visit(child) for child in item]
        return item

    sanitized = visit(value)
    ordered_indicators = sorted(indicators)
    return sanitized, {
        "trust": trust,
        "prompt_injection_suspected": bool(ordered_indicators),
        "indicators": ordered_indicators,
        "content_truncated": truncated,
    }
