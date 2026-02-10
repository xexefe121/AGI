"""A lightweight waypoint follower that outputs velocity commands."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Tuple


def _wrap_angle(angle_rad: float) -> float:
    while angle_rad > math.pi:
        angle_rad -= 2 * math.pi
    while angle_rad < -math.pi:
        angle_rad += 2 * math.pi
    return angle_rad


@dataclass
class FollowerParams:
    kp_linear: float = 0.6
    kp_yaw: float = 1.8
    max_forward_mps: float = 0.8
    max_lateral_mps: float = 0.0
    max_yaw_rps: float = 0.6
    waypoint_tolerance_m: float = 1.5


class WaypointFollower:
    def __init__(self, waypoints_xy: List[Tuple[float, float]], params: FollowerParams | None = None):
        if len(waypoints_xy) < 2:
            raise ValueError("At least two waypoints are required.")
        self.waypoints_xy = waypoints_xy
        self.params = params or FollowerParams()
        self.index = 0

    def _advance_if_needed(self, pos_xy: Tuple[float, float]) -> None:
        while self.index < len(self.waypoints_xy) - 1:
            target = self.waypoints_xy[self.index]
            dist = math.hypot(target[0] - pos_xy[0], target[1] - pos_xy[1])
            if dist > self.params.waypoint_tolerance_m:
                return
            self.index += 1

    def update(self, pos_xy: Tuple[float, float], yaw_rad: float) -> Tuple[float, float, float, bool]:
        self._advance_if_needed(pos_xy)
        target = self.waypoints_xy[self.index]

        dx = target[0] - pos_xy[0]
        dy = target[1] - pos_xy[1]
        distance = math.hypot(dx, dy)

        desired_heading = math.atan2(dy, dx)
        yaw_error = _wrap_angle(desired_heading - yaw_rad)

        forward = max(min(distance * self.params.kp_linear, self.params.max_forward_mps), -self.params.max_forward_mps)
        lateral = max(min(distance * math.sin(yaw_error) * self.params.kp_linear, self.params.max_lateral_mps), -self.params.max_lateral_mps)
        yaw_rate = max(min(yaw_error * self.params.kp_yaw, self.params.max_yaw_rps), -self.params.max_yaw_rps)

        done = self.index >= len(self.waypoints_xy) - 1 and distance < self.params.waypoint_tolerance_m
        return forward, lateral, yaw_rate, done

    def get_target_waypoint(self) -> Tuple[float, float]:
        return self.waypoints_xy[self.index]

    def get_remaining_waypoint_count(self) -> int:
        return max(0, len(self.waypoints_xy) - self.index - 1)
