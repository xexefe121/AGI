"""MuJoCo runner for the Unitree G1 pretrained policy."""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Callable, Tuple

import mujoco
import numpy as np
import torch
import yaml

from autonav.config import load_project_paths


@dataclass
class MujocoConfig:
    policy_path: str
    xml_path: str
    simulation_duration: float
    simulation_dt: float
    control_decimation: int
    kps: np.ndarray
    kds: np.ndarray
    default_angles: np.ndarray
    ang_vel_scale: float
    dof_pos_scale: float
    dof_vel_scale: float
    action_scale: float
    cmd_scale: np.ndarray
    num_actions: int
    num_obs: int
    cmd_init: np.ndarray


CmdProvider = Callable[[float, np.ndarray], Tuple[float, float, float] | None]
PoseCallback = Callable[[float, np.ndarray, np.ndarray], None]
RealtimeScaleProvider = Callable[[], float]


def _load_config(config_path: str, legged_gym_root: str) -> MujocoConfig:
    with open(config_path, "r", encoding="utf-8") as handle:
        raw = yaml.load(handle, Loader=yaml.FullLoader)

    def resolve(value: str) -> str:
        return value.replace("{LEGGED_GYM_ROOT_DIR}", legged_gym_root)

    return MujocoConfig(
        policy_path=resolve(raw["policy_path"]),
        xml_path=resolve(raw["xml_path"]),
        simulation_duration=float(raw["simulation_duration"]),
        simulation_dt=float(raw["simulation_dt"]),
        control_decimation=int(raw["control_decimation"]),
        kps=np.array(raw["kps"], dtype=np.float32),
        kds=np.array(raw["kds"], dtype=np.float32),
        default_angles=np.array(raw["default_angles"], dtype=np.float32),
        ang_vel_scale=float(raw["ang_vel_scale"]),
        dof_pos_scale=float(raw["dof_pos_scale"]),
        dof_vel_scale=float(raw["dof_vel_scale"]),
        action_scale=float(raw["action_scale"]),
        cmd_scale=np.array(raw["cmd_scale"], dtype=np.float32),
        num_actions=int(raw["num_actions"]),
        num_obs=int(raw["num_obs"]),
        cmd_init=np.array(raw["cmd_init"], dtype=np.float32),
    )


def _get_gravity_orientation(quaternion: np.ndarray) -> np.ndarray:
    qw = quaternion[0]
    qx = quaternion[1]
    qy = quaternion[2]
    qz = quaternion[3]

    gravity_orientation = np.zeros(3)
    gravity_orientation[0] = 2 * (-qz * qx + qw * qy)
    gravity_orientation[1] = -2 * (qz * qy + qw * qx)
    gravity_orientation[2] = 1 - 2 * (qw * qw + qz * qz)

    return gravity_orientation


def _pd_control(target_q: np.ndarray, q: np.ndarray, kp: np.ndarray, target_dq: np.ndarray, dq: np.ndarray, kd: np.ndarray) -> np.ndarray:
    return (target_q - q) * kp + (target_dq - dq) * kd


