"""Simple geocoding helpers."""

from __future__ import annotations

from typing import Optional, Tuple

import requests


class GeocodingError(RuntimeError):
    pass


def geocode_nominatim(query: str, timeout_s: int = 10) -> Tuple[float, float]:
    """
    Geocode a place name using Nominatim.

    Returns (lat, lon) on success; raises GeocodingError otherwise.
    """
    if not query:
        raise GeocodingError("Empty geocoding query")

    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "q": query,
        "format": "json",
        "limit": 1,
    }
    headers = {
        "User-Agent": "autonav/0.1 (local dev)",
    }
    response = requests.get(url, params=params, headers=headers, timeout=timeout_s)
    response.raise_for_status()
    data = response.json()
    if not data:
        raise GeocodingError(f"No results for '{query}'")
    lat = float(data[0]["lat"])
    lon = float(data[0]["lon"])
    return lat, lon
