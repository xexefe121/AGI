"""Run MuJoCo + Cesium web server with WebSocket streaming."""

from __future__ import annotations

import argparse
import asyncio
import math
import os
import socket
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

if os.name == "nt" and hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# Road-safe defaults near Sydney Opera House.
# Forecourt pedestrian node in front of the Opera House (OSM relation 17582116).
DEFAULT_DEMO_START = (-33.8582722, 151.2147663)
DEFAULT_DEMO_GOAL = (-33.8567844, 151.2152967)

import mujoco

from aiohttp import web

from autonav.brain.brain import DEFAULT_MISSION_PROMPT, GeminiBrain
from autonav.brain.gemini_vision import GeminiVisionBrain
from autonav.config import load_dotenv, load_project_paths
from autonav.nav.obstacle_avoidance import ObstacleAvoidance
from autonav.sim.mujoco_g1 import G1MujocoRunner
from autonav.web.server import PerceptionHub, PoseHub, RouteState, create_app


def _default_legged_gym_root() -> str:
    candidates = [
        os.path.join(REPO_ROOT, "third_party", "unitree_rl_gym"),
        os.path.join(os.path.dirname(REPO_ROOT), "autonmousnav", "third_party", "unitree_rl_gym"),
        os.path.join(os.path.dirname(REPO_ROOT), "autunomousnav", "third_party", "unitree_rl_gym"),
        os.path.join(os.path.dirname(REPO_ROOT), "autonomousnav", "third_party", "unitree_rl_gym"),
    ]
    for candidate in candidates:
        if os.path.isdir(candidate):
            return candidate
    return candidates[0]


def _parse_latlon(value: str) -> Tuple[float, float]:
    parts = [p.strip() for p in value.split(",")]
    if len(parts) != 2:
        raise argparse.ArgumentTypeError("Expected 'lat,lon'")
    return float(parts[0]), float(parts[1])


def _env_latlon(name: str) -> Tuple[float, float] | None:
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


def _quat_to_yaw(qw: float, qx: float, qy: float, qz: float) -> float:
    siny_cosp = 2.0 * (qw * qz + qx * qy)
    cosy_cosp = 1.0 - 2.0 * (qy * qy + qz * qz)
    return math.atan2(siny_cosp, cosy_cosp)


def _yaw_to_quat(yaw_rad: float) -> Tuple[float, float, float, float]:
    half = 0.5 * yaw_rad
    return math.cos(half), 0.0, 0.0, math.sin(half)


def _quat_to_mat(qw: float, qx: float, qy: float, qz: float) -> List[List[float]]:
    n = math.sqrt(qw * qw + qx * qx + qy * qy + qz * qz)
    if n <= 0.0:
        return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    qw, qx, qy, qz = qw / n, qx / n, qy / n, qz / n
    xx = qx * qx
    yy = qy * qy
    zz = qz * qz
    xy = qx * qy
    xz = qx * qz
    yz = qy * qz
    wx = qw * qx
    wy = qw * qy
    wz = qw * qz
    return [
        [1.0 - 2.0 * (yy + zz), 2.0 * (xy - wz), 2.0 * (xz + wy)],
        [2.0 * (xy + wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz - wx)],
        [2.0 * (xz - wy), 2.0 * (yz + wx), 1.0 - 2.0 * (xx + yy)],
    ]


def _mat_transpose(a: List[List[float]]) -> List[List[float]]:
    return [
        [a[0][0], a[1][0], a[2][0]],
        [a[0][1], a[1][1], a[2][1]],
        [a[0][2], a[1][2], a[2][2]],
    ]


def _mat_mul(a: List[List[float]], b: List[List[float]]) -> List[List[float]]:
    out = [[0.0, 0.0, 0.0] for _ in range(3)]
    for i in range(3):
        for j in range(3):
            out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]
    return out


def _mat_to_quat(m: List[List[float]]) -> Tuple[float, float, float, float]:
    tr = m[0][0] + m[1][1] + m[2][2]
    if tr > 0.0:
        s = math.sqrt(tr + 1.0) * 2.0
        qw = 0.25 * s
        qx = (m[2][1] - m[1][2]) / s
        qy = (m[0][2] - m[2][0]) / s
        qz = (m[1][0] - m[0][1]) / s
    elif m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        s = math.sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2.0
        qw = (m[2][1] - m[1][2]) / s
        qx = 0.25 * s
        qy = (m[0][1] + m[1][0]) / s
        qz = (m[0][2] + m[2][0]) / s
    elif m[1][1] > m[2][2]:
        s = math.sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2.0
        qw = (m[0][2] - m[2][0]) / s
        qx = (m[0][1] + m[1][0]) / s
        qy = 0.25 * s
        qz = (m[1][2] + m[2][1]) / s
    else:
        s = math.sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2.0
        qw = (m[1][0] - m[0][1]) / s
        qx = (m[0][2] + m[2][0]) / s
        qy = (m[1][2] + m[2][1]) / s
        qz = 0.25 * s
    return qw, qx, qy, qz