class G1MujocoRunner:
    def __init__(
        self,
        config_path: str,
        legged_gym_root: str | None = None,
        cmd_provider: CmdProvider | None = None,
        pose_callback: PoseCallback | None = None,
    ) -> None:
        paths = load_project_paths()
        self.legged_gym_root = legged_gym_root or paths.legged_gym_root
        self.cfg = _load_config(config_path, self.legged_gym_root)

        self.cmd_provider = cmd_provider
        self.pose_callback = pose_callback

        self.action = np.zeros(self.cfg.num_actions, dtype=np.float32)
        self.target_dof_pos = self.cfg.default_angles.copy()
        self.obs = np.zeros(self.cfg.num_obs, dtype=np.float32)
        # Never auto-walk on boot; movement must come from explicit commands.
        self.cmd = np.zeros_like(self.cfg.cmd_init, dtype=np.float32)
        self._idle_root_pos: np.ndarray | None = None

        self.model = mujoco.MjModel.from_xml_path(self.cfg.xml_path)
        self.data = mujoco.MjData(self.model)
        self.model.opt.timestep = self.cfg.simulation_dt

        self.policy = torch.jit.load(self.cfg.policy_path)

    def _policy_step(self, counter: int, sim_time: float) -> None:
        if counter % self.cfg.control_decimation != 0:
            return

        if self.cmd_provider:
            updated_cmd = self.cmd_provider(sim_time, self.data.qpos)
            if updated_cmd is not None:
                self.cmd = np.array(updated_cmd, dtype=np.float32)

        # Keep the robot in a stable standing pose when idle (no navigation command).
        if float(np.linalg.norm(self.cmd)) < 1e-4:
            self.action.fill(0.0)
            self.target_dof_pos = self.cfg.default_angles.copy()
            if self._idle_root_pos is None:
                self._idle_root_pos = self.data.qpos[:7].copy()
            self.data.qpos[:3] = self._idle_root_pos[:3]
            self.data.qpos[3:7] = self._idle_root_pos[3:7]
            self.data.qvel[:6] = 0.0
            if self.pose_callback:
                self.pose_callback(sim_time, self.data.qpos.copy(), self.data.qvel.copy())
            return
        self._idle_root_pos = None

        qj = self.data.qpos[7:]
        dqj = self.data.qvel[6:]
        quat = self.data.qpos[3:7]
        omega = self.data.qvel[3:6]

        qj = (qj - self.cfg.default_angles) * self.cfg.dof_pos_scale
        dqj = dqj * self.cfg.dof_vel_scale
        gravity_orientation = _get_gravity_orientation(quat)
        omega = omega * self.cfg.ang_vel_scale

        period = 0.8
        phase = (sim_time % period) / period
        sin_phase = np.sin(2 * np.pi * phase)
        cos_phase = np.cos(2 * np.pi * phase)

        self.obs[:3] = omega
        self.obs[3:6] = gravity_orientation
        self.obs[6:9] = self.cmd * self.cfg.cmd_scale
        self.obs[9 : 9 + self.cfg.num_actions] = qj
        self.obs[9 + self.cfg.num_actions : 9 + 2 * self.cfg.num_actions] = dqj
        self.obs[9 + 2 * self.cfg.num_actions : 9 + 3 * self.cfg.num_actions] = self.action
        self.obs[9 + 3 * self.cfg.num_actions : 9 + 3 * self.cfg.num_actions + 2] = np.array([sin_phase, cos_phase])

        obs_tensor = torch.from_numpy(self.obs).unsqueeze(0)
        self.action = self.policy(obs_tensor).detach().numpy().squeeze()
        self.target_dof_pos = self.action * self.cfg.action_scale + self.cfg.default_angles

        if self.pose_callback:
            self.pose_callback(sim_time, self.data.qpos.copy(), self.data.qvel.copy())

    def _apply_pd_control(self) -> None:
        tau = _pd_control(self.target_dof_pos, self.data.qpos[7:], self.cfg.kps, np.zeros_like(self.cfg.kds), self.data.qvel[6:], self.cfg.kds)
        self.data.ctrl[:] = tau

    def run(
        self,
        duration_s: float | None = None,
        headless: bool = False,
        realtime_scale_provider: RealtimeScaleProvider | None = None,
    ) -> None:
        duration = duration_s if duration_s is not None else self.cfg.simulation_duration

        start = time.time()
        counter = 0

        if headless:
            while time.time() - start < duration:
                step_start = time.time()
                sim_time = float(self.data.time)

                self._apply_pd_control()
                mujoco.mj_step(self.model, self.data)

                counter += 1
                self._policy_step(counter, sim_time)

                realtime_scale = 1.0
                if realtime_scale_provider is not None:
                    try:
                        realtime_scale = float(realtime_scale_provider())
                    except Exception:
                        realtime_scale = 1.0
                realtime_scale = max(0.25, min(10.0, realtime_scale))
                step_period = self.model.opt.timestep / realtime_scale
                time_until_next_step = step_period - (time.time() - step_start)
                if time_until_next_step > 0:
                    time.sleep(time_until_next_step)
            return

        import mujoco.viewer as mj_viewer

        with mj_viewer.launch_passive(self.model, self.data) as viewer:
            # Reset to MuJoCo's default free camera based on model statistics.
            mujoco.mjv_defaultFreeCamera(self.model, viewer.cam)
            # Chase cam: keep a free camera but lock the look-at point to the robot.
            viewer.cam.type = mujoco.mjtCamera.mjCAMERA_FREE
            try:
                chase_id = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, "pelvis")
            except Exception:
                chase_id = -1
            # Keep a reasonable default distance if it wasn't set by the model stats.
            if not math.isfinite(viewer.cam.distance) or viewer.cam.distance <= 0:
                viewer.cam.distance = max(1.0, 2.0 * float(self.model.stat.extent))
            render_period_s = 1.0 / 30.0
            next_step_wall = time.perf_counter()
            next_render_wall = next_step_wall
            while viewer.is_running() and time.time() - start < duration:
                now = time.perf_counter()
                realtime_scale = 1.0
                if realtime_scale_provider is not None:
                    try:
                        realtime_scale = float(realtime_scale_provider())
                    except Exception:
                        realtime_scale = 1.0
                realtime_scale = max(0.25, min(10.0, realtime_scale))
                step_period = max(1e-6, self.model.opt.timestep / realtime_scale)

                # If the loop hitches, clamp debt so we keep interactive control.
                if now - next_step_wall > 0.5:
                    next_step_wall = now - 0.01

                steps = 0
                while now >= next_step_wall and steps < 128:
                    sim_time = float(self.data.time)
                    self._apply_pd_control()
                    mujoco.mj_step(self.model, self.data)

                    counter += 1
                    self._policy_step(counter, sim_time)
                    next_step_wall += step_period
                    steps += 1
                    now = time.perf_counter()

                if now >= next_render_wall:
                    if chase_id >= 0:
                        viewer.cam.lookat[:] = self.data.xpos[chase_id]
                    viewer.sync()
                    next_render_wall = now + render_period_s

                sleep_until = min(next_step_wall, next_render_wall)
                remaining = sleep_until - time.perf_counter()
                if remaining > 0:
                    time.sleep(min(remaining, 0.004))
