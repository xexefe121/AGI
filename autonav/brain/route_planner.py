"""Route planning helpers for prompt -> waypoint workflows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

from autonav.brain.gemini_client import GeminiClient
from autonav.brain.google_maps_client import GoogleMapsClient
from autonav.brain.geocode import geocode_nominatim
from autonav.brain.prompt_parser import extract_start_goal
from autonav.nav.geo import interpolate_linear, latlon_to_local_m


@dataclass
class RoutePlan:
    start_latlon: Tuple[float, float]
    goal_latlon: Tuple[float, float]
    waypoints: List[Tuple[float, float]]
    notes: str
    source: str = "linear"
    google_maps_requested: bool = False
    google_maps_used: bool = False
    warning: str = ""
    distance_m: float = 0.0
    duration_s: float = 0.0
    summary: str = ""
    route_source_verified: bool = False


def _normalize_latlon(value: Tuple[float, float]) -> Tuple[float, float]:
    lat, lon = float(value[0]), float(value[1])
    return lat, lon


def _estimate_path_distance_m(path: List[Tuple[float, float]]) -> float:
    if len(path) < 2:
        return 0.0
    origin_lat, origin_lon = path[0]
    total = 0.0
    prev_xy = latlon_to_local_m(path[0][0], path[0][1], origin_lat, origin_lon)
    for lat, lon in path[1:]:
        xy = latlon_to_local_m(lat, lon, origin_lat, origin_lon)
        total += ((xy[0] - prev_xy[0]) ** 2 + (xy[1] - prev_xy[1]) ** 2) ** 0.5
        prev_xy = xy
    return float(total)


def _is_polyline_consistent(
    start: Tuple[float, float],
    goal: Tuple[float, float],
    waypoints: List[Tuple[float, float]],
    *,
    tol_deg: float = 1.0e-4,
) -> bool:
    if len(waypoints) < 2:
        return False
    ws = waypoints[0]
    wg = waypoints[-1]
    return (
        abs(ws[0] - start[0]) <= tol_deg
        and abs(ws[1] - start[1]) <= tol_deg
        and abs(wg[0] - goal[0]) <= tol_deg
        and abs(wg[1] - goal[1]) <= tol_deg
    )


def plan_route(
    *,
    prompt: Optional[str],
    start_latlon: Optional[Tuple[float, float]],
    goal_latlon: Optional[Tuple[float, float]],
    max_waypoints: int = 12,
    use_google_maps: bool = True,
    use_gemini: bool = True,
    route_context: str | None = None,
) -> RoutePlan:
    start = start_latlon
    goal = goal_latlon

    if prompt and (start is None or goal is None):
        start_text, goal_text = extract_start_goal(prompt)
        if start is None and start_text:
            start = geocode_nominatim(start_text)
        if goal is None and goal_text:
            goal = geocode_nominatim(goal_text)

    if start is None or goal is None:
        raise ValueError("Start/goal coordinates could not be resolved. Provide explicit lat/lon or a prompt with 'from X to Y'.")

    start = _normalize_latlon(start)
    goal = _normalize_latlon(goal)

    waypoints: List[Tuple[float, float]] = []
    note_parts: List[str] = []
    warning_parts: List[str] = []
    source = "linear"
    google_maps_requested = bool(use_google_maps)
    google_maps_used = False
    distance_m = 0.0
    duration_s = 0.0
    summary = ""

    if use_google_maps:
        try:
            maps_client = GoogleMapsClient()
            walking_route = maps_client.get_walking_directions(start, goal, max_gap_m=2.0)
            start = walking_route.start_latlon
            goal = walking_route.goal_latlon
            waypoints = walking_route.waypoints
            source = "google_maps"
            google_maps_used = True
            distance_m = float(walking_route.distance_m)
            duration_s = float(walking_route.duration_s)
            summary = str(walking_route.summary or "")
            if walking_route.distance_m > 0:
                note_parts.append(
                    f"Google Maps walking route ({len(waypoints)} waypoints, {walking_route.distance_m:.0f}m)."
                )
            else:
                note_parts.append(f"Google Maps walking route ({len(waypoints)} waypoints).")
        except Exception as exc:
            message = f"Google Maps unavailable: {exc}"
            note_parts.append(message)
            warning_parts.append(message)

    if len(waypoints) < 2 and use_gemini:
        try:
            client = GeminiClient()
            plan = client.plan_waypoints(
                start,
                goal,
                max_waypoints=max_waypoints,
                context=route_context,
            )
            waypoints = plan.waypoints
            if len(waypoints) >= 2:
                source = "gemini"
            note_parts.append("Gemini waypoint plan.")
        except Exception as exc:
            note_parts.append(f"Gemini planning failed: {exc}")

    if len(waypoints) < 2:
        waypoints = interpolate_linear(start, goal, max_waypoints)
        source = "linear"
        note_parts.append("Linear fallback.")

    if google_maps_requested and not google_maps_used:
        warning_parts.append("Google Maps route not available, using fallback route source.")

    if waypoints:
        start = _normalize_latlon(waypoints[0])
        goal = _normalize_latlon(waypoints[-1])
        if distance_m <= 0.0:
            distance_m = _estimate_path_distance_m(waypoints)

    notes = " ".join(part.strip() for part in note_parts if part and part.strip())
    warning = " ".join(part.strip() for part in warning_parts if part and part.strip())
    polyline_consistent = _is_polyline_consistent(start, goal, waypoints)
    route_source_verified = False
    if source == "google_maps":
        route_source_verified = bool(google_maps_used and polyline_consistent)
    elif source == "gemini":
        route_source_verified = bool(polyline_consistent and not google_maps_used)
    elif source == "linear":
        route_source_verified = bool(polyline_consistent)

    return RoutePlan(
        start_latlon=start,
        goal_latlon=goal,
        waypoints=waypoints,
        notes=notes,
        source=source,
        google_maps_requested=google_maps_requested,
        google_maps_used=google_maps_used,
        warning=warning,
        distance_m=distance_m,
        duration_s=duration_s,
        summary=summary,
        route_source_verified=route_source_verified,
    )
