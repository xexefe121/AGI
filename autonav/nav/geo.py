"""Geodesic helpers and coordinate conversions."""

from __future__ import annotations

import math
from typing import Iterable, List, Tuple

EARTH_RADIUS_M = 6378137.0


def latlon_to_local_m(
    lat: float,
    lon: float,
    origin_lat: float,
    origin_lon: float,
) -> Tuple[float, float]:
    """
    Convert lat/lon to a local tangent-plane (east, north) in meters.
    Uses a simple equirectangular approximation suitable for small areas.
    """
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    origin_lat_rad = math.radians(origin_lat)
    origin_lon_rad = math.radians(origin_lon)

    x = (lon_rad - origin_lon_rad) * EARTH_RADIUS_M * math.cos(origin_lat_rad)
    y = (lat_rad - origin_lat_rad) * EARTH_RADIUS_M
    return x, y


def local_m_to_latlon(
    x_m: float,
    y_m: float,
    origin_lat: float,
    origin_lon: float,
) -> Tuple[float, float]:
    """
    Convert local tangent-plane meters (east, north) back to lat/lon.
    Uses the inverse of the equirectangular approximation.
    """
    origin_lat_rad = math.radians(origin_lat)
    lat = origin_lat + math.degrees(y_m / EARTH_RADIUS_M)
    lon = origin_lon + math.degrees(x_m / (EARTH_RADIUS_M * math.cos(origin_lat_rad)))
    return lat, lon


def interpolate_linear(
    start: Tuple[float, float],
    goal: Tuple[float, float],
    count: int,
) -> List[Tuple[float, float]]:
    if count < 2:
        return [start, goal]
    lat0, lon0 = start
    lat1, lon1 = goal
    points: List[Tuple[float, float]] = []
    for i in range(count):
        t = i / (count - 1)
        lat = lat0 + (lat1 - lat0) * t
        lon = lon0 + (lon1 - lon0) * t
        points.append((lat, lon))
    return points


def path_length_m(points_xy: Iterable[Tuple[float, float]]) -> float:
    points = list(points_xy)
    if len(points) < 2:
        return 0.0
    total = 0.0
    for a, b in zip(points, points[1:]):
        dx = b[0] - a[0]
        dy = b[1] - a[1]
        total += math.hypot(dx, dy)
    return total
