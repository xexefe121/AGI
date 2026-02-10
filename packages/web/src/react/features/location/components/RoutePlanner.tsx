import { useEffect, useMemo, useState } from 'react';
import { useGameMethod } from '../../../hooks/useGameMethod';
import { useGameEvent } from '../../../hooks/useGameEvent';

function parseLatLon(value: string): [number, number] | undefined {
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length !== 2) return undefined;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return [lat, lon];
}

export function RoutePlanner() {
  const {
    planRoute,
    startNavigation,
    stopNavigation,
    getAutonavConfig,
    getStreamState,
    getLastStatusMessage,
    getSimulationSpeed,
    setSimulationSpeed,
    getCurrentSimulationSpeed,
  } = useGameMethod();
  const streamState = useGameEvent('streamStateChanged');
  const statusEvent = useGameEvent('statusChanged');
  const routeEvent = useGameEvent('routeChanged');

  const [prompt, setPrompt] = useState('');
  const [start, setStart] = useState('');
  const [goal, setGoal] = useState('');
  const [useGemini, setUseGemini] = useState(true);
  const [useGoogleMaps, setUseGoogleMaps] = useState(true);
  const [busy, setBusy] = useState(false);
  const [speedBusy, setSpeedBusy] = useState(false);
  const [status, setStatus] = useState(getLastStatusMessage() || 'Booting...');
  const [routeText, setRouteText] = useState('No route loaded.');
  const [streamLabel, setStreamLabel] = useState(getStreamState());
  const [simSpeed, setSimSpeed] = useState(getCurrentSimulationSpeed());

  useEffect(() => {
    void getAutonavConfig().then((config) => {
      if (!config) return;
      if (config.start) {
        setStart(`${config.start[0].toFixed(6)},${config.start[1].toFixed(6)}`);
      }
      if (config.goal) {
        setGoal(`${config.goal[0].toFixed(6)},${config.goal[1].toFixed(6)}`);
      }
      if (Array.isArray(config.waypoints)) {
        setRouteText(`Route: ${config.waypoints.length} waypoints`);
      }
      if (config.notes) {
        setStatus(config.notes);
      }
    });
    void getSimulationSpeed()
      .then((value) => setSimSpeed(value))
      .catch(() => {
        // Keep local default if speed endpoint is unavailable.
      });
    setStreamLabel(getStreamState());
    const lastStatus = getLastStatusMessage();
    if (lastStatus) {
      setStatus(lastStatus);
    }
  }, []);

  useEffect(() => {
    if (statusEvent?.message) {
      setStatus(statusEvent.message);
    }
  }, [statusEvent]);

  useEffect(() => {
    if (streamState?.state) {
      setStreamLabel(streamState.state);
    }
  }, [streamState]);

  useEffect(() => {
    if (routeEvent) {
      setRouteText(`Route: ${routeEvent.waypoints.length} waypoints`);
      if (routeEvent.start) {
        setStart(`${routeEvent.start[0].toFixed(6)},${routeEvent.start[1].toFixed(6)}`);
      }
      if (routeEvent.goal) {
        setGoal(`${routeEvent.goal[0].toFixed(6)},${routeEvent.goal[1].toFixed(6)}`);
      }
    }
  }, [routeEvent]);

  const streamClass = useMemo(() => {
    if (streamLabel === 'live') return 'text-emerald-300';
    if (streamLabel === 'connecting') return 'text-amber-300';
    return 'text-rose-300';
  }, [streamLabel]);

  const submitPlan = async () => {
    setBusy(true);
    try {
      const result = await planRoute({
        prompt: prompt.trim() || null,
        start: parseLatLon(start),
        goal: parseLatLon(goal),
        useGemini,
        useGoogleMaps,
      });
      setStatus(result.notes || 'Route planned. Press Start Walking.');
      setRouteText(`Route: ${result.waypoints.length} waypoints`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Plan failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const startPlan = async () => {
    setBusy(true);
    try {
      const running = await startNavigation(true);
      setStatus(running ? 'Navigation started.' : 'Unable to start: plan a route first.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Start failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const stopPlan = async () => {
    setBusy(true);
    try {
      await stopNavigation();
      setStatus('Navigation stopped.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Stop failed: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const setSpeed = async (next: number) => {
    setSpeedBusy(true);
    try {
      const applied = await setSimulationSpeed(next);
      setSimSpeed(applied);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Speed change failed: ${message}`);
    } finally {
      setSpeedBusy(false);
    }
  };

  return (
    <div className="fixed top-20 left-8 z-50 w-[340px] max-w-[calc(100vw-2rem)] glass-panel pointer-events-auto">
      <div className="px-4 py-3 border-b border-white/10">
        <div className="text-sm font-semibold text-white">Unitree G1 Planner</div>
        <div className="text-[11px] text-white/60 mt-1">MuJoCo + Gemini + Cesium</div>
      </div>

      <div className="p-4 space-y-3">
        <label className="block">
          <div className="text-[10px] uppercase tracking-wider text-white/60 mb-1">Prompt</div>
          <input
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="go to opera house from circular quay"
            className="w-full rounded-md bg-black/30 border border-white/20 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-future-primary"
          />
        </label>

        <label className="block">
          <div className="text-[10px] uppercase tracking-wider text-white/60 mb-1">Start (lat,lon)</div>
          <input
            type="text"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            placeholder="-33.858334,151.213847"
            className="w-full rounded-md bg-black/30 border border-white/20 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-future-primary"
          />
        </label>

        <label className="block">
          <div className="text-[10px] uppercase tracking-wider text-white/60 mb-1">Goal (lat,lon)</div>
          <input
            type="text"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="-33.857200,151.216600"
            className="w-full rounded-md bg-black/30 border border-white/20 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-future-primary"
          />
        </label>

        <label className="flex items-center gap-2 text-xs text-white/80">
          <input
            type="checkbox"
            checked={useGemini}
            onChange={(event) => setUseGemini(event.target.checked)}
            className="rounded border-white/30 bg-black/20"
          />
          Use Gemini planner
        </label>

        <label className="flex items-center gap-2 text-xs text-white/80">
          <input
            type="checkbox"
            checked={useGoogleMaps}
            onChange={(event) => setUseGoogleMaps(event.target.checked)}
            className="rounded border-white/30 bg-black/20"
          />
          Use Google Maps walking route
        </label>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => void submitPlan()}
            disabled={busy}
            className="flex-1 rounded-md bg-future-primary/80 hover:bg-future-primary disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
          >
            Plan Route
          </button>
          <button
            type="button"
            onClick={() => void startPlan()}
            disabled={busy}
            className="flex-1 rounded-md bg-emerald-500/80 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
          >
            Start
          </button>
          <button
            type="button"
            onClick={() => void stopPlan()}
            disabled={busy}
            className="flex-1 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white text-sm font-medium py-2 transition-colors"
          >
            Stop
          </button>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/60 mb-1">Simulation Speed</div>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 5].map((factor) => {
              const active = Math.abs(simSpeed - factor) < 0.01;
              return (
                <button
                  key={factor}
                  type="button"
                  onClick={() => void setSpeed(factor)}
                  disabled={speedBusy}
                  className={`rounded-md border py-2 text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-sky-500/80 border-sky-300 text-white'
                      : 'bg-black/20 border-white/20 text-white/80 hover:bg-white/10'
                  } disabled:opacity-50`}
                >
                  {factor}x
                </button>
              );
            })}
          </div>
        </div>

        <div className="text-xs text-white/70 bg-black/20 rounded-md px-3 py-2">{status}</div>
        <div className="text-xs text-white/70 bg-black/20 rounded-md px-3 py-2">{routeText}</div>
        <div className="text-xs text-white/70">
          Stream: <span className={streamClass}>{streamLabel}</span>
        </div>
      </div>
    </div>
  );
}
