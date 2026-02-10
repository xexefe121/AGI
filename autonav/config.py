"""Configuration helpers for the autonomous navigation stack."""

from __future__ import annotations

from dataclasses import dataclass
import os


DEFAULT_GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview"
DEFAULT_GOOGLE_MAPS_DIRECTIONS_ENDPOINT = "https://maps.googleapis.com/maps/api/directions/json"


@dataclass(frozen=True)
class GeminiConfig:
    api_key: str
    model: str = DEFAULT_GEMINI_MODEL
    endpoint: str = DEFAULT_GEMINI_ENDPOINT
    timeout_s: int = 60


@dataclass(frozen=True)
class GoogleMapsConfig:
    api_key: str
    directions_endpoint: str = DEFAULT_GOOGLE_MAPS_DIRECTIONS_ENDPOINT
    timeout_s: int = 20


@dataclass(frozen=True)
class ProjectPaths:
    legged_gym_root: str


def load_dotenv(path: str | None = None) -> None:
    """Load environment variables from a .env file if present."""
    env_path = path or os.path.join(os.getcwd(), ".env")
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path, "r", encoding="utf-8") as handle:
            for line in handle:
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or "=" not in stripped:
                    continue
                key, value = stripped.split("=", 1)
                key = key.strip()
                value = value.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        return


def load_gemini_config() -> GeminiConfig:
    return GeminiConfig(
        api_key=os.environ.get("GEMINI_API_KEY", "").strip(),
        model=os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip(),
        endpoint=os.environ.get("GEMINI_ENDPOINT", DEFAULT_GEMINI_ENDPOINT).strip(),
        timeout_s=int(os.environ.get("GEMINI_TIMEOUT_S", "60")),
    )


def load_google_maps_config() -> GoogleMapsConfig:
    return GoogleMapsConfig(
        api_key=os.environ.get("GOOGLE_MAPS_API_KEY", "").strip(),
        directions_endpoint=os.environ.get(
            "GOOGLE_MAPS_DIRECTIONS_ENDPOINT",
            DEFAULT_GOOGLE_MAPS_DIRECTIONS_ENDPOINT,
        ).strip(),
        timeout_s=int(os.environ.get("GOOGLE_MAPS_TIMEOUT_S", "20")),
    )


def load_project_paths() -> ProjectPaths:
    legged_gym_root = os.environ.get(
        "LEGGED_GYM_ROOT_DIR",
        os.path.join(os.getcwd(), "third_party", "unitree_rl_gym"),
    )
    return ProjectPaths(legged_gym_root=legged_gym_root)
