import unittest

from autonav.brain.route_planner import RoutePlan
from autonav.nav.geo import latlon_to_local_m
from autonav.web.server import RouteState


class RouteStateMetricsTests(unittest.TestCase):
    def _make_plan(self) -> RoutePlan:
        waypoints = [
            (-33.85950, 151.21350),
            (-33.85890, 151.21420),
            (-33.85830, 151.21490),
            (-33.85770, 151.21560),
        ]
        return RoutePlan(
            start_latlon=waypoints[0],
            goal_latlon=waypoints[-1],
            waypoints=waypoints,
            notes="test route",
            source="linear",
            google_maps_requested=False,
            google_maps_used=False,
        )

    def test_cross_track_progress_and_off_route(self) -> None:
        plan = self._make_plan()
        route_state = RouteState(plan.start_latlon)
        route_state.set_plan(plan)

        start_metrics = route_state.get_route_follow_metrics((0.0, 0.0))
        self.assertLessEqual(start_metrics["crossTrackErrorM"], 0.25)
        self.assertLess(start_metrics["progressPct"], 5.0)
        self.assertFalse(start_metrics["offRoute"])

        far_metrics = route_state.get_route_follow_metrics((80.0, 60.0))
        self.assertTrue(far_metrics["offRoute"])
        self.assertGreater(far_metrics["crossTrackErrorM"], 3.0)

    def test_progress_reaches_high_near_goal(self) -> None:
        plan = self._make_plan()
        route_state = RouteState(plan.start_latlon)
        route_state.set_plan(plan)

        gx, gy = latlon_to_local_m(plan.goal_latlon[0], plan.goal_latlon[1], plan.start_latlon[0], plan.start_latlon[1])
        near_goal = route_state.get_route_follow_metrics((gx - 0.2, gy - 0.2))
        self.assertGreater(near_goal["progressPct"], 90.0)
        self.assertLess(near_goal["crossTrackErrorM"], 2.0)


if __name__ == "__main__":
    unittest.main()