def _find_open_port(host: str, start_port: int, max_tries: int = 25) -> int:
    if start_port <= 0:
        start_port = 8080
    for offset in range(max_tries):
        port = start_port + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host, port))
            except OSError:
                continue
            return port
    raise OSError(f"No free port found in range {start_port}-{start_port + max_tries - 1}.")


def _collect_body_info(model: mujoco.MjModel) -> List[Tuple[str, int]]:
    bodies: List[Tuple[str, int]] = []
    for body_id in range(model.nbody):
        name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY, body_id)
        if not name or name == "world":
            continue
        bodies.append((name, body_id))
    return bodies


def _relative_transform(
    root_pos: Tuple[float, float, float],
    root_quat: Tuple[float, float, float, float],
    link_pos: Tuple[float, float, float],
    link_quat: Tuple[float, float, float, float],
) -> Tuple[Tuple[float, float, float], Tuple[float, float, float, float]]:
    r_root = _quat_to_mat(*root_quat)
    r_root_t = _mat_transpose(r_root)

    dx = link_pos[0] - root_pos[0]
    dy = link_pos[1] - root_pos[1]
    dz = link_pos[2] - root_pos[2]

    rel_pos = (
        r_root_t[0][0] * dx + r_root_t[0][1] * dy + r_root_t[0][2] * dz,
        r_root_t[1][0] * dx + r_root_t[1][1] * dy + r_root_t[1][2] * dz,
        r_root_t[2][0] * dx + r_root_t[2][1] * dy + r_root_t[2][2] * dz,
    )

    r_link = _quat_to_mat(*link_quat)
    rel_rot = _mat_mul(r_root_t, r_link)
    rel_quat = _mat_to_quat(rel_rot)

    return rel_pos, rel_quat


def _emit_status(hub: PoseHub, message: str) -> None:
    text = message.strip()
    if not text:
        return
    hub.broadcast_event_from_thread({"type": "status", "message": text, "t": time.time()})


