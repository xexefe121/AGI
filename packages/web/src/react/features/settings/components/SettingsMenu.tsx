import { useEffect, useMemo, useState } from 'react';
import { useGameMethod } from '../../../hooks/useGameMethod';
import { useGameEvent } from '../../../hooks/useGameEvent';
import { QualityControls } from '../../debug/components/QualityControls';
import { QualityPresets } from '../../debug/components/QualityPresets';
import { useQualitySettings } from '../../debug/hooks/useQualitySettings';
import { getTokens } from '../../../../utils/tokenValidator';
import { getDebugVisibility, setDebugVisibility } from '../../debug/debugVisibility';

type SettingsTab = 'performance' | 'vision' | 'runtime';

interface SettingsStateV2 {
  tab: SettingsTab;
  visionEnabled: boolean;
  debugOverlays: boolean;
  trafficEnabled: boolean;
}

interface QuickPreset {
  label: string;
  prompt: string;
}

const STORAGE_KEY = 'settings_ui_v2';

const QUICK_ROUTE_PRESETS: QuickPreset[] = [
  {
    label: 'Sidewalk safe',
    prompt: 'Navigate to the destination while staying on sidewalks and avoiding roads.',
  },
  {
    label: 'Fastest route',
    prompt: 'Take the fastest walking-safe route to the destination.',
  },
  {
    label: 'Avoid obstacles',
    prompt: 'Navigate safely while maintaining distance from obstacles and people.',
  },
  {
    label: 'Scenic route',
    prompt: 'Take a scenic pedestrian-friendly route with visible landmarks.',
  },
];

function sourceLabel(source?: string): string {
  const key = String(source || '').toLowerCase();
  if (key === 'google_maps') return 'Google Maps';
  if (key === 'gemini') return 'Gemini';
  if (key === 'linear') return 'Linear fallback';
  return 'Unknown';
}

function loadSettings(): SettingsStateV2 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        tab: 'runtime',
        visionEnabled: true,
        debugOverlays: getDebugVisibility(),
        trafficEnabled: true,
      };
    }
    const parsed = JSON.parse(raw) as Partial<SettingsStateV2>;
    const tabValue = parsed.tab;
    const tab: SettingsTab =
      tabValue === 'performance' || tabValue === 'vision' || tabValue === 'runtime'
        ? tabValue
        : 'runtime';
    return {
      tab,
      visionEnabled: parsed.visionEnabled ?? true,
      debugOverlays: parsed.debugOverlays ?? getDebugVisibility(),
      trafficEnabled: parsed.trafficEnabled ?? true,
    };
  } catch {
    return {
      tab: 'runtime',
      visionEnabled: true,
      debugOverlays: getDebugVisibility(),
      trafficEnabled: true,
    };
  }
}

