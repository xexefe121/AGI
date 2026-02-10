import unittest
from unittest.mock import patch

from autonav.brain.route_planner import plan_route


class RouteMetadataTests(unittest.TestCase):
    def test_linear_fallback_sets_metadata(self) -> None:
        plan = plan_route(
            prompt=None,
            start_latlon=(-33.85950, 151.21350),
            goal_latlon=(-33.85700, 151.21530),
            max_waypoints=8,
            use_google_maps=False,
            use_gemini=False,
        )
        self.assertEqual(plan.source, "linear")
        self.assertFalse(plan.google_maps_requested)
        self.assertFalse(plan.google_maps_used)
        self.assertGreater(plan.distance_m, 0.0)
        self.assertEqual(plan.warning, "")
        self.assertTrue(plan.route_source_verified)

    def test_google_maps_failure_emits_warning(self) -> None:
        with patch("autonav.brain.route_planner.GoogleMapsClient", side_effect=RuntimeError("quota exceeded")):
            plan = plan_route(
                prompt=None,
                start_latlon=(-33.85950, 151.21350),
                goal_latlon=(-33.85700, 151.21530),
                max_waypoints=8,
                use_google_maps=True,
                use_gemini=False,
            )
        self.assertTrue(plan.google_maps_requested)
        self.assertFalse(plan.google_maps_used)
        self.assertIn("Google Maps", plan.warning)
        self.assertIn("fallback", plan.warning.lower())
        self.assertIn(plan.source, {"linear", "gemini"})
        self.assertTrue(plan.route_source_verified)


if __name__ == "__main__":
    unittest.main()