def run_sim(
    route_state: RouteState,
    hub: PoseHub,
    perception_hub: PerceptionHub,
    config_path: str,
    duration: float | None,
    headless: bool,
    broadcast_hz: float,
    *,
    max_client_pose_hz: float,
    vision_hz: float,
    use_gemini: bool,
    use_google_maps: bool,
    max_waypoints: int,
    brain: Optional[GeminiBrain] = None,
) -> None:
    try:
        paths = load_project_paths()
        runner = G1MujocoRunner(config_path=config_path, legged_gym_root=paths.legged_gym_root)
        default_base_z = float(runner.data.qpos[2])
        try:
            runner.cmd[:] = 0.0
        except Exception:
            pass
        body_info = _collect_body_info(runner.model)
    except Exception as exc:
        print(f"[sim] Failed to start MuJoCo runner: {exc}")
        try:
            hub.broadcast_from_thread({"error": f"MuJoCo runner failed: {exc}"})
        except Exception:
            pass
        return

    pose_send_hz = max(1.0, min(float(broadcast_hz), float(max_client_pose_hz)))
    min_interval = 1.0 / pose_send_hz
    last_send = 0.0
    last_cmd: Dict[str, float | bool] = {"x": 0.0, "y": 0.0, "yaw": 0.0, "done": True}
    avoidance = ObstacleAvoidance(wall_rise_m=0.5)
    planner_brain = brain or GeminiBrain()
    terrain_probe_stale_s = max(0.2, float(os.environ.get("TERRAIN_PROBE_STALE_S", "1.5")))
    apply_pose_guardrail = os.environ.get("TERRAIN_POSE_GUARDRAIL", "1").strip().lower() not in {"0", "false", "off", "no"}

    perf_window_started = time.time()
    perf_cmd_updates = 0
    perf_pose_tx = 0
    perf_terrain_stale = 0
    perf_terrain_blocked = 0
    last_fresh_terrain_at = 0.0
    last_stale_notice_at = 0.0
    last_guardrail_notice_at = 0.0
    last_block_reason = ""
    last_terrain_reason = ""
    last_obstacle_reason = ""
    sim_wall_start = time.time()
    last_speed_sample_wall = 0.0
    last_speed_sample_sim = 0.0
    speed_achieved = 1.0
    low_speed_started_at = 0.0
    last_low_speed_notice_at = 0.0
    off_route_started_at = 0.0
    last_off_route_notice_at = 0.0
    terrain_anchor_base_h: Optional[float] = None
    terrain_anchor_qpos_z = float(default_base_z)
    latest_route_metrics: Dict[str, Any] = {
        "crossTrackErrorM": 0.0,
        "progressPct": 0.0,
        "offRoute": False,
    }

    robot_state_lock = threading.Lock()
    latest_robot_state: Dict[str, Any] = {
        "lat": 0.0,
        "lon": 0.0,
        "heading_rad": 0.0,
        "speed_mps": 0.0,
        "current_waypoint": None,
        "remaining_waypoints": 0,
        "goal": None,
    }

    vision_stop = threading.Event()
    vision_thread: Optional[threading.Thread] = None

    vision_enabled = vision_hz > 0.0 and use_gemini
    if vision_hz > 0.0 and not use_gemini:
        _emit_status(hub, "Vision disabled because --no-gemini is active.")

    def _start_vision_thread() -> None:
        nonlocal vision_thread
        if not vision_enabled:
            return
        vision_brain: GeminiVisionBrain | None = None
        vision_period_s = 1.0 / max(0.05, float(vision_hz))
        blocked_streak = 0
        last_replan_ts = 0.0
        last_error_ts = 0.0
        last_key_wait_notice_ts = 0.0

        def _vision_loop() -> None:
            nonlocal blocked_streak, last_replan_ts, last_error_ts, last_key_wait_notice_ts, vision_brain
            _emit_status(hub, f"Gemini vision loop started at {vision_hz:.2f} Hz.")
            while not vision_stop.is_set():
                step_started = time.time()
                api_key = os.environ.get("GEMINI_API_KEY", "").strip()
                if not api_key:
                    if (time.time() - last_key_wait_notice_ts) > 12.0:
                        _emit_status(hub, "Vision waiting for GEMINI_API_KEY (set in env or UI token).")
                        last_key_wait_notice_ts = time.time()
                    vision_brain = None
                    vision_stop.wait(min(vision_period_s, 1.0))
                    continue
                if vision_brain is None:
                    vision_brain = GeminiVisionBrain()
                    _emit_status(hub, "Gemini vision brain activated.")

                nav_context = route_state.get_navigation_context()
                if not bool(nav_context.get("running", False)):
                    blocked_streak = 0
                    vision_stop.wait(min(vision_period_s, 0.5))
                    continue

                frame = perception_hub.get_latest_frame(max_age_s=8.0)
                if not frame:
                    vision_stop.wait(min(vision_period_s, 0.5))
                    continue

                terrain_probe = perception_hub.get_latest_terrain(max_age_s=2.0)
                with robot_state_lock:
                    robot_state = dict(latest_robot_state)
                frame_robot = frame.get("robot")
                if isinstance(frame_robot, dict):
                    for key in ("lat", "lon", "heading", "speed"):
                        if key in frame_robot:
                            robot_state[key] = frame_robot.get(key)
                robot_state["current_waypoint"] = nav_context.get("current_waypoint_latlon")
                robot_state["remaining_waypoints"] = nav_context.get("remaining_waypoints")
                robot_state["goal"] = nav_context.get("goal_latlon")

                try:
                    decision = vision_brain.analyze_frame(
                        image_base64=str(frame.get("image", "")),
                        robot_state=robot_state,
                        terrain_probe=terrain_probe,
                    )
                except Exception as exc:
                    now = time.time()
                    if now - last_error_ts > 8.0:
                        _emit_status(hub, f"Gemini vision call failed: {exc}")
                        last_error_ts = now
                    vision_stop.wait(vision_period_s)
                    continue

                avoidance.update_vision_decision(decision)
                _emit_status(hub, f"Vision: {decision.brief()}")

                blocked_by_obstacle = any(
                    obstacle.severity.lower() in {"high", "severe", "critical"}
                    and obstacle.direction.lower() in {"ahead", "front", "center", "forward"}
                    for obstacle in decision.obstacles
                )
                blocked = decision.action in {"stop", "turn_around"} or blocked_by_obstacle
                if blocked:
                    blocked_streak += 1
                else:
                    blocked_streak = 0

                goal_latlon = nav_context.get("goal_latlon")
                current_lat = float(robot_state.get("lat", 0.0) or 0.0)
                current_lon = float(robot_state.get("lon", 0.0) or 0.0)
                should_replan = (
                    blocked_streak >= 2
                    and isinstance(goal_latlon, tuple)
                    and len(goal_latlon) == 2
                    and (time.time() - last_replan_ts) > 15.0
                )
                if should_replan and (-90.0 <= current_lat <= 90.0) and (-180.0 <= current_lon <= 180.0):
                    last_replan_ts = time.time()
                    context = f"{decision.scene_description}. {decision.reasoning}".strip()
                    commands = planner_brain.replan_with_vision(
                        start_latlon=(current_lat, current_lon),
                        goal_latlon=(float(goal_latlon[0]), float(goal_latlon[1])),
                        vision_context=context,
                        max_waypoints=max_waypoints,
                        use_google_maps=use_google_maps,
                        use_gemini=use_gemini,
                    )
                    replanned = False
                    for cmd in commands:
                        if cmd.name == "status":
                            _emit_status(hub, str(cmd.get("message", "")))
                        elif cmd.name == "set_plan":
                            new_plan = cmd.get("plan")
                            if new_plan is not None:
                                route_state.set_plan(new_plan)
                                route_state.start_navigation()
                                replanned = True
                        elif cmd.name == "error":
                            _emit_status(hub, f"Replan failed: {cmd.get('message', 'unknown error')}")
                    if replanned:
                        _emit_status(hub, "Route replanned from current pose using mission context.")
                        blocked_streak = 0

                elapsed = time.time() - step_started
                vision_stop.wait(max(0.0, vision_period_s - elapsed))

        vision_thread = threading.Thread(target=_vision_loop, daemon=True)
        vision_thread.start()

    _start_vision_thread()

    def cmd_provider(sim_time: float, qpos) -> Tuple[float, float, float] | None:
        nonlocal perf_cmd_updates, perf_terrain_stale, last_fresh_terrain_at, last_stale_notice_at
        nonlocal last_guardrail_notice_at, perf_terrain_blocked, last_block_reason
        nonlocal last_terrain_reason, last_obstacle_reason
        nonlocal terrain_anchor_base_h, terrain_anchor_qpos_z, latest_route_metrics
        perf_cmd_updates += 1
        restart_request = route_state.consume_sim_restart_request()
        if restart_request:
            start_xy = restart_request.get("start_xy")
            next_xy = restart_request.get("next_xy")
            if (
                isinstance(start_xy, tuple)
                and len(start_xy) == 2
                and isinstance(next_xy, tuple)
                and len(next_xy) == 2
            ):
                start_x = float(start_xy[0])
                start_y = float(start_xy[1])
                next_x = float(next_xy[0])
                next_y = float(next_xy[1])
                yaw0 = math.atan2(next_y - start_y, next_x - start_x)
                qw, qx, qy, qz = _yaw_to_quat(yaw0)

                qpos[0] = start_x
                qpos[1] = start_y
                qpos[2] = default_base_z
                qpos[3] = qw
                qpos[4] = qx
                qpos[5] = qy
                qpos[6] = qz
                terrain_anchor_base_h = None
                terrain_anchor_qpos_z = float(default_base_z)
                try:
                    runner.data.qvel[:] = 0.0
                except Exception:
                    pass
                mujoco.mj_forward(runner.model, runner.data)
                route_state.set_current_pos((start_x, start_y))

        pos_x, pos_y = float(qpos[0]), float(qpos[1])
        quat = qpos[3:7]
        yaw = _quat_to_yaw(float(quat[0]), float(quat[1]), float(quat[2]), float(quat[3]))

        route_state.set_current_pos((pos_x, pos_y))
        latest_route_metrics = route_state.get_route_follow_metrics((pos_x, pos_y))
        lat, lon = route_state.local_to_latlon((pos_x, pos_y))
        nav_context = route_state.get_navigation_context()
        with robot_state_lock:
            latest_robot_state["lat"] = lat
            latest_robot_state["lon"] = lon
            latest_robot_state["heading_rad"] = yaw
            latest_robot_state["speed_mps"] = float(last_cmd.get("x", 0.0) or 0.0)
            latest_robot_state["current_waypoint"] = nav_context.get("current_waypoint_latlon")
            latest_robot_state["remaining_waypoints"] = int(nav_context.get("remaining_waypoints", 0) or 0)
            latest_robot_state["goal"] = nav_context.get("goal_latlon")

        nav_running = bool(nav_context.get("running", False))
        if not nav_running:
            cmd_x, cmd_y, cmd_yaw, done = 0.0, 0.0, 0.0, True
            last_block_reason = ""
            last_terrain_reason = ""
            last_obstacle_reason = ""
            try:
                runner.cmd[:] = 0.0
            except Exception:
                pass
        else:
            terrain_probe = perception_hub.get_latest_terrain(max_age_s=terrain_probe_stale_s)
            if terrain_probe:
                captured_at_ms = terrain_probe.get("capturedAtMs")
                try:
                    captured_age_s = (time.time() * 1000.0 - float(captured_at_ms)) / 1000.0
                except (TypeError, ValueError):
                    captured_age_s = 0.0
                if captured_age_s > terrain_probe_stale_s:
                    terrain_probe = None

            dynamic_payload = perception_hub.get_latest_dynamic_obstacles(max_age_s=1.2)
            dynamic_for_avoidance: List[Dict[str, float]] = []
            if dynamic_payload:
                raw_obstacles = dynamic_payload.get("obstacles")
                if isinstance(raw_obstacles, list):
                    cos_yaw = math.cos(yaw)
                    sin_yaw = math.sin(yaw)
                    for item in raw_obstacles:
                        if not isinstance(item, dict):
                            continue
                        try:
                            obstacle_lat = float(item.get("lat"))
                            obstacle_lon = float(item.get("lon"))
                        except (TypeError, ValueError):
                            continue
                        if not (-90.0 <= obstacle_lat <= 90.0 and -180.0 <= obstacle_lon <= 180.0):
                            continue
                        try:
                            radius_m = max(0.5, float(item.get("radiusM", 1.5) or 1.5))
                        except (TypeError, ValueError):
                            radius_m = 1.5
                        obs_x, obs_y = route_state.latlon_to_local((obstacle_lat, obstacle_lon))
                        dx = obs_x - pos_x
                        dy = obs_y - pos_y
                        forward_m = cos_yaw * dx + sin_yaw * dy
                        lateral_m = -sin_yaw * dx + cos_yaw * dy
                        dynamic_for_avoidance.append(
                            {
                                "forwardM": float(forward_m),
                                "lateralM": float(lateral_m),
                                "radiusM": radius_m,
                            }
                        )
            avoidance.update_dynamic_obstacles(dynamic_for_avoidance)

            cmd_x, cmd_y, cmd_yaw, done = route_state.update_follower((pos_x, pos_y), yaw)
            if terrain_probe:
                last_fresh_terrain_at = time.time()
                avoidance.update_terrain_probe(terrain_probe)
            cmd_x, cmd_y, cmd_yaw = avoidance.modify_command(cmd_x, cmd_y, cmd_yaw)

            # Apply speed multiplier to robot velocity (not simulation time)
            speed_mult = route_state.get_sim_speed_multiplier()
            cmd_x *= speed_mult
            cmd_y *= speed_mult
            cmd_yaw *= speed_mult
            # Safety clamp to prevent excessive speeds that could cause instability
            cmd_x = max(-5.0, min(5.0, cmd_x))
            cmd_y = max(-5.0, min(5.0, cmd_y))
            cmd_yaw = max(-3.0, min(3.0, cmd_yaw))

            now = time.time()
            avoidance_reason = (avoidance.last_reason() or "").strip()
            last_terrain_reason = ""
            last_obstacle_reason = ""
            if terrain_probe is None:
                perf_terrain_stale += 1
                cmd_x = max(-0.05, min(0.05, cmd_x))
                cmd_y = max(-0.03, min(0.03, cmd_y))
                cmd_yaw = max(-0.35, min(0.35, cmd_yaw))
                last_block_reason = "terrain_probe_stale"
                last_terrain_reason = "terrain_probe_stale"
                if now - last_stale_notice_at > 4.0:
                    _emit_status(
                        hub,
                        f"Terrain probe stale (> {terrain_probe_stale_s:.1f}s): translation hard-limited.",
                    )
                    last_stale_notice_at = now
            else:
                if (
                    "terrain block" in avoidance_reason
                    or "structure" in avoidance_reason
                    or "drop risk" in avoidance_reason
                    or "wall/building risk" in avoidance_reason
                ):
                    last_terrain_reason = avoidance_reason
                    perf_terrain_blocked += 1
                elif "dynamic obstacle" in avoidance_reason:
                    last_obstacle_reason = avoidance_reason
                if last_terrain_reason:
                    last_block_reason = last_terrain_reason
                elif last_obstacle_reason:
                    last_block_reason = last_obstacle_reason
                elif avoidance_reason:
                    last_block_reason = avoidance_reason
                else:
                    last_block_reason = ""

                if apply_pose_guardrail and abs(cmd_x) <= 0.22 and abs(cmd_y) <= 0.12:
                    base_h_raw = terrain_probe.get("baseHeightM")
                    try:
                        base_h = float(base_h_raw)
                    except (TypeError, ValueError):
                        base_h = float("nan")
                    if math.isfinite(base_h):
                        if terrain_anchor_base_h is None:
                            terrain_anchor_base_h = base_h
                            terrain_anchor_qpos_z = float(qpos[2])
                        delta_h = max(-1.2, min(1.2, base_h - terrain_anchor_base_h))
                        target_z = terrain_anchor_qpos_z + delta_h
                        dz = target_z - float(qpos[2])
                        correction = max(-0.006, min(0.006, dz))
                        if abs(correction) > 1e-5:
                            qpos[2] = float(qpos[2]) + correction
                            if now - last_guardrail_notice_at > 8.0:
                                _emit_status(hub, f"Terrain anchor correction: dz={correction:+.4f}m")
                                last_guardrail_notice_at = now

        last_cmd["x"] = cmd_x
        last_cmd["y"] = cmd_y
        last_cmd["yaw"] = cmd_yaw
        last_cmd["done"] = done

        return cmd_x, cmd_y, cmd_yaw

    def pose_callback(sim_time: float, qpos, qvel) -> None:
        nonlocal last_send, perf_pose_tx, perf_cmd_updates, perf_terrain_stale
        nonlocal perf_window_started, speed_achieved, last_speed_sample_wall, last_speed_sample_sim
        nonlocal low_speed_started_at, last_low_speed_notice_at, perf_terrain_blocked
        nonlocal last_terrain_reason, last_obstacle_reason
        nonlocal off_route_started_at, last_off_route_notice_at
        now = time.time()
        if now - last_send < min_interval:
            return
        last_send = now
        perf_pose_tx += 1

        pos_x, pos_y, pos_z = float(qpos[0]), float(qpos[1]), float(qpos[2])
        quat = (float(qpos[3]), float(qpos[4]), float(qpos[5]), float(qpos[6]))
        sim_time_s = max(0.0, float(sim_time))
        wall_time_s = max(0.0, now - sim_wall_start)

        if last_speed_sample_wall <= 0.0:
            last_speed_sample_wall = now
            last_speed_sample_sim = sim_time_s
        else:
            delta_wall = now - last_speed_sample_wall
            if delta_wall >= 0.25:
                delta_sim = max(0.0, sim_time_s - last_speed_sample_sim)
                speed_achieved = max(0.0, delta_sim / max(1e-6, delta_wall))
                last_speed_sample_wall = now
                last_speed_sample_sim = sim_time_s

        speed_requested = max(0.25, float(route_state.get_sim_speed_multiplier()))
        if speed_requested > 1.0 and speed_achieved < (speed_requested * 0.8):
            if low_speed_started_at <= 0.0:
                low_speed_started_at = now
            elif now - low_speed_started_at > 5.0 and now - last_low_speed_notice_at > 5.0:
                _emit_status(
                    hub,
                    (
                        f"Simulation under target: requested={speed_requested:.1f}x "
                        f"achieved={speed_achieved:.2f}x"
                    ),
                )
                last_low_speed_notice_at = now
        else:
            low_speed_started_at = 0.0

        lat, lon = route_state.local_to_latlon((pos_x, pos_y))
        nav_context = route_state.get_navigation_context()
        off_route = bool(latest_route_metrics.get("offRoute", False))
        if off_route:
            if off_route_started_at <= 0.0:
                off_route_started_at = now
            elif (now - off_route_started_at) > 3.0 and (now - last_off_route_notice_at) > 5.0:
                _emit_status(
                    hub,
                    (
                        f"Off-route detected: crossTrack="
                        f"{float(latest_route_metrics.get('crossTrackErrorM', 0.0) or 0.0):.2f}m"
                    ),
                )
                last_off_route_notice_at = now
        else:
            off_route_started_at = 0.0

        links: Dict[str, Dict[str, List[float]]] = {}
        for name, body_id in body_info:
            bpos = runner.data.xpos[body_id]
            bquat = runner.data.xquat[body_id]
            rel_pos, rel_quat = _relative_transform(
                (pos_x, pos_y, pos_z),
                quat,
                (float(bpos[0]), float(bpos[1]), float(bpos[2])),
                (float(bquat[0]), float(bquat[1]), float(bquat[2]), float(bquat[3])),
            )
            links[name] = {
                "pos": [rel_pos[0], rel_pos[1], rel_pos[2]],
                "quat": [rel_quat[0], rel_quat[1], rel_quat[2], rel_quat[3]],
            }

        payload = {
            "t": now,
            "simTimeS": sim_time_s,
            "wallTimeS": wall_time_s,
            "root": {
                "local": [pos_x, pos_y, pos_z],
                "lat": lat,
                "lon": lon,
                "height": pos_z,
                "quat": [quat[0], quat[1], quat[2], quat[3]],
            },
            "cmd": last_cmd,
            "links": links,
            "nav": {
                "currentWaypoint": nav_context.get("current_waypoint_latlon"),
                "remainingWaypoints": int(nav_context.get("remaining_waypoints", 0) or 0),
                "running": bool(nav_context.get("running", False)),
                "simTimeS": sim_time_s,
                "wallTimeS": wall_time_s,
                "speedRequested": speed_requested,
                "speedAchieved": speed_achieved,
                "crossTrackErrorM": float(latest_route_metrics.get("crossTrackErrorM", 0.0) or 0.0),
                "progressPct": float(latest_route_metrics.get("progressPct", 0.0) or 0.0),
                "offRoute": off_route,
                "terrainBlockReason": last_terrain_reason,
                "obstacleBlockReason": last_obstacle_reason,
            },
        }

        hub.broadcast_from_thread(payload)

        elapsed = now - perf_window_started
        if elapsed >= 5.0:
            pose_hz = perf_pose_tx / elapsed
            cmd_hz = perf_cmd_updates / elapsed
            terrain_age = max(0.0, now - last_fresh_terrain_at) if last_fresh_terrain_at > 0 else float("inf")
            terrain_age_text = f"{terrain_age:.2f}s" if math.isfinite(terrain_age) else "n/a"
            block_note = f" blocked={perf_terrain_blocked}" if perf_terrain_blocked else ""
            reason_note = f" reason={last_block_reason}" if last_block_reason else ""
            _emit_status(
                hub,
                (
                    f"[perf] pose_tx={pose_hz:.1f}/s cmd={cmd_hz:.1f}/s "
                    f"terrain_age={terrain_age_text} stale_ticks={perf_terrain_stale}{block_note} "
                    f"speed={speed_achieved:.2f}x/{speed_requested:.1f}x{reason_note}"
                ),
            )
            perf_window_started = now
            perf_pose_tx = 0
            perf_cmd_updates = 0
            perf_terrain_stale = 0
            perf_terrain_blocked = 0

    runner.cmd_provider = cmd_provider
    runner.pose_callback = pose_callback
    try:
        runner.run(
            duration_s=duration,
            headless=headless,
            realtime_scale_provider=lambda: 1.0,  # Keep simulation at 1x; speed multiplier affects robot velocity only
        )
    except Exception as exc:
        print(f"[sim] MuJoCo runner stopped: {exc}")
        try:
            hub.broadcast_from_thread({"error": f"MuJoCo runner stopped: {exc}"})
        except Exception:
            pass
    finally:
        vision_stop.set()
        if vision_thread and vision_thread.is_alive():
            vision_thread.join(timeout=3.0)


