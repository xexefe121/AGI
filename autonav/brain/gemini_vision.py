"""Gemini multimodal vision reasoning for navigation decisions."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import json
import re
from typing import Any, Deque, Dict, List, Optional

import requests

from autonav.config import GeminiConfig, load_gemini_config


_ALLOWED_ACTIONS = {"steer_left", "steer_right", "slow_down", "stop", "continue", "turn_around"}


@dataclass(frozen=True)
class VisionObstacle:
    type: str
    direction: str
    severity: str


@dataclass(frozen=True)
class VisionDecision:
    scene_description: str
    obstacles: List[VisionObstacle]
    action: str
    yaw_adjustment: float
    speed_factor: float
    reasoning: str
    raw_text: str

    def brief(self) -> str:
        return f"{self.action} | yaw={self.yaw_adjustment:.2f} | speed={self.speed_factor:.2f} | {self.scene_description}"


def _extract_json_object(text: str) -> Dict[str, Any]:
    if not text:
        return {}
    stripped = text.strip()
    if stripped.startswith("{"):
        try:
            value = json.loads(stripped)
            return value if isinstance(value, dict) else {}
        except json.JSONDecodeError:
            pass
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return {}
    try:
        value = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _extract_message_text(data: Dict[str, Any]) -> str:
    choices = data.get("choices", []) if isinstance(data, dict) else []
    if not choices:
        return ""
    message = choices[0].get("message", {})
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)
    return ""


def _coerce_float(value: Any, default: float) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    if not (out == out):  # NaN check
        return default
    return out


class GeminiVisionBrain:
    def __init__(
        self,
        config: GeminiConfig | None = None,
        session: requests.Session | None = None,
        memory_size: int = 6,
    ) -> None:
        self.config = config or load_gemini_config()
        self.session = session or requests.Session()
        self._memory: Deque[str] = deque(maxlen=max(1, memory_size))

    def analyze_frame(
        self,
        *,
        image_base64: str,
        robot_state: Dict[str, Any],
        terrain_probe: Optional[Dict[str, Any]] = None,
    ) -> VisionDecision:
        if not self.config.api_key:
            raise ValueError("GEMINI_API_KEY is not set.")

        image_data = image_base64.strip()
        if image_data.startswith("data:image"):
            image_url = image_data
        else:
            image_url = f"data:image/jpeg;base64,{image_data}"

        system_prompt = (
            "You are the brain of an autonomous humanoid robot navigating a real-world environment. "
            "Analyze the camera image and decide safe navigation adjustments. "
            "Respond with JSON only with keys: "
            "scene_description, obstacles, action, yaw_adjustment, speed_factor, reasoning."
        )
        memory_text = "\n".join(self._memory) if self._memory else "none"
        terrain_text = json.dumps(terrain_probe or {}, separators=(",", ":"))[:1200]
        robot_text = json.dumps(robot_state, separators=(",", ":"))
        user_prompt = (
            "Robot state:\n"
            f"{robot_text}\n"
            "Recent decisions:\n"
            f"{memory_text}\n"
            "Recent terrain probe (optional):\n"
            f"{terrain_text}\n"
            "Pick exactly one action from: steer_left, steer_right, slow_down, stop, continue, turn_around. "
            "Keep yaw_adjustment in radians (-0.8..0.8) and speed_factor (0.0..1.2)."
        )

        payload = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                },
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
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
        raw_text = _extract_message_text(data)
        parsed = _extract_json_object(raw_text)

        scene_description = str(parsed.get("scene_description") or "Scene unclear")
        reasoning = str(parsed.get("reasoning") or "")
        raw_action = str(parsed.get("action") or "continue").strip().lower()
        action = raw_action if raw_action in _ALLOWED_ACTIONS else "continue"
        yaw_adjustment = max(-0.8, min(0.8, _coerce_float(parsed.get("yaw_adjustment"), 0.0)))
        speed_factor = max(0.0, min(1.2, _coerce_float(parsed.get("speed_factor"), 1.0)))

        obstacles: List[VisionObstacle] = []
        raw_obstacles = parsed.get("obstacles", [])
        if isinstance(raw_obstacles, list):
            for item in raw_obstacles:
                if not isinstance(item, dict):
                    continue
                obstacles.append(
                    VisionObstacle(
                        type=str(item.get("type", "unknown")),
                        direction=str(item.get("direction", "unknown")),
                        severity=str(item.get("severity", "unknown")),
                    )
                )

        decision = VisionDecision(
            scene_description=scene_description,
            obstacles=obstacles,
            action=action,
            yaw_adjustment=yaw_adjustment,
            speed_factor=speed_factor,
            reasoning=reasoning,
            raw_text=raw_text,
        )
        self._memory.append(decision.brief())
        return decision

