"""Aiohttp web server for Cesium visualization + WebSocket streaming."""

from __future__ import annotations

import asyncio
import json
import math
import os
import pathlib
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from aiohttp import WSMsgType, web

from autonav.brain.route_planner import RoutePlan, plan_route
from autonav.nav.geo import latlon_to_local_m, local_m_to_latlon
from autonav.nav.waypoint_follower import WaypointFollower

# Road-safe defaults near Sydney Opera House.
# Forecourt pedestrian node in front of the Opera House (OSM relation 17582116).
DEFAULT_DEMO_START = (-33.8582722, 151.2147663)
DEFAULT_DEMO_GOAL = (-33.8567844, 151.2152967)


def _env_flag(name: str) -> bool:
    value = os.environ.get(name, "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _env_latlon(name: str) -> Optional[Tuple[float, float]]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    parts = [p.strip() for p in raw.split(",")]
    if len(parts) != 2:
        return None
    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return None


@dataclass
class RouteSnapshot:
    start: Tuple[float, float]
    goal: Tuple[float, float]
    waypoints: List[Tuple[float, float]]
    notes: str
    source: str
    google_maps_requested: bool
    google_maps_used: bool
    warning: str
    distance_m: float
    duration_s: float
    summary: str
    route_source_verified: bool


class RouteState:
    def __init__(self, origin_latlon: Tuple[float, float]) -> None:
        self._lock = threading.Lock()
        self._origin = origin_latlon
        self._origin_offset_xy: Tuple[float, float] = (0.0, 0.0)
        self._current_pos_xy: Tuple[float, float] = (0.0, 0.0)
        self._snapshot: Optional[RouteSnapshot] = None
        self._waypoints_xy: List[Tuple[float, float]] = []
        self._follower: Optional[WaypointFollower] = None
        self._running: bool = False
        self._pending_sim_reset: Optional[Dict[str, Tuple[float, float]]] = None
        self._sim_speed_multiplier: float = 1.0

    @property
    def origin_latlon(self) -> Tuple[float, float]:
        return self._origin

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._running

    def start_navigation(self) -> None:
        with self._lock:
            self._running = self._follower is not None

    def stop_navigation(self) -> None:
        with self._lock:
            self._running = False

    def get_sim_speed_multiplier(self) -> float:
        with self._lock:
            return self._sim_speed_multiplier

    def set_sim_speed_multiplier(self, multiplier: float) -> float:
        options = (1.0, 2.0, 3.0, 5.0)
        value = float(multiplier) if multiplier else 1.0
        selected = min(options, key=lambda item: abs(item - value))
        with self._lock:
            self._sim_speed_multiplier = selected
            return self._sim_speed_multiplier

    def set_plan(self, plan: RoutePlan) -> None:
        with self._lock:
            self._snapshot = RouteSnapshot(
                start=plan.start_latlon,
                goal=plan.goal_latlon,
                waypoints=plan.waypoints,
                notes=plan.notes,
                source=str(getattr(plan, "source", "linear") or "linear"),
                google_maps_requested=bool(getattr(plan, "google_maps_requested", False)),
                google_maps_used=bool(getattr(plan, "google_maps_used", False)),
                warning=str(getattr(plan, "warning", "") or ""),
                distance_m=float(getattr(plan, "distance_m", 0.0) or 0.0),
                duration_s=float(getattr(plan, "duration_s", 0.0) or 0.0),
                summary=str(getattr(plan, "summary", "") or ""),
                route_source_verified=bool(getattr(plan, "route_source_verified", False)),
            )
            self._origin = plan.start_latlon
            self._origin_offset_xy = self._current_pos_xy
            self._waypoints_xy = []
            for lat, lon in plan.waypoints:
                x, y = latlon_to_local_m(lat, lon, plan.start_latlon[0], plan.start_latlon[1])
                self._waypoints_xy.append((x + self._origin_offset_xy[0], y + self._origin_offset_xy[1]))
            if len(self._waypoints_xy) >= 2:
                self._follower = WaypointFollower(self._waypoints_xy)
            else:
                self._follower = None
            self._running = False
            self._pending_sim_reset = None

    def request_sim_restart(self, *, start_navigation: bool = False) -> bool:
        with self._lock:
            if len(self._waypoints_xy) < 2:
                self._running = False
                self._pending_sim_reset = None
                return False
            # Recreate follower so navigation restarts from the beginning.
            self._follower = WaypointFollower(list(self._waypoints_xy))
            self._running = bool(start_navigation)
            self._pending_sim_reset = {
                "start_xy": self._waypoints_xy[0],
                "next_xy": self._waypoints_xy[1],
            }
            return True

    def consume_sim_restart_request(self) -> Optional[Dict[str, Tuple[float, float]]]:
        with self._lock:
            if self._pending_sim_reset is None:
                return None
            payload = dict(self._pending_sim_reset)
            self._pending_sim_reset = None
            return payload

    def get_snapshot(self) -> Optional[RouteSnapshot]:
        with self._lock:
            return self._snapshot

    def set_current_pos(self, pos_xy: Tuple[float, float]) -> None:
        with self._lock:
            self._current_pos_xy = pos_xy

    def get_navigation_context(self) -> Dict[str, Any]:
        with self._lock:
            offset_x, offset_y = self._origin_offset_xy
            origin_lat, origin_lon = self._origin
            current_pos_xy = self._current_pos_xy
            snapshot = self._snapshot
            follower = self._follower
            running = self._running

            current_latlon = local_m_to_latlon(
                current_pos_xy[0] - offset_x,
                current_pos_xy[1] - offset_y,
                origin_lat,
                origin_lon,
            )

            target_latlon: Optional[Tuple[float, float]] = None
            remaining_waypoints = 0
            if follower:
                target_xy = follower.get_target_waypoint()
                remaining_waypoints = follower.get_remaining_waypoint_count()
                target_latlon = local_m_to_latlon(
                    target_xy[0] - offset_x,
                    target_xy[1] - offset_y,
                    origin_lat,
                    origin_lon,
                )

            goal_latlon = snapshot.goal if snapshot else None

        return {
            "running": running,
            "current_latlon": current_latlon,
            "current_waypoint_latlon": target_latlon,
            "remaining_waypoints": remaining_waypoints,
            "goal_latlon": goal_latlon,
        }

    def local_to_latlon(self, pos_xy: Tuple[float, float]) -> Tuple[float, float]:
        with self._lock:
            offset_x, offset_y = self._origin_offset_xy
            origin_lat, origin_lon = self._origin
        return local_m_to_latlon(
            pos_xy[0] - offset_x,
            pos_xy[1] - offset_y,
            origin_lat,
            origin_lon,
        )

    def latlon_to_local(self, latlon: Tuple[float, float]) -> Tuple[float, float]:
        lat = float(latlon[0])
        lon = float(latlon[1])
        with self._lock:
            offset_x, offset_y = self._origin_offset_xy
            origin_lat, origin_lon = self._origin
        x, y = latlon_to_local_m(lat, lon, origin_lat, origin_lon)
        return x + offset_x, y + offset_y

    def update_follower(self, pos_xy: Tuple[float, float], yaw_rad: float) -> Tuple[float, float, float, bool]:
        with self._lock:
            if not self._running:
                return 0.0, 0.0, 0.0, True
            if not self._follower:
                self._running = False
                return 0.0, 0.0, 0.0, True
            cmd_x, cmd_y, cmd_yaw, done = self._follower.update(pos_xy, yaw_rad)
            if done:
                self._running = False
            return cmd_x, cmd_y, cmd_yaw, done

    def get_route_follow_metrics(
        self,
        pos_xy: Tuple[float, float],
        *,
        off_route_threshold_m: float = 3.0,
    ) -> Dict[str, Any]:
        with self._lock:
            waypoints_xy = list(self._waypoints_xy)
        if len(waypoints_xy) < 2:
            return {
                "crossTrackErrorM": 0.0,
                "progressPct": 0.0,
                "offRoute": False,
            }

        px, py = float(pos_xy[0]), float(pos_xy[1])
        best_dist = float("inf")
        best_along = 0.0
        cumulative = 0.0
        total = 0.0

        segment_lengths: List[float] = []
        for i in range(len(waypoints_xy) - 1):
            ax, ay = waypoints_xy[i]
            bx, by = waypoints_xy[i + 1]
            seg_len = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
            segment_lengths.append(seg_len)
            total += seg_len

        if total <= 1e-6:
            return {
                "crossTrackErrorM": 0.0,
                "progressPct": 100.0,
                "offRoute": False,
            }

        for i in range(len(waypoints_xy) - 1):
            ax, ay = waypoints_xy[i]
            bx, by = waypoints_xy[i + 1]
            dx = bx - ax
            dy = by - ay
            seg_len = segment_lengths[i]
            if seg_len <= 1e-6:
                continue
            seg_len_sq = seg_len * seg_len
            t = ((px - ax) * dx + (py - ay) * dy) / seg_len_sq
            if t < 0.0:
                t = 0.0
            elif t > 1.0:
                t = 1.0
            proj_x = ax + t * dx
            proj_y = ay + t * dy
            dist = ((px - proj_x) ** 2 + (py - proj_y) ** 2) ** 0.5
            along = cumulative + (t * seg_len)
            if dist < best_dist:
                best_dist = dist
                best_along = along
            cumulative += seg_len

        progress_pct = max(0.0, min(100.0, (best_along / total) * 100.0))
        return {
            "crossTrackErrorM": float(best_dist if math.isfinite(best_dist) else 0.0),
            "progressPct": float(progress_pct),
            "offRoute": bool(best_dist > max(0.5, off_route_threshold_m)),
        }


class PoseHub:
    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self._clients: set[web.WebSocketResponse] = set()
        self._lock = asyncio.Lock()
        self._thread_lock = threading.Lock()
        self._latest_payload: Optional[Dict[str, Any]] = None
        self._drain_scheduled: bool = False

    async def register(self, ws: web.WebSocketResponse) -> None:
        async with self._lock:
            self._clients.add(ws)

    async def unregister(self, ws: web.WebSocketResponse) -> None:
        async with self._lock:
            self._clients.discard(ws)

    async def broadcast(self, payload: Dict[str, Any]) -> None:
        async with self._lock:
            if not self._clients:
                return
            data = json.dumps(payload)
            to_remove = []
            for ws in self._clients:
                if ws.closed:
                    to_remove.append(ws)
                    continue
                try:
                    await ws.send_str(data)
                except ConnectionResetError:
                    to_remove.append(ws)
            for ws in to_remove:
                self._clients.discard(ws)

    async def _drain_latest(self) -> None:
        while True:
            payload: Optional[Dict[str, Any]]
            with self._thread_lock:
                payload = self._latest_payload
                self._latest_payload = None
            if payload is None:
                with self._thread_lock:
                    if self._latest_payload is None:
                        self._drain_scheduled = False
                        return
                continue
            try:
                await self.broadcast(payload)
            except Exception:
                pass

    def broadcast_from_thread(self, payload: Dict[str, Any]) -> None:
        with self._thread_lock:
            self._latest_payload = payload
            if self._drain_scheduled:
                return
            self._drain_scheduled = True
        try:
            self._loop.call_soon_threadsafe(lambda: asyncio.create_task(self._drain_latest()))
        except RuntimeError:
            with self._thread_lock:
                self._drain_scheduled = False

    def broadcast_event_from_thread(self, payload: Dict[str, Any]) -> None:
        try:
            self._loop.call_soon_threadsafe(lambda: asyncio.create_task(self.broadcast(payload)))
        except RuntimeError:
            return


class PerceptionHub:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latest_frame: Optional[Dict[str, Any]] = None
        self._latest_terrain: Optional[Dict[str, Any]] = None
        self._latest_terrain_seq: Optional[int] = None
        self._terrain_out_of_order = 0
        self._latest_dynamic_obstacles: Optional[Dict[str, Any]] = None
        self._latest_dynamic_obstacles_seq: Optional[int] = None
        self._dynamic_out_of_order = 0

    def update_camera_frame(self, image: str, payload: Dict[str, Any] | None = None) -> None:
        if not image:
            return
        now = time.time()
        item = {
            "t": now,
            "image": image,
        }
        if payload:
            robot = payload.get("robot")
            if isinstance(robot, dict):
                item["robot"] = robot
        with self._lock:
            self._latest_frame = item

    def update_terrain_probe(self, payload: Dict[str, Any]) -> bool:
        now = time.time()
        raw_seq = payload.get("seq")
        seq: Optional[int]
        try:
            seq = int(raw_seq) if raw_seq is not None else None
        except (TypeError, ValueError):
            seq = None
        probe = {
            "t": now,
            "baseHeightM": payload.get("baseHeightM"),
            "samples": payload.get("samples", []),
            "robot": payload.get("robot"),
            "seq": seq,
            "capturedAtMs": payload.get("capturedAtMs"),
        }
        with self._lock:
            if seq is not None and self._latest_terrain_seq is not None and seq <= self._latest_terrain_seq:
                self._terrain_out_of_order += 1
                return False
            if seq is not None:
                self._latest_terrain_seq = seq
            self._latest_terrain = probe
        return True

    def get_latest_frame(self, max_age_s: float | None = None) -> Optional[Dict[str, Any]]:
        with self._lock:
            frame = dict(self._latest_frame) if self._latest_frame else None
        if not frame:
            return None
        if max_age_s is not None and (time.time() - float(frame.get("t", 0.0))) > max_age_s:
            return None
        return frame

    def get_latest_terrain(self, max_age_s: float | None = None) -> Optional[Dict[str, Any]]:
        with self._lock:
            terrain = dict(self._latest_terrain) if self._latest_terrain else None
            out_of_order = int(self._terrain_out_of_order)
        if not terrain:
            return None
        if max_age_s is not None and (time.time() - float(terrain.get("t", 0.0))) > max_age_s:
            return None
        terrain["outOfOrderDrops"] = out_of_order
        return terrain

    def update_dynamic_obstacles(self, payload: Dict[str, Any]) -> bool:
        now = time.time()
        raw_seq = payload.get("seq")
        seq: Optional[int]
        try:
            seq = int(raw_seq) if raw_seq is not None else None
        except (TypeError, ValueError):
            seq = None
        obstacles = payload.get("obstacles")
        if not isinstance(obstacles, list):
            return False
        item = {
            "t": now,
            "capturedAtMs": payload.get("capturedAtMs"),
            "seq": seq,
            "obstacles": obstacles,
        }
        with self._lock:
            if (
                seq is not None
                and self._latest_dynamic_obstacles_seq is not None
                and seq <= self._latest_dynamic_obstacles_seq
            ):
                self._dynamic_out_of_order += 1
                return False
            if seq is not None:
                self._latest_dynamic_obstacles_seq = seq
            self._latest_dynamic_obstacles = item
        return True

    def get_latest_dynamic_obstacles(self, max_age_s: float | None = None) -> Optional[Dict[str, Any]]:
        with self._lock:
            item = dict(self._latest_dynamic_obstacles) if self._latest_dynamic_obstacles else None
            out_of_order = int(self._dynamic_out_of_order)
        if not item:
            return None
        if max_age_s is not None and (time.time() - float(item.get("t", 0.0))) > max_age_s:
            return None
        item["outOfOrderDrops"] = out_of_order
        return item


async def _handle_config(request: web.Request) -> web.Response:
    route_state: RouteState = request.app["route_state"]
    snapshot = route_state.get_snapshot()
    ws_scheme = "wss" if request.secure else "ws"
    ws_url = f"{ws_scheme}://{request.host}/ws"
    payload: Dict[str, Any] = {
        "cesiumToken": os.environ.get("CESIUM_ION_TOKEN", "").strip(),
        "wsPath": "/ws",
        "wsUrl": ws_url,
        "photorealistic": _env_flag("CESIUM_PHOTOREALISTIC"),
        "simulationSpeed": route_state.get_sim_speed_multiplier(),
    }
    if snapshot:
        payload.update(
            {
                "start": list(snapshot.start),
                "goal": list(snapshot.goal),
                "waypoints": [list(wp) for wp in snapshot.waypoints],
                "notes": snapshot.notes,
                "source": snapshot.source,
                "googleMapsRequested": snapshot.google_maps_requested,
                "googleMapsUsed": snapshot.google_maps_used,
                "warning": snapshot.warning,
                "distanceM": snapshot.distance_m,
                "durationS": snapshot.duration_s,
                "summary": snapshot.summary,
                "routeSourceVerified": snapshot.route_source_verified,
            }
        )
    return web.json_response(payload)


async def _handle_get_route(request: web.Request) -> web.Response:
    route_state: RouteState = request.app["route_state"]
    snapshot = route_state.get_snapshot()
    if not snapshot:
        return web.json_response({"waypoints": []})
    return web.json_response(
        {
            "start": list(snapshot.start),
            "goal": list(snapshot.goal),
            "waypoints": [list(wp) for wp in snapshot.waypoints],
            "notes": snapshot.notes,
            "source": snapshot.source,
            "googleMapsRequested": snapshot.google_maps_requested,
            "googleMapsUsed": snapshot.google_maps_used,
            "warning": snapshot.warning,
            "distanceM": snapshot.distance_m,
            "durationS": snapshot.duration_s,
            "summary": snapshot.summary,
            "routeSourceVerified": snapshot.route_source_verified,
        }
    )


async def _handle_stop(request: web.Request) -> web.Response:
    route_state: RouteState = request.app["route_state"]
    route_state.stop_navigation()
    return web.json_response({"running": route_state.is_running})


async def _handle_start(request: web.Request) -> web.Response:
    route_state: RouteState = request.app["route_state"]
    body: Dict[str, Any] = {}
    if request.can_read_body:
        try:
            parsed = await request.json()
            if isinstance(parsed, dict):
                body = parsed
        except Exception:
            body = {}

    restart = bool(body.get("restart", True))
    if restart:
        if not route_state.request_sim_restart(start_navigation=True):
            route_state.start_navigation()
    else:
        route_state.start_navigation()
    return web.json_response({"running": route_state.is_running})


async def _handle_sim_speed(request: web.Request) -> web.Response:
    route_state: RouteState = request.app["route_state"]
    if request.method == "GET":
        return web.json_response({"multiplier": route_state.get_sim_speed_multiplier()})

    body: Dict[str, Any] = {}
    try:
        parsed = await request.json()
        if isinstance(parsed, dict):
            body = parsed
    except Exception:
        body = {}

    multiplier = body.get("multiplier", 1.0)
    try:
        selected = route_state.set_sim_speed_multiplier(float(multiplier))
    except (TypeError, ValueError):
        return web.json_response({"error": "Invalid speed multiplier."}, status=400)
    return web.json_response({"multiplier": selected})


async def _handle_plan(request: web.Request) -> web.Response:
    route_state: RouteState = request.app["route_state"]
    body = await request.json()

    prompt = (body.get("prompt") or "").strip() if isinstance(body, dict) else ""
    start = body.get("start") if isinstance(body, dict) else None
    goal = body.get("goal") if isinstance(body, dict) else None
    max_waypoints = int(body.get("waypoints", 12)) if isinstance(body, dict) else 12
    use_gemini = bool(body.get("useGemini", True)) if isinstance(body, dict) else True
    use_google_maps = bool(body.get("useGoogleMaps", True)) if isinstance(body, dict) else True
    gemini_api_key = (body.get("geminiApiKey") or "").strip() if isinstance(body, dict) else ""
    google_maps_api_key = (body.get("googleMapsApiKey") or "").strip() if isinstance(body, dict) else ""
    if gemini_api_key:
        os.environ["GEMINI_API_KEY"] = gemini_api_key
    if google_maps_api_key:
        os.environ["GOOGLE_MAPS_API_KEY"] = google_maps_api_key

    start_latlon = tuple(start) if start else None
    goal_latlon = tuple(goal) if goal else None
    demo_start = _env_latlon("DEFAULT_START_LATLON") or DEFAULT_DEMO_START
    demo_goal = _env_latlon("DEFAULT_GOAL_LATLON") or DEFAULT_DEMO_GOAL

    forced_start = _env_latlon("FORCE_START_LATLON")
    forced_goal = _env_latlon("FORCE_GOAL_LATLON")
    if forced_start is not None:
        start_latlon = forced_start
    if forced_goal is not None:
        goal_latlon = forced_goal

    if not prompt:
        if start_latlon is None and goal_latlon is None:
            start_latlon = demo_start
            goal_latlon = demo_goal
        elif start_latlon is None and goal_latlon is not None:
            start_latlon = demo_start
        elif start_latlon is not None and goal_latlon is None:
            goal_latlon = demo_goal

    try:
        plan_timeout_s = float(os.environ.get("PLAN_TIMEOUT_S", "45"))
        plan = await asyncio.wait_for(
            asyncio.to_thread(
                plan_route,
                prompt=prompt or None,
                start_latlon=start_latlon,
                goal_latlon=goal_latlon,
                max_waypoints=max_waypoints,
                use_google_maps=use_google_maps,
                use_gemini=use_gemini,
            ),
            timeout=plan_timeout_s,
        )
    except asyncio.TimeoutError:
        try:
            fallback = await asyncio.to_thread(
                plan_route,
                prompt=prompt or None,
                start_latlon=start_latlon,
                goal_latlon=goal_latlon,
                max_waypoints=max_waypoints,
                use_google_maps=use_google_maps,
                use_gemini=False,
            )
            plan = RoutePlan(
                start_latlon=fallback.start_latlon,
                goal_latlon=fallback.goal_latlon,
                waypoints=fallback.waypoints,
                notes=f"Gemini planning timed out after {plan_timeout_s:.0f}s. {fallback.notes}",
                source=fallback.source,
                google_maps_requested=fallback.google_maps_requested,
                google_maps_used=fallback.google_maps_used,
                warning=fallback.warning,
                distance_m=fallback.distance_m,
                duration_s=fallback.duration_s,
                summary=fallback.summary,
                route_source_verified=fallback.route_source_verified,
            )
        except Exception as exc:
            return web.json_response({"error": str(exc)}, status=400)
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=400)

    route_state.set_plan(plan)
    route_state.request_sim_restart(start_navigation=False)
    return web.json_response(
        {
            "start": list(plan.start_latlon),
            "goal": list(plan.goal_latlon),
            "waypoints": [list(wp) for wp in plan.waypoints],
            "notes": plan.notes,
            "source": plan.source,
            "googleMapsRequested": plan.google_maps_requested,
            "googleMapsUsed": plan.google_maps_used,
            "warning": plan.warning,
            "distanceM": plan.distance_m,
            "durationS": plan.duration_s,
            "summary": plan.summary,
            "routeSourceVerified": bool(getattr(plan, "route_source_verified", False)),
            "running": route_state.is_running,
        }
    )


