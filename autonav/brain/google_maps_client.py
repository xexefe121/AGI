"""Google Maps walking directions client."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import List, Tuple

import requests

from autonav.config import GoogleMapsConfig, load_google_maps_config


@dataclass(frozen=True)
class WalkingRoute:
    start_latlon: Tuple[float, float]
    goal_latlon: Tuple[float, float]
    waypoints: List[Tuple[float, float]]
    distance_m: float
    duration_s: float
    summary: str


def _haversine_m(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    sin_dlat = math.sin(dlat / 2.0)
    sin_dlon = math.sin(dlon / 2.0)
    h = sin_dlat * sin_dlat + math.cos(lat1) * math.cos(lat2) * sin_dlon * sin_dlon
    return 2.0 * 6378137.0 * math.asin(min(1.0, math.sqrt(h)))


def _decode_polyline(encoded: str) -> List[Tuple[float, float]]:
    points: List[Tuple[float, float]] = []
    index = 0
    lat = 0
    lon = 0

    while index < len(encoded):
        shift = 0
        result = 0
        while True:
            if index >= len(encoded):
                return points
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break
        delta_lat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat += delta_lat

        shift = 0
        result = 0
        while True:
            if index >= len(encoded):
                return points
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break
        delta_lon = ~(result >> 1) if (result & 1) else (result >> 1)
        lon += delta_lon

        points.append((lat / 1e5, lon / 1e5))
    return points


def _dedupe_adjacent(points: List[Tuple[float, float]], eps: float = 1e-9) -> List[Tuple[float, float]]:
    if not points:
        return []
    out = [points[0]]
    for lat, lon in points[1:]:
        plat, plon = out[-1]
        if abs(lat - plat) <= eps and abs(lon - plon) <= eps:
            continue
        out.append((lat, lon))
    return out


def densify_path(points: List[Tuple[float, float]], max_gap_m: float = 5.0) -> List[Tuple[float, float]]:
    if len(points) < 2:
        return points[:]
    if max_gap_m <= 0:
        return points[:]

    dense: List[Tuple[float, float]] = [points[0]]
    for start, goal in zip(points, points[1:]):
        distance = _haversine_m(start, goal)
        if distance > max_gap_m:
            steps = int(math.ceil(distance / max_gap_m))
            for i in range(1, steps):
                t = i / steps
                dense.append(
                    (
                        start[0] + (goal[0] - start[0]) * t,
                        start[1] + (goal[1] - start[1]) * t,
                    )
                )
        dense.append(goal)
    return _dedupe_adjacent(dense)


def _location_to_latlon(value: object, fallback: Tuple[float, float]) -> Tuple[float, float]:
    if not isinstance(value, dict):
        return fallback
    lat = value.get("lat")
    lon = value.get("lng")
    if lat is None or lon is None:
        return fallback
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError):
        return fallback
    if not (-90.0 <= lat_f <= 90.0 and -180.0 <= lon_f <= 180.0):
        return fallback
    return lat_f, lon_f


class GoogleMapsClient:
    def __init__(self, config: GoogleMapsConfig | None = None, session: requests.Session | None = None):
        self.config = config or load_google_maps_config()
        self.session = session or requests.Session()

    def get_walking_directions(
        self,
        start_latlon: Tuple[float, float],
        goal_latlon: Tuple[float, float],
        *,
        max_gap_m: float = 2.0,
    ) -> WalkingRoute:
        if not self.config.api_key:
            raise ValueError("GOOGLE_MAPS_API_KEY is not set.")

        params = {
            "origin": f"{start_latlon[0]:.8f},{start_latlon[1]:.8f}",
            "destination": f"{goal_latlon[0]:.8f},{goal_latlon[1]:.8f}",
            "mode": "walking",
            "alternatives": "false",
            "key": self.config.api_key,
        }

        response = self.session.get(
            self.config.directions_endpoint,
            params=params,
            timeout=self.config.timeout_s,
        )
        response.raise_for_status()
        data = response.json()
        status = str(data.get("status", "")).upper()
        if status != "OK":
            error_message = data.get("error_message") or "No route returned."
            raise ValueError(f"Google Maps Directions status={status}: {error_message}")

        routes = data.get("routes", [])
        if not routes:
            raise ValueError("Google Maps returned no routes.")
        route = routes[0]

        legs = route.get("legs", []) if isinstance(route.get("legs", []), list) else []
        route_start = start_latlon
        route_goal = goal_latlon
        step_points: List[Tuple[float, float]] = []
        if legs:
            route_start = _location_to_latlon(legs[0].get("start_location"), start_latlon)
            route_goal = _location_to_latlon(legs[-1].get("end_location"), goal_latlon)
            for leg in legs:
                steps = leg.get("steps", [])
                if not isinstance(steps, list):
                    continue
                for step in steps:
                    if not isinstance(step, dict):
                        continue
                    polyline = step.get("polyline", {})
                    if not isinstance(polyline, dict):
                        continue
                    encoded = str(polyline.get("points", "") or "")
                    if not encoded:
                        continue
                    step_points.extend(_decode_polyline(encoded))

        if not step_points:
            overview = route.get("overview_polyline", {})
            encoded = str(overview.get("points", "")) if isinstance(overview, dict) else ""
            step_points = _decode_polyline(encoded) if encoded else []

        raw_path = [route_start]
        raw_path.extend(step_points)
        raw_path.append(route_goal)
        waypoints = densify_path(_dedupe_adjacent(raw_path), max_gap_m=max_gap_m)

        total_distance = 0.0
        total_duration = 0.0
        for leg in legs:
            distance = leg.get("distance", {})
            duration = leg.get("duration", {})
            if isinstance(distance, dict):
                total_distance += float(distance.get("value", 0.0) or 0.0)
            if isinstance(duration, dict):
                total_duration += float(duration.get("value", 0.0) or 0.0)

        return WalkingRoute(
            start_latlon=route_start,
            goal_latlon=route_goal,
            waypoints=waypoints,
            distance_m=total_distance,
            duration_s=total_duration,
            summary=str(route.get("summary", "")),
        )