export function SettingsMenu() {
  const initial = loadSettings();
  const {
    planRoute,
    getAutonavConfig,
    getStreamState,
    getLastStatusMessage,
    getSimulationSpeed,
    setSimulationSpeed,
    getCurrentSimulationSpeed,
    setVisionViewerEnabled,
    getHeadingOffsetRad,
    setHeadingOffsetRad,
    getTrafficEnabled,
    setTrafficEnabled,
  } = useGameMethod();

  const { config, updateSetting, applyPreset } = useQualitySettings();

  const statusEvent = useGameEvent('statusChanged');
  const streamStateEvent = useGameEvent('streamStateChanged');
  const metricsEvent = useGameEvent('runtimeMetricsChanged');
  const viewerStateEvent = useGameEvent('visionViewerStateChanged');
  const navEvent = useGameEvent('navigationContextChanged');
  const routeEvent = useGameEvent('routeChanged');

  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>(initial.tab);
  const [visionEnabled, setVisionEnabled] = useState(initial.visionEnabled);
  const [debugOverlays, setDebugOverlays] = useState(initial.debugOverlays);
  const [trafficEnabled, setTrafficEnabledUi] = useState(initial.trafficEnabled);
  const [routeText, setRouteText] = useState('No route loaded.');
  const [routeSource, setRouteSource] = useState('Unknown');
  const [routeWarning, setRouteWarning] = useState('');
  const [routeSourceVerified, setRouteSourceVerified] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [speedBusy, setSpeedBusy] = useState(false);
  const [status, setStatus] = useState(getLastStatusMessage() || 'Booting...');
  const [streamLabel, setStreamLabel] = useState(getStreamState());
  const [simSpeed, setSimSpeed] = useState(getCurrentSimulationSpeed());
  const [headingOffsetDeg, setHeadingOffsetDeg] = useState(0);

  useEffect(() => {
    setDebugVisibility(debugOverlays);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tab,
        visionEnabled,
        debugOverlays,
        trafficEnabled,
      } satisfies SettingsStateV2)
    );
  }, [tab, visionEnabled, debugOverlays, trafficEnabled]);

  useEffect(() => {
    setVisionViewerEnabled(visionEnabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visionEnabled]);

  useEffect(() => {
    setTrafficEnabled(trafficEnabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trafficEnabled]);

  useEffect(() => {
    void getAutonavConfig().then((cfg) => {
      if (!cfg) return;
      if (Array.isArray(cfg.waypoints)) {
        setRouteText(`Route: ${cfg.waypoints.length} waypoints`);
      }
      setRouteSource(sourceLabel(cfg.source));
      setRouteWarning(cfg.warning || '');
      setRouteSourceVerified(Boolean(cfg.routeSourceVerified));
      if (cfg.notes) {
        setStatus(cfg.notes);
      }
    });
    void getSimulationSpeed().then((value) => setSimSpeed(value)).catch(() => {});
    setTrafficEnabledUi(getTrafficEnabled());
    const offsetRad = getHeadingOffsetRad();
    if (typeof offsetRad === 'number' && Number.isFinite(offsetRad)) {
      setHeadingOffsetDeg((offsetRad * 180) / Math.PI);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (statusEvent?.message) {
      setStatus(statusEvent.message);
    }
  }, [statusEvent]);

  useEffect(() => {
    if (streamStateEvent?.state) {
      setStreamLabel(streamStateEvent.state);
    }
  }, [streamStateEvent]);

  useEffect(() => {
    if (!routeEvent) return;
    setRouteText(`Route: ${routeEvent.waypoints.length} waypoints`);
    setRouteSource(sourceLabel(routeEvent.source));
    setRouteWarning(routeEvent.warning || '');
    setRouteSourceVerified(Boolean(routeEvent.routeSourceVerified));
    if (routeEvent.notes) {
      setStatus(routeEvent.notes);
    }
  }, [routeEvent]);

  useEffect(() => {
    const offsetRad = getHeadingOffsetRad();
    if (typeof offsetRad === 'number' && Number.isFinite(offsetRad)) {
      setHeadingOffsetDeg((offsetRad * 180) / Math.PI);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamStateEvent?.state]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const streamClass = useMemo(() => {
    if (streamLabel === 'live') return 'text-emerald-300';
    if (streamLabel === 'connecting') return 'text-amber-300';
    return 'text-rose-300';
  }, [streamLabel]);

  const speedRequested = navEvent?.speedRequested;
  const speedAchieved = navEvent?.speedAchieved;
  const lowSpeedWarning =
    typeof speedRequested === 'number' &&
    speedRequested > 1 &&
    typeof speedAchieved === 'number' &&
    speedAchieved < speedRequested * 0.8;

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

  const applyHeadingOffset = (nextDeg: number) => {
    const clamped = Math.max(-180, Math.min(180, nextDeg));
    setHeadingOffsetDeg(clamped);
    const nextRad = (clamped * Math.PI) / 180;
    const applied = setHeadingOffsetRad(nextRad);
    if (typeof applied === 'number' && Number.isFinite(applied)) {
      setHeadingOffsetDeg((applied * 180) / Math.PI);
    }
  };

  const applyQuickPreset = async (preset: QuickPreset) => {
    setPresetBusy(true);
    try {
      const result = await planRoute({
        prompt: preset.prompt,
        useGemini: true,
        useGoogleMaps: true,
      });
      setRouteText(`Route: ${result.waypoints.length} waypoints`);
      setRouteSource(sourceLabel(result.source));
      setRouteWarning(result.warning || '');
      setRouteSourceVerified(Boolean(result.routeSourceVerified));
      setStatus(result.notes || 'Route planned.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Preset plan failed: ${message}`);
    } finally {
      setPresetBusy(false);
    }
  };

  const mapsTokenPresent = Boolean(getTokens().googleMaps);

  return (
    <>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed top-8 left-8 z-[80] h-10 w-10 glass-panel hover:bg-white/10 transition-all duration-300 text-white/80"
        title="Settings (Esc)"
      >
        {'\u2699'}
      </button>

      {isOpen && (
        <div className="fixed top-20 left-8 z-[80] w-[460px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-120px)] overflow-y-auto glass-panel pointer-events-auto">
          <div className="px-4 py-3 border-b border-white/10">
            <div className="text-sm font-semibold text-white">Settings</div>
            <div className="text-[11px] text-white/60">Performance, vision, runtime, and quick presets</div>
          </div>

          <div className="px-3 py-2 border-b border-white/10 flex gap-2">
            {(['performance', 'vision', 'runtime'] as SettingsTab[]).map((entry) => (
              <button
                key={entry}
                onClick={() => setTab(entry)}
                className={`px-2 py-1 rounded text-xs capitalize transition-colors ${
                  tab === entry ? 'bg-sky-500/80 text-white' : 'bg-black/20 text-white/70 hover:bg-white/10'
                }`}
              >
                {entry}
              </button>
            ))}
          </div>

          <div className="p-4 space-y-3">
            {tab === 'performance' && (
              <>
                <QualityPresets onApplyPreset={applyPreset} />
                <QualityControls config={config} onUpdateSetting={updateSetting} />
              </>
            )}

            {tab === 'vision' && (
              <>
                <label className="flex items-center justify-between gap-2 text-sm text-white/80">
                  <span>Enable dedicated vision viewer</span>
                  <input
                    type="checkbox"
                    checked={visionEnabled}
                    onChange={(event) => setVisionEnabled(event.target.checked)}
                    className="rounded border-white/30 bg-black/20"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-sm text-white/80">
                  <span>Show debug overlays</span>
                  <input
                    type="checkbox"
                    checked={debugOverlays}
                    onChange={(event) => setDebugOverlays(event.target.checked)}
                    className="rounded border-white/30 bg-black/20"
                  />
                </label>
                <div className="text-xs text-white/70 bg-black/20 rounded-md px-3 py-2">
                  Vision capture: {viewerStateEvent?.state?.captureHz?.toFixed(1) ?? '0.0'} fps
                </div>
              </>
            )}

            {tab === 'runtime' && (
              <>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/60 mb-1">Quick Route Presets</div>
                  <div className="grid grid-cols-2 gap-2">
                    {QUICK_ROUTE_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => void applyQuickPreset(preset)}
                        disabled={presetBusy}
                        className="rounded-md border border-white/20 bg-black/20 px-2 py-2 text-xs text-white/85 hover:bg-white/10 disabled:opacity-50"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
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

                <label className="flex items-center justify-between gap-2 text-sm text-white/80">
                  <span>Bridge traffic obstacles</span>
                  <input
                    type="checkbox"
                    checked={trafficEnabled}
                    onChange={(event) => setTrafficEnabledUi(event.target.checked)}
                    className="rounded border-white/30 bg-black/20"
                  />
                </label>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/60 mb-1">G1 Heading Offset</div>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={headingOffsetDeg}
                    onChange={(event) => applyHeadingOffset(Number(event.target.value))}
                    className="w-full"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={headingOffsetDeg.toFixed(0)}
                      onChange={(event) => applyHeadingOffset(Number(event.target.value))}
                      className="w-20 rounded-md bg-black/30 border border-white/20 px-2 py-1 text-xs text-white"
                    />
                    <span className="text-xs text-white/70">degrees</span>
                  </div>
                </div>

                <div className="text-xs text-white/70 bg-black/20 rounded-md px-3 py-2">{status}</div>
                <div className="text-xs text-white/70">
                  Stream: <span className={streamClass}>{streamLabel}</span>
                </div>

                <div className="text-xs text-white/70 bg-black/20 rounded-md px-3 py-2">
                  {routeText} | Source: {routeSource}
                </div>
                <div className="text-xs text-white/70 bg-black/20 rounded-md px-3 py-2">
                  Requested {typeof speedRequested === 'number' ? `${speedRequested.toFixed(1)}x` : '--'} | Achieved{' '}
                  {typeof speedAchieved === 'number' ? `${speedAchieved.toFixed(2)}x` : '--'}
                </div>
                {lowSpeedWarning ? (
                  <div className="text-xs text-rose-200 bg-rose-500/10 rounded-md px-3 py-2 border border-rose-400/30">
                    Achieved speed is below 80% of requested multiplier.
                  </div>
                ) : null}

                <div className="text-xs text-white/70 bg-black/20 rounded-md px-3 py-2">
                  {metricsEvent?.metrics
                    ? `Pose ${metricsEvent.metrics.poseApplyHz.toFixed(1)}/s | TerrainQ ${metricsEvent.metrics.terrainQueryHz.toFixed(1)}/s | Probe ${metricsEvent.metrics.terrainProbeHz.toFixed(1)}/s`
                    : 'Runtime metrics unavailable'}
                </div>

                <details className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
                  <summary className="cursor-pointer text-xs text-white/80">Route source diagnostics</summary>
                  <div className="mt-2 space-y-1 text-xs text-white/70">
                    <div>Source: {routeSource}</div>
                    <div>Source verified: {routeSourceVerified ? 'yes' : 'no'}</div>
                    <div>Google Maps key: {mapsTokenPresent ? 'present' : 'missing'}</div>
                    {routeWarning ? <div className="text-amber-200">{routeWarning}</div> : null}
                    {navEvent?.terrainBlockReason ? (
                      <div>Terrain block: {navEvent.terrainBlockReason}</div>
                    ) : null}
                    {navEvent?.obstacleBlockReason ? (
                      <div>Obstacle block: {navEvent.obstacleBlockReason}</div>
                    ) : null}
                  </div>
                </details>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