def _start_web_server_in_thread(
    route_state: RouteState,
    static_dir: str,
    host: str,
    port: int,
) -> Tuple[PoseHub, PerceptionHub, threading.Thread]:
    ready = threading.Event()
    state: Dict[str, Any] = {}
    errors: Dict[str, BaseException] = {}

    def _run_server() -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        hub = PoseHub(loop)
        perception_hub = PerceptionHub()
        app = create_app(static_dir, route_state, hub, perception_hub)
        runner = web.AppRunner(app)

        async def _start() -> None:
            await runner.setup()
            site = web.TCPSite(runner, host=host, port=port)
            await site.start()

        try:
            loop.run_until_complete(_start())
        except Exception as exc:
            errors["exc"] = exc
            ready.set()
            return

        state["hub"] = hub
        state["perception_hub"] = perception_hub
        state["loop"] = loop
        ready.set()
        try:
            loop.run_forever()
        finally:
            loop.run_until_complete(runner.cleanup())
            loop.close()

    thread = threading.Thread(target=_run_server, daemon=True)
    thread.start()
    ready.wait(timeout=10.0)
    if errors.get("exc"):
        raise errors["exc"]
    hub = state.get("hub")
    if not isinstance(hub, PoseHub):
        raise RuntimeError("Web server failed to start.")
    perception_hub = state.get("perception_hub")
    if not isinstance(perception_hub, PerceptionHub):
        raise RuntimeError("Perception hub failed to start.")
    return hub, perception_hub, thread


