"""Gemini brain reasoning loop."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional, Tuple

from autonav.brain.commands import BrainCommand
from autonav.brain.route_planner import plan_route


DEFAULT_MISSION_PROMPT = "from Circular Quay, Sydney to Sydney Opera House"


@dataclass(frozen=True)
class BrainInput:
    prompt: Optional[str]
    start_latlon: Optional[Tuple[float, float]]
    goal_latlon: Optional[Tuple[float, float]]
    max_waypoints: int
    use_google_maps: bool
    use_gemini: bool


class GeminiBrain:
    def __init__(self, mission_prompt: str = DEFAULT_MISSION_PROMPT):
        self.mission_prompt = mission_prompt

    def reasoning_loop(self, brain_input: BrainInput) -> Iterable[BrainCommand]:
        prompt = brain_input.prompt
        if not prompt and brain_input.start_latlon is None and brain_input.goal_latlon is None:
            prompt = self.mission_prompt
            yield BrainCommand.status(f"Default mission: {prompt}")

        yield BrainCommand.status("Planning route...")
        try:
            plan = plan_route(
                prompt=prompt or None,
                start_latlon=brain_input.start_latlon,
                goal_latlon=brain_input.goal_latlon,
                max_waypoints=brain_input.max_waypoints,
                use_google_maps=brain_input.use_google_maps,
                use_gemini=brain_input.use_gemini,
            )
        except Exception as exc:
            yield BrainCommand.error(str(exc))
            return

        yield BrainCommand.set_plan(plan)
        yield BrainCommand.start_navigation()

    def run(
        self,
        *,
        prompt: Optional[str],
        start_latlon: Optional[Tuple[float, float]],
        goal_latlon: Optional[Tuple[float, float]],
        max_waypoints: int = 12,
        use_google_maps: bool = True,
        use_gemini: bool = True,
    ) -> List[BrainCommand]:
        brain_input = BrainInput(
            prompt=prompt,
            start_latlon=start_latlon,
            goal_latlon=goal_latlon,
            max_waypoints=max_waypoints,
            use_google_maps=use_google_maps,
            use_gemini=use_gemini,
        )
        return list(self.reasoning_loop(brain_input))

    def replan_with_vision(
        self,
        *,
        start_latlon: Tuple[float, float],
        goal_latlon: Tuple[float, float],
        vision_context: str,
        max_waypoints: int = 12,
        use_google_maps: bool = True,
        use_gemini: bool = True,
    ) -> List[BrainCommand]:
        commands: List[BrainCommand] = []
        context_snippet = vision_context.strip()
        if context_snippet:
            if len(context_snippet) > 220:
                context_snippet = context_snippet[:217] + "..."
            commands.append(BrainCommand.status(f"Vision-triggered replan: {context_snippet}"))
        else:
            commands.append(BrainCommand.status("Vision-triggered replan."))

        try:
            plan = plan_route(
                prompt=None,
                start_latlon=start_latlon,
                goal_latlon=goal_latlon,
                max_waypoints=max_waypoints,
                use_google_maps=use_google_maps,
                use_gemini=use_gemini,
                route_context=vision_context,
            )
        except Exception as exc:
            commands.append(BrainCommand.error(str(exc)))
            return commands

        commands.append(BrainCommand.set_plan(plan))
        commands.append(BrainCommand.start_navigation())
        return commands