async def _handle_ws(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    route_state: RouteState = request.app["route_state"]
    hub: PoseHub = request.app["pose_hub"]
    perception_hub: PerceptionHub = request.app["perception_hub"]
    last_terrain_drop_notice = 0.0
    last_dynamic_drop_notice = 0.0

    await hub.register(ws)
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                if msg.type in {WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED, WSMsgType.ERROR}:
                    break
                continue
            try:
                payload = json.loads(msg.data)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue

            message_type = str(payload.get("type", "")).strip().lower()
            if message_type == "camera_frame":
                image = payload.get("image")
                if isinstance(image, str) and image.strip():
                    perception_hub.update_camera_frame(image.strip(), payload)
            elif message_type == "terrain_probe":
                samples = payload.get("samples")
                if isinstance(samples, list):
                    accepted = perception_hub.update_terrain_probe(payload)
                    now = time.time()
                    if not accepted and (now - last_terrain_drop_notice) > 3.0:
                        last_terrain_drop_notice = now
                        await hub.broadcast(
                            {
                                "type": "status",
                                "message": "Dropped stale terrain probe frame (out-of-order sequence).",
                                "t": now,
                            }
                        )
            elif message_type == "dynamic_obstacles":
                accepted = perception_hub.update_dynamic_obstacles(payload)
                now = time.time()
                if not accepted and (now - last_dynamic_drop_notice) > 3.0:
                    last_dynamic_drop_notice = now
                    await hub.broadcast(
                        {
                            "type": "status",
                            "message": "Dropped stale dynamic obstacle frame (out-of-order sequence).",
                            "t": now,
                        }
                    )
            elif message_type == "session_start":
                if route_state.request_sim_restart(start_navigation=False):
                    await hub.broadcast(
                        {
                            "type": "status",
                            "message": "Browser session started: resetting MuJoCo at route start (paused).",
                            "t": time.time(),
                        }
                    )
                else:
                    await hub.broadcast(
                        {
                            "type": "status",
                            "message": "Browser session started: no active route to restart yet.",
                            "t": time.time(),
                        }
                    )
    finally:
        await hub.unregister(ws)
    return ws


def create_app(
    static_dir: str,
    route_state: RouteState,
    hub: PoseHub,
    perception_hub: PerceptionHub,
) -> web.Application:
    app = web.Application()
    app["route_state"] = route_state
    app["pose_hub"] = hub
    app["perception_hub"] = perception_hub

    app.router.add_get("/config", _handle_config)
    app.router.add_get("/api/route", _handle_get_route)
    app.router.add_post("/api/plan", _handle_plan)
    app.router.add_post("/api/start", _handle_start)
    app.router.add_post("/api/stop", _handle_stop)
    app.router.add_get("/api/sim/speed", _handle_sim_speed)
    app.router.add_post("/api/sim/speed", _handle_sim_speed)
    app.router.add_get("/ws", _handle_ws)

    static_path = pathlib.Path(static_dir)
    index_path = static_path / "index.html"
    if index_path.exists():
        app.router.add_get("/", lambda request: web.FileResponse(index_path))
    app.router.add_static("/", static_path, show_index=False)
    return app
