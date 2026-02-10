# AGI Autonomous Geonavigation Intelligence

AGI (Autonomous Geonavigation Intelligence) is a terrain-aware robot navigation stack that couples a MuJoCo Unitree G1 simulation with a Cesium web visualization and a React control UI.

## What AGI does

- Runs Unitree G1 in MuJoCo.
- Streams robot pose and runtime telemetry over WebSocket.
- Visualizes the robot and terrain context in Cesium.
- Plans routes from prompt/start/goal using Gemini and optional Google Maps walking directions.
- Applies terrain and obstacle guardrails so navigation behavior stays realistic.

## Repository layout

- `scripts/run_web_stack.py`: main local entrypoint (MuJoCo + web API + WebSocket).
- `autonav/web/server.py`: aiohttp API and websocket server (`/config`, `/api/plan`, `/api/start`, `/api/stop`, `/ws`).
- `autonav/brain/`: route planning and model clients (Gemini, Google Maps fallback chain).
- `autonav/sim/mujoco_g1.py`: MuJoCo runner integration.
- `autonav/nav/`: waypoint following and obstacle/terrain avoidance logic.
- `packages/web/`: Cesium + React frontend.

## Prerequisites

- Python 3.10+
- Node.js 18+ and npm
- A Unitree RL Gym checkout (or equivalent deploy config) available at:
  - `third_party/unitree_rl_gym` (default)
  - or set `LEGGED_GYM_ROOT_DIR` in `.env`

Recommended API keys:

- `VITE_CESIUM_TOKEN` (required for full Cesium world rendering)
- `VITE_MAPBOX_TOKEN` (optional minimap enhancements)
- `VITE_GEMINI_API_KEY` / `GEMINI_API_KEY` (optional Gemini planning/vision)
- `VITE_GOOGLE_MAPS_API_KEY` / `GOOGLE_MAPS_API_KEY` (optional Google Maps route source)

## Installation

### 1. Clone

```bash
git clone https://github.com/xexefe121/AGI.git
cd AGI
```

### 2. Python environment

```bash
python -m venv .venv
. .venv/Scripts/activate  # Windows PowerShell: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 3. Frontend dependencies

```bash
npm --prefix packages/web install
```

### 4. Configure `.env`

Create `.env` at repo root:

```bash
# Required for full Cesium world
VITE_CESIUM_TOKEN=your_cesium_token

# Optional
VITE_MAPBOX_TOKEN=your_mapbox_token
VITE_GEMINI_API_KEY=your_gemini_key
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key

# Backend equivalents (used by Python services)
GEMINI_API_KEY=your_gemini_key
GOOGLE_MAPS_API_KEY=your_google_maps_key

# Optional override if unitree config is not in third_party/unitree_rl_gym
LEGGED_GYM_ROOT_DIR=H:/path/to/unitree_rl_gym
```

## Run locally

### Terminal A: MuJoCo + backend stack

```bash
python scripts/run_web_stack.py
```

Useful options:

```bash
python scripts/run_web_stack.py --help
python scripts/run_web_stack.py --headless
python scripts/run_web_stack.py --start "-33.8582722,151.2147663" --goal "-33.8567844,151.2152967"
python scripts/run_web_stack.py --max-client-pose-hz 30 --vision-hz 0.5
```

### Terminal B: frontend dev server

```bash
npm --prefix packages/web run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open:

- `http://127.0.0.1:5173` (frontend)
- backend defaults to `http://127.0.0.1:8080`

## How AGI works

1. `run_web_stack.py` creates a route plan (Gemini + Google Maps fallback chain).
2. `RouteState` stores waypoints and runtime navigation state.
3. MuJoCo runs the G1 simulation and emits root/link poses.
4. PoseHub broadcasts latest pose payload to web clients over `/ws`.
5. Frontend `G1Robot` consumes stream data, applies model transforms, and visualizes movement in Cesium.
6. Frontend sends terrain probes and dynamic obstacle snapshots back to backend.
7. Backend avoidance logic applies terrain/obstacle constraints before final movement commands.

## Runtime controls

- `Esc`: open/close Settings
- `P`: toggle Gemini Control (prompt/start/goal + Plan/Start/Stop)
- Camera free roam in free mode:
  - hold RMB to look
  - `WASD` move
  - `Q/E` vertical
  - `Shift` fast, `Ctrl` slow

## Spawn and route defaults

Default demo spawn is set near Sydney Opera House Forecourt:

- start: `-33.8582722, 151.2147663`
- goal: `-33.8567844, 151.2152967`

Environment overrides:

- `DEFAULT_START_LATLON`
- `DEFAULT_GOAL_LATLON`
- `FORCE_START_LATLON`
- `FORCE_GOAL_LATLON`

## Troubleshooting

### Black/empty Cesium world

- Ensure `VITE_CESIUM_TOKEN` is valid.
- If token is missing/placeholder, token setup UI will block startup.

### Robot appears underground

- Hard refresh browser (`Ctrl+F5`) after updates.
- Confirm backend `/config` start coordinates are correct.
- Check terrain tiles have loaded before evaluating spawn position.

### Google Maps route not used

- Set `GOOGLE_MAPS_API_KEY` (and optionally `VITE_GOOGLE_MAPS_API_KEY`).
- Without key, planner falls back to Gemini/linear routing and reports warning in UI.

### Gemini route/vision unavailable

- Set `GEMINI_API_KEY` and/or `VITE_GEMINI_API_KEY`.

## Validation

- Frontend build:

```bash
npm --prefix packages/web run build
```

- Python tests (if available in current workspace):

```bash
python -m unittest discover -s tests -p "test_*.py" -v
```

