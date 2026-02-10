import time
import unittest

from autonav.web.server import PerceptionHub


class PerceptionHubTests(unittest.TestCase):
    def test_terrain_probe_sequence_drops_out_of_order(self) -> None:
        hub = PerceptionHub()
        accepted_1 = hub.update_terrain_probe(
            {
                "seq": 10,
                "capturedAtMs": 1000,
                "baseHeightM": 4.0,
                "samples": [{"bearingDeg": 0.0, "distanceM": 2.0, "deltaM": 0.2}],
            }
        )
        accepted_2 = hub.update_terrain_probe(
            {
                "seq": 9,
                "capturedAtMs": 900,
                "baseHeightM": 4.0,
                "samples": [{"bearingDeg": 0.0, "distanceM": 2.0, "deltaM": 0.1}],
            }
        )

        self.assertTrue(accepted_1)
        self.assertFalse(accepted_2)
        latest = hub.get_latest_terrain()
        self.assertIsNotNone(latest)
        assert latest is not None
        self.assertEqual(latest.get("seq"), 10)
        self.assertGreaterEqual(int(latest.get("outOfOrderDrops", 0)), 1)

    def test_terrain_probe_max_age_filter(self) -> None:
        hub = PerceptionHub()
        hub.update_terrain_probe(
            {
                "seq": 1,
                "capturedAtMs": 100,
                "baseHeightM": 4.0,
                "samples": [{"bearingDeg": 0.0, "distanceM": 2.0, "deltaM": 0.2}],
            }
        )
        fresh = hub.get_latest_terrain(max_age_s=1.0)
        self.assertIsNotNone(fresh)

        time.sleep(0.15)
        stale = hub.get_latest_terrain(max_age_s=0.05)
        self.assertIsNone(stale)

    def test_dynamic_obstacle_sequence_and_age_filter(self) -> None:
        hub = PerceptionHub()
        accepted_1 = hub.update_dynamic_obstacles(
            {
                "seq": 4,
                "capturedAtMs": 1000,
                "obstacles": [
                    {
                        "id": "car-1",
                        "lat": -33.85,
                        "lon": 151.21,
                        "radiusM": 1.8,
                        "kind": "vehicle",
                        "speedMps": 8.0,
                    }
                ],
            }
        )
        accepted_2 = hub.update_dynamic_obstacles(
            {
                "seq": 3,
                "capturedAtMs": 990,
                "obstacles": [],
            }
        )
        self.assertTrue(accepted_1)
        self.assertFalse(accepted_2)
        latest = hub.get_latest_dynamic_obstacles(max_age_s=1.0)
        self.assertIsNotNone(latest)
        assert latest is not None
        self.assertEqual(latest.get("seq"), 4)
        self.assertGreaterEqual(int(latest.get("outOfOrderDrops", 0)), 1)
        time.sleep(0.12)
        self.assertIsNone(hub.get_latest_dynamic_obstacles(max_age_s=0.05))


if __name__ == "__main__":
    unittest.main()
