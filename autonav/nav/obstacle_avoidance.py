"""Obstacle avoidance that combines vision decisions and terrain probes."""

from __future__ import annotations

from dataclasses import dataclass
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from autonav.brain.gemini_vision import VisionDecision


@dataclass(frozen=True)
class AvoidanceCommand:
    forward: float
    lateral: float
    yaw: float
    reason: str


class ObstacleAvoidance:
    def __init__(
        self,
        *,
        vision_ttl_s: float = 4.0,
        terrain_ttl_s: float = 1.0,
        dynamic_ttl_s: float = 1.2,
        wall_rise_m: float = 1.5,
        drop_m: float = 1.0,
    ) -> None:
        self._lock = threading.Lock()
        self._vision_ttl_s = max(0.2, vision_ttl_s)
        self._terrain_ttl_s = max(0.1, terrain_ttl_s)
        self._dynamic_ttl_s = max(0.1, dynamic_ttl_s)
        self._wall_rise_m = wall_rise_m
        self._drop_m = drop_m

        self._last_vision_at: float = 0.0
        self._last_vision: Optional[VisionDecision] = None
        self._last_terrain_at: float = 0.0
        self._last_terrain: Optional[Dict[str, Any]] = None
        self._last_dynamic_at: float = 0.0
        self._last_dynamic: Optional[List[Dict[str, Any]]] = None
        self._last_reason: str = ""

    def update_vision_decision(self, decision: VisionDecision, timestamp: float | None = None) -> None:
        ts = float(timestamp) if timestamp is not None else time.time()
        with self._lock:
            self._last_vision = decision
            self._last_vision_at = ts

    def update_terrain_probe(self, probe: Dict[str, Any], timestamp: float | None = None) -> None:
        ts = float(timestamp) if timestamp is not None else time.time()
        with self._lock:
            self._last_terrain = probe
            self._last_terrain_at = ts

    def update_dynamic_obstacles(
        self, obstacles: List[Dict[str, Any]], timestamp: float | None = None
    ) -> None:
        ts = float(timestamp) if timestamp is not None else time.time()
        with self._lock:
            self._last_dynamic = list(obstacles)
            self._last_dynamic_at = ts

    def get_latest_vision(self) -> Optional[VisionDecision]:
        with self._lock:
            if not self._last_vision:
                return None
            if (time.time() - self._last_vision_at) > self._vision_ttl_s:
                return None
            return self._last_vision

    def last_reason(self) -> str:
        with self._lock:
            return self._last_reason

    def modify_command(self, forward: float, lateral: float, yaw: float) -> Tuple[float, float, float]:
        now = time.time()
        with self._lock:
            vision = self._last_vision if (now - self._last_vision_at) <= self._vision_ttl_s else None
            terrain = self._last_terrain if (now - self._last_terrain_at) <= self._terrain_ttl_s else None
            dynamic = self._last_dynamic if (now - self._last_dynamic_at) <= self._dynamic_ttl_s else None

        cmd = AvoidanceCommand(forward=forward, lateral=lateral, yaw=yaw, reason="")
        cmd = self._apply_terrain(cmd, terrain)
        cmd = self._apply_dynamic(cmd, dynamic)
        cmd = self._apply_vision(cmd, vision)

        with self._lock:
            self._last_reason = cmd.reason
        return cmd.forward, cmd.lateral, cmd.yaw

    def _apply_terrain(self, cmd: AvoidanceCommand, terrain: Optional[Dict[str, Any]]) -> AvoidanceCommand:
        if not terrain:
            return cmd
        samples = terrain.get("samples", [])
        if not isinstance(samples, list) or not samples:
            return cmd

        left_risk = 0.0
        right_risk = 0.0
        center_risk = 0.0
        severe_center_block = False
        severe_side_block = False
        near_drop = False
        near_wall = False

        for sample in samples:
            if not isinstance(sample, dict):
                continue
            bearing = float(sample.get("bearingDeg", 0.0) or 0.0)
            distance = max(0.05, float(sample.get("distanceM", 0.0) or 0.0))
            delta = sample.get("deltaM")
            if delta is None:
                base_h = float(terrain.get("baseHeightM", 0.0) or 0.0)
                sample_h = float(sample.get("heightM", base_h) or base_h)
                delta = sample_h - base_h
            delta_f = float(delta)
            surface_delta = float(sample.get("surfaceDeltaM", 0.0) or 0.0)
            if not (-10.0 <= delta_f <= 10.0):
                continue
            if distance > 9.0:
                continue

            slope = abs(delta_f) / distance
            weight = max(0.1, 1.0 - distance / 10.0)
            risk = (abs(delta_f) + slope * 0.9) * weight

            if abs(bearing) <= 25.0:
                center_risk += risk
                if distance <= 3.2 and (delta_f >= 0.40 or delta_f <= -0.30):
                    severe_center_block = True
                if distance <= 4.0 and slope >= 0.24:
                    severe_center_block = True
                if distance <= 3.6 and surface_delta >= 0.9:
                    severe_center_block = True
            elif bearing < 0:
                left_risk += risk
                if distance <= 3.5 and (delta_f >= self._wall_rise_m or delta_f <= -self._drop_m):
                    severe_side_block = True
                if distance <= 3.5 and surface_delta >= 1.1:
                    severe_side_block = True
            else:
                right_risk += risk
                if distance <= 3.5 and (delta_f >= self._wall_rise_m or delta_f <= -self._drop_m):
                    severe_side_block = True
                if distance <= 3.5 and surface_delta >= 1.1:
                    severe_side_block = True

            if delta_f <= -self._drop_m and distance <= 4.5:
                near_drop = True
            if delta_f >= self._wall_rise_m and distance <= 4.5:
                near_wall = True
            if surface_delta >= 1.2 and distance <= 4.0:
                near_wall = True

        if center_risk < 0.15 and left_risk < 0.15 and right_risk < 0.15:
            return cmd

        turn_left = right_risk >= left_risk
        turn_mag = 0.55 if severe_center_block or severe_side_block else 0.35
        yaw_adjust = turn_mag if turn_left else -turn_mag

        if severe_center_block:
            reason = "terrain block ahead: rise/drop/slope/structure exceeds traversability"
            return AvoidanceCommand(0.0, 0.0, cmd.yaw + yaw_adjust, reason)

        new_forward = cmd.forward
        new_yaw = cmd.yaw
        reason_bits: List[str] = []

        if severe_side_block:
            new_forward = min(new_forward, 0.08)
            new_yaw += yaw_adjust
            reason_bits.append("terrain side block")
        elif center_risk >= 0.35:
            new_forward = min(new_forward, max(0.0, cmd.forward * 0.2))
            new_yaw += yaw_adjust
            reason_bits.append("terrain center hazard")
        elif max(left_risk, right_risk) >= 0.25:
            new_forward = min(new_forward, max(0.0, cmd.forward * 0.5))
            new_yaw += 0.2 if turn_left else -0.2
            reason_bits.append("terrain flank hazard")

        if near_drop:
            new_forward = min(new_forward, 0.05)
            reason_bits.append("drop risk")
        if near_wall:
            new_forward = min(new_forward, 0.18)
            reason_bits.append("wall/building risk")

        reason = "; ".join(reason_bits) if reason_bits else cmd.reason
        return AvoidanceCommand(new_forward, cmd.lateral, new_yaw, reason)

    def _apply_dynamic(
        self, cmd: AvoidanceCommand, dynamic: Optional[List[Dict[str, Any]]]
    ) -> AvoidanceCommand:
        if not dynamic:
            return cmd

        nearest_front = None
        nearest_dist = float("inf")
        for obstacle in dynamic:
            if not isinstance(obstacle, dict):
                continue
            forward_m = float(obstacle.get("forwardM", 0.0) or 0.0)
            lateral_m = float(obstacle.get("lateralM", 0.0) or 0.0)
            radius_m = max(0.4, float(obstacle.get("radiusM", 1.2) or 1.2))
            if forward_m < -1.0 or forward_m > 8.0:
                continue
            clearance = abs(lateral_m) - radius_m
            if clearance > 1.6:
                continue
            if forward_m < nearest_dist:
                nearest_dist = forward_m
                nearest_front = {
                    "forwardM": forward_m,
                    "lateralM": lateral_m,
                    "radiusM": radius_m,
                }

        if nearest_front is None:
            return cmd

        forward_m = float(nearest_front["forwardM"])
        lateral_m = float(nearest_front["lateralM"])
        radius_m = float(nearest_front["radiusM"])
        turn_left = lateral_m >= 0.0
        yaw_adjust = -0.45 if turn_left else 0.45

        if forward_m <= 2.2 and abs(lateral_m) <= (radius_m + 0.9):
            reason = "dynamic obstacle block ahead"
            return AvoidanceCommand(0.0, 0.0, cmd.yaw + yaw_adjust, reason)

        if forward_m <= 4.0 and abs(lateral_m) <= (radius_m + 1.2):
            reduced_forward = min(cmd.forward, max(0.0, cmd.forward * 0.25))
            reason = "dynamic obstacle caution"
            return AvoidanceCommand(reduced_forward, cmd.lateral, cmd.yaw + yaw_adjust * 0.6, reason)

        return cmd

    def _apply_vision(self, cmd: AvoidanceCommand, vision: Optional[VisionDecision]) -> AvoidanceCommand:
        if not vision:
            return cmd

        new_forward = cmd.forward
        new_lateral = cmd.lateral
        new_yaw = cmd.yaw

        speed_factor = max(0.0, min(1.2, float(vision.speed_factor)))
        if speed_factor < 1.0:
            new_forward *= speed_factor

        action = vision.action
        if action == "stop":
            new_forward = 0.0
            new_lateral = 0.0
        elif action == "slow_down":
            new_forward *= min(speed_factor, 0.5) if speed_factor > 0 else 0.4
        elif action == "steer_left":
            mag = max(0.22, abs(float(vision.yaw_adjustment)))
            new_yaw += mag
        elif action == "steer_right":
            mag = max(0.22, abs(float(vision.yaw_adjustment)))
            new_yaw -= mag
        elif action == "turn_around":
            mag = max(0.55, abs(float(vision.yaw_adjustment)))
            if vision.yaw_adjustment < 0:
                new_yaw -= mag
            else:
                new_yaw += mag
            new_forward = min(new_forward, 0.12)
            new_lateral = 0.0
        else:
            # continue: still honor explicit yaw nudges.
            new_yaw += float(vision.yaw_adjustment)

        reason = vision.reasoning.strip() or vision.scene_description.strip() or cmd.reason
        return AvoidanceCommand(new_forward, new_lateral, new_yaw, reason)
