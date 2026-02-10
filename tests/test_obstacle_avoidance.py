import time
import unittest

from autonav.brain.gemini_vision import VisionDecision, VisionObstacle
from autonav.nav.obstacle_avoidance import ObstacleAvoidance


def make_decision(
    *,
    action: str = "continue",
    yaw_adjustment: float = 0.0,
    speed_factor: float = 1.0,
    reasoning: str = "ok",
) -> VisionDecision:
    return VisionDecision(
        scene_description="test-scene",
        obstacles=[VisionObstacle(type="none", direction="ahead", severity="low")],
        action=action,
        yaw_adjustment=yaw_adjustment,
        speed_factor=speed_factor,
        reasoning=reasoning,
        raw_text="{}",
    )


class ObstacleAvoidanceTests(unittest.TestCase):
    def test_passthrough_without_inputs(self) -> None:
        avoidance = ObstacleAvoidance()
        fwd, lat, yaw = avoidance.modify_command(0.6, 0.0, 0.1)
        self.assertAlmostEqual(fwd, 0.6)
        self.assertAlmostEqual(lat, 0.0)
        self.assertAlmostEqual(yaw, 0.1)

    def test_vision_stop_halts_motion(self) -> None:
        avoidance = ObstacleAvoidance()
        avoidance.update_vision_decision(make_decision(action="stop", speed_factor=0.2))
        fwd, lat, yaw = avoidance.modify_command(0.8, 0.2, 0.15)
        self.assertAlmostEqual(fwd, 0.0)
        self.assertAlmostEqual(lat, 0.0)
        self.assertAlmostEqual(yaw, 0.15)

    def test_terrain_hazard_reduces_speed_and_biases_turn(self) -> None:
        avoidance = ObstacleAvoidance()
        avoidance.update_terrain_probe(
            {
                "baseHeightM": 5.0,
                "samples": [
                    {"bearingDeg": 0.0, "distanceM": 2.0, "deltaM": 2.2},
                    {"bearingDeg": 28.0, "distanceM": 2.5, "deltaM": 2.8},
                ],
            }
        )
        fwd, _lat, yaw = avoidance.modify_command(0.9, 0.0, 0.0)
        self.assertLess(fwd, 0.9)
        self.assertGreater(yaw, 0.0)

    def test_stale_vision_is_ignored(self) -> None:
        avoidance = ObstacleAvoidance(vision_ttl_s=0.2)
        stale_ts = time.time() - 1.0
        avoidance.update_vision_decision(
            make_decision(action="steer_left", yaw_adjustment=0.6, speed_factor=0.4),
            timestamp=stale_ts,
        )
        fwd, lat, yaw = avoidance.modify_command(0.5, 0.0, 0.0)
        self.assertAlmostEqual(fwd, 0.5)
        self.assertAlmostEqual(lat, 0.0)
        self.assertAlmostEqual(yaw, 0.0)

    def test_steer_left_increases_yaw(self) -> None:
        avoidance = ObstacleAvoidance()
        avoidance.update_vision_decision(
            make_decision(action="steer_left", yaw_adjustment=0.4, speed_factor=0.8),
        )
        fwd, _lat, yaw = avoidance.modify_command(0.6, 0.0, 0.0)
        self.assertGreater(yaw, 0.2)
        self.assertLess(fwd, 0.6)

    def test_steer_right_decreases_yaw(self) -> None:
        avoidance = ObstacleAvoidance()
        avoidance.update_vision_decision(
            make_decision(action="steer_right", yaw_adjustment=0.5, speed_factor=0.9),
        )
        fwd, _lat, yaw = avoidance.modify_command(0.7, 0.0, 0.1)
        self.assertLess(yaw, -0.1)
        self.assertLess(fwd, 0.7)

    def test_turn_around_reduces_forward_and_rotates(self) -> None:
        avoidance = ObstacleAvoidance()
        avoidance.update_vision_decision(
            make_decision(action="turn_around", yaw_adjustment=0.8, speed_factor=0.6),
        )
        fwd, lat, yaw = avoidance.modify_command(0.9, 0.2, 0.0)
        self.assertLessEqual(fwd, 0.12)
        self.assertAlmostEqual(lat, 0.0)
        self.assertGreater(abs(yaw), 0.5)

    def test_terrain_drop_reduces_speed(self) -> None:
        avoidance = ObstacleAvoidance(drop_m=0.8)
        avoidance.update_terrain_probe(
            {
                "baseHeightM": 3.0,
                "samples": [
                    {"bearingDeg": 0.0, "distanceM": 2.0, "deltaM": -1.3},
                    {"bearingDeg": -15.0, "distanceM": 2.5, "deltaM": -1.0},
                ],
            }
        )
        fwd, _lat, _yaw = avoidance.modify_command(0.8, 0.0, 0.0)
        self.assertLess(fwd, 0.4)

    def test_terrain_and_vision_combined(self) -> None:
        avoidance = ObstacleAvoidance()
        avoidance.update_terrain_probe(
            {
                "baseHeightM": 5.0,
                "samples": [
                    {"bearingDeg": 0.0, "distanceM": 2.0, "deltaM": 2.0},
                ],
            }
        )
        avoidance.update_vision_decision(
            make_decision(action="slow_down", yaw_adjustment=0.0, speed_factor=0.8),
        )
        fwd, _lat, _yaw = avoidance.modify_command(1.0, 0.0, 0.0)
        self.assertLess(fwd, 0.5)

    def test_center_hazard_with_unequal_sides_biases_left(self) -> None:
        avoidance = ObstacleAvoidance()
        avoidance.update_terrain_probe(
            {
                "baseHeightM": 2.0,
                "samples": [
                    {"bearingDeg": 0.0, "distanceM": 2.0, "deltaM": 1.8},
                    {"bearingDeg": 30.0, "distanceM": 2.0, "deltaM": 2.2},
                ],
            }
        )
        _fwd, _lat, yaw = avoidance.modify_command(0.8, 0.0, 0.0)
        self.assertGreater(yaw, 0.25)

    def test_severe_center_terrain_blocks_forward(self) -> None:
        avoidance = ObstacleAvoidance()
        avoidance.update_terrain_probe(
            {
                "baseHeightM": 1.0,
                "samples": [
                    {"bearingDeg": 0.0, "distanceM": 2.0, "deltaM": 0.9},
                    {"bearingDeg": 10.0, "distanceM": 2.5, "deltaM": 0.7},
                ],
            }
        )
        fwd, lat, yaw = avoidance.modify_command(0.8, 0.1, 0.0)
        self.assertAlmostEqual(fwd, 0.0)
        self.assertAlmostEqual(lat, 0.0)
        self.assertGreater(abs(yaw), 0.3)

    def test_surface_structure_delta_blocks_forward(self) -> None:
        avoidance = ObstacleAvoidance()
        avoidance.update_terrain_probe(
            {
                "baseHeightM": 2.0,
                "samples": [
                    {
                        "bearingDeg": 2.0,
                        "distanceM": 2.8,
                        "deltaM": 0.2,
                        "surfaceDeltaM": 1.4,
                    }
                ],
            }
        )
        fwd, _lat, _yaw = avoidance.modify_command(0.6, 0.0, 0.0)
        self.assertLessEqual(fwd, 0.08)

    def test_dynamic_obstacle_blocks_forward(self) -> None:
        avoidance = ObstacleAvoidance()
        avoidance.update_dynamic_obstacles(
            [
                {"forwardM": 1.8, "lateralM": 0.4, "radiusM": 1.1},
            ]
        )
        fwd, _lat, yaw = avoidance.modify_command(0.7, 0.0, 0.0)
        self.assertAlmostEqual(fwd, 0.0)
        self.assertGreater(abs(yaw), 0.2)


if __name__ == "__main__":
    unittest.main()
