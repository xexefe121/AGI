"""Gemini client using the OpenAI-compatible Gemini endpoint."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Iterable, List, Tuple

import requests

from autonav.config import GeminiConfig, load_gemini_config


@dataclass(frozen=True)
class WaypointPlan:
    waypoints: List[Tuple[float, float]]
    notes: str


def _extract_json_array(text: str) -> list:
    text = text.strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
    match = re.search(r"\[[\s\S]*\]", text)
    if not match:
        return []
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return []


def _validate_waypoints(items: Iterable) -> List[Tuple[float, float]]:
    waypoints: List[Tuple[float, float]] = []
    for item in items:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        lat, lon = item
        try:
            lat_f = float(lat)
            lon_f = float(lon)
        except (TypeError, ValueError):
            continue
        if not (-90.0 <= lat_f <= 90.0 and -180.0 <= lon_f <= 180.0):
            continue
        waypoints.append((lat_f, lon_f))
    return waypoints


class GeminiClient:
    def __init__(self, config: GeminiConfig | None = None, session: requests.Session | None = None):
        self.config = config or load_gemini_config()
        self.session = session or requests.Session()

    def plan_waypoints(
        self,
        start_latlon: Tuple[float, float],
        goal_latlon: Tuple[float, float],
        max_waypoints: int = 12,
        context: str | None = None,
    ) -> WaypointPlan:
        if not self.config.api_key:
            raise ValueError("GEMINI_API_KEY is not set.")

        system_prompt = (
            "You are a route planner for a humanoid robot navigating over terrain. "
            "Return a JSON array of [lat, lon] waypoints. Do not include any extra text."
        )
        user_prompt = (
            f"Start: {start_latlon[0]:.6f}, {start_latlon[1]:.6f}. "
            f"Goal: {goal_latlon[0]:.6f}, {goal_latlon[1]:.6f}. "
            f"Max waypoints: {max_waypoints}."
        )
        if context:
            user_prompt += f" Context: {context}"

        payload = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.2,
        }
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }

        response = self.session.post(
            self.config.endpoint,
            headers=headers,
            json=payload,
            timeout=self.config.timeout_s,
        )
        response.raise_for_status()
        data = response.json()
        content = ""
        if isinstance(data, dict):
            choices = data.get("choices", [])
            if choices:
                message = choices[0].get("message", {})
                content = message.get("content", "")

        items = _extract_json_array(content)
        waypoints = _validate_waypoints(items)
        return WaypointPlan(waypoints=waypoints, notes=content)
