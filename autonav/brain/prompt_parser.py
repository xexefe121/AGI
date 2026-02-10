"""Prompt parsing utilities for route requests."""

from __future__ import annotations

import re
from typing import Optional, Tuple


_ROUTE_PATTERNS = [
    re.compile(r"from\s+(?P<start>.+?)\s+to\s+(?P<goal>.+)$", re.IGNORECASE),
    re.compile(r"go\s+to\s+(?P<goal>.+?)\s+from\s+(?P<start>.+)$", re.IGNORECASE),
    re.compile(r"navigate\s+to\s+(?P<goal>.+?)\s+from\s+(?P<start>.+)$", re.IGNORECASE),
]


def extract_start_goal(prompt: str) -> Tuple[Optional[str], Optional[str]]:
    prompt = (prompt or "").strip()
    if not prompt:
        return None, None
    for pattern in _ROUTE_PATTERNS:
        match = pattern.search(prompt)
        if not match:
            continue
        start = match.group("start").strip(" ,.")
        goal = match.group("goal").strip(" ,.")
        return start or None, goal or None
    return None, None
