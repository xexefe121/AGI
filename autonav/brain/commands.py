"""Brain command definitions."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass(frozen=True)
class BrainCommand:
    name: str
    payload: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def status(cls, message: str) -> "BrainCommand":
        return cls("status", {"message": message})

    @classmethod
    def error(cls, message: str) -> "BrainCommand":
        return cls("error", {"message": message})

    @classmethod
    def set_plan(cls, plan: Any) -> "BrainCommand":
        return cls("set_plan", {"plan": plan})

    @classmethod
    def start_navigation(cls) -> "BrainCommand":
        return cls("start_navigation", {})

    def get(self, key: str, default: Any = None) -> Any:
        return self.payload.get(key, default)