def main() -> None:
    load_dotenv(os.path.join(REPO_ROOT, ".env"))
    os.environ.setdefault("LEGGED_GYM_ROOT_DIR", _default_legged_gym_root())
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=_parse_latlon, default=None, help="Start lat,lon")
    parser.add_argument("--goal", type=_parse_latlon, default=None, help="Goal lat,lon")
    parser.add_argument("--prompt", type=str, default=None, help="Prompt like 'from A to B'")
    parser.add_argument("--waypoints", type=int, default=12)
    parser.add_argument("--use-gemini", action="store_true")
    parser.add_argument("--no-gemini", action="store_true")
    parser.add_argument("--use-google-maps", dest="use_google_maps", action="store_true")
    parser.add_argument("--no-google-maps", dest="use_google_maps", action="store_false")
    parser.add_argument(
        "--auto-start",
        action="store_true",
        help="Start navigation immediately on boot (default: wait for UI Plan + Go).",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=0.0,
        help="Simulation duration in seconds (0 = run until the MuJoCo viewer is closed).",
    )
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--broadcast-hz", type=float, default=30.0)
    parser.add_argument(
        "--max-client-pose-hz",
        type=float,
        default=30.0,
        help="Cap websocket pose updates to frontend regardless of simulation speed.",
    )
    parser.add_argument(
        "--vision-hz",
        type=float,
        default=0.5,
        help="Gemini vision call frequency in Hz (0 disables vision).",
    )
    parser.add_argument("--host", type=str, default=os.environ.get("WEB_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("WEB_PORT", "8080")))
    parser.add_argument(
        "--strict-port",
        action="store_true",
        help="Fail if the requested web port is already in use.",
    )
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    parser.add_argument(
        "--static-dir",
        type=str,
        default=os.path.join(repo_root, "packages", "web", "public"),
    )
    parser.add_argument(
        "--config",
        type=str,
        default=os.path.join(
            os.environ["LEGGED_GYM_ROOT_DIR"],
            "deploy",
            "deploy_mujoco",
            "configs",
            "g1.yaml",
        ),
    )
    parser.set_defaults(use_google_maps=True)
    args = parser.parse_args()
    if not os.path.isabs(args.static_dir):
        args.static_dir = os.path.join(REPO_ROOT, args.static_dir)
    if not os.path.isabs(args.config):
        args.config = os.path.join(REPO_ROOT, args.config)
    if not os.path.isdir(args.static_dir):
        raise SystemExit(f"Static directory not found: {args.static_dir}")
    if not os.path.exists(args.config):
        raise SystemExit(
            "MuJoCo config not found. Set LEGGED_GYM_ROOT_DIR to a valid Unitree RL Gym checkout "
            f"or pass --config explicitly. Checked: {args.config}"
        )

    use_gemini = bool((not args.no_gemini) or args.use_gemini)
    use_google_maps = bool(args.use_google_maps)
    demo_start = _env_latlon("DEFAULT_START_LATLON") or DEFAULT_DEMO_START
    demo_goal = _env_latlon("DEFAULT_GOAL_LATLON") or DEFAULT_DEMO_GOAL

    forced_start = _env_latlon("FORCE_START_LATLON")
    forced_goal = _env_latlon("FORCE_GOAL_LATLON")
    if forced_start is not None:
        args.start = forced_start
    if forced_goal is not None:
        args.goal = forced_goal

    if args.prompt is None:
        if args.start is None and args.goal is None:
            args.start = demo_start
            args.goal = demo_goal
        elif args.start is None and args.goal is not None:
            args.start = demo_start
        elif args.start is not None and args.goal is None:
            args.goal = demo_goal

    if args.prompt is None and (args.start is None or args.goal is None):
        args.prompt = DEFAULT_MISSION_PROMPT

    if not args.strict_port:
        selected_port = _find_open_port(args.host, args.port)
        if selected_port != args.port:
            print(f"Port {args.port} is busy. Using {selected_port} instead.")
        args.port = selected_port

    brain = GeminiBrain()
    commands = brain.run(
        prompt=args.prompt,
        start_latlon=args.start,
        goal_latlon=args.goal,
        max_waypoints=args.waypoints,
        use_google_maps=use_google_maps,
        use_gemini=use_gemini,
    )

    plan = None
    brain_requested_start = False
    for cmd in commands:
        if cmd.name == "status":
            message = cmd.get("message", "")
            if message:
                print(f"Brain: {message}")
        elif cmd.name == "set_plan":
            plan = cmd.get("plan")
        elif cmd.name == "start_navigation":
            brain_requested_start = True
        elif cmd.name == "error":
            raise SystemExit(f"Route planning failed: {cmd.get('message', 'unknown error')}")

    if plan is None:
        raise SystemExit("Route planning failed: brain produced no plan.")

    route_state = RouteState(plan.start_latlon)
    route_state.set_plan(plan)
    if brain_requested_start and args.auto_start:
        route_state.start_navigation()
    elif brain_requested_start and not args.auto_start:
        print("Navigation paused. Use the web UI 'Plan + Go' (or rerun with --auto-start).")

    try:
        hub, perception_hub, _server_thread = _start_web_server_in_thread(
            route_state,
            args.static_dir,
            args.host,
            args.port,
        )
    except Exception as exc:
        raise SystemExit(f"Web server failed to start: {exc}") from exc

    print(f"Web UI running at http://{args.host}:{args.port}")
    print("Press Ctrl+C to stop.")

    duration = float(args.duration) if args.duration > 0 else float("inf")
    try:
        run_sim(
            route_state,
            hub,
            perception_hub,
            args.config,
            duration,
            args.headless,
            args.broadcast_hz,
            max_client_pose_hz=max(1.0, float(args.max_client_pose_hz)),
            vision_hz=max(0.0, float(args.vision_hz)),
            use_gemini=use_gemini,
            use_google_maps=use_google_maps,
            max_waypoints=args.waypoints,
            brain=brain,
        )
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
