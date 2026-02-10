import { useEffect, useRef, useState } from 'react';
import type { VisionFrameData, VisionViewerStateData } from '../../../../cesium/managers/VehicleManager';
import { useGameEvent } from '../../../hooks/useGameEvent';
import { useGameMethod } from '../../../hooks/useGameMethod';

function formatTelemetry(frame: VisionFrameData | null): string {
  if (!frame?.robot) return 'Telemetry unavailable';
  const lat = frame.robot.lat.toFixed(6);
  const lon = frame.robot.lon.toFixed(6);
  const speed = frame.robot.speed.toFixed(2);
  return `lat ${lat} | lon ${lon} | speed ${speed} m/s`;
}

export function VisionViewerPanel() {
  const visionEvent = useGameEvent('visionFrameChanged');
  const viewerStateEvent = useGameEvent('visionViewerStateChanged');
  const {
    getCurrentVisionFrame,
    getVisionViewerState,
    setVisionViewerContainer,
  } = useGameMethod();

  const [isOpen, setIsOpen] = useState(false);
  const [frame, setFrame] = useState<VisionFrameData | null>(() => getCurrentVisionFrame());
  const [viewerState, setViewerState] = useState<VisionViewerStateData>(() => getVisionViewerState());
  const [clockMs, setClockMs] = useState(Date.now());
  const viewerContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      setVisionViewerContainer(null);
    };
    // setVisionViewerContainer comes from bridge and is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (visionEvent?.frame) {
      setFrame(visionEvent.frame);
    }
  }, [visionEvent]);

  useEffect(() => {
    if (viewerStateEvent?.state) {
      setViewerState(viewerStateEvent.state);
    }
  }, [viewerStateEvent]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setVisionViewerContainer(null);
      return;
    }
    setVisionViewerContainer(viewerContainerRef.current);
    return () => {
      setVisionViewerContainer(null);
    };
    // setVisionViewerContainer comes from bridge and is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const ageSec = frame ? Math.max(0, (clockMs - frame.capturedAtMs) / 1000).toFixed(1) : '--';

  return (
    <>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed top-8 left-20 z-50 h-10 px-3 glass-panel hover:bg-white/10 transition-all duration-300 text-xs text-white/80"
        title="Toggle Gemini Vision Viewer"
      >
        Vision Viewer
      </button>

      {isOpen && (
        <div className="fixed top-20 left-8 z-50 w-[380px] max-w-[calc(100vw-2rem)] glass-panel pointer-events-auto">
          <div className="px-3 py-2 border-b border-white/10">
            <div className="text-sm font-semibold text-white">Gemini Vision First-Person</div>
            <div className="text-[11px] text-white/60">Dedicated camera viewer (separate from gameplay camera)</div>
          </div>

          <div className="p-3 space-y-2">
            <div
              ref={viewerContainerRef}
              className="w-full h-52 rounded-md overflow-hidden bg-black/50 border border-white/10"
            />
            {frame && (
              <details className="rounded-md border border-white/10 bg-black/20 p-2">
                <summary className="cursor-pointer text-[11px] text-white/70">
                  Last uploaded frame preview
                </summary>
                <div className="mt-2 w-full h-32 rounded overflow-hidden bg-black/50">
                  <img
                    src={frame.imageDataUrl}
                    alt="Last uploaded Gemini frame"
                    className="w-full h-full object-cover"
                  />
                </div>
              </details>
            )}
            <div className="text-[11px] text-white/70">Frame age: {ageSec}s</div>
            <div className="text-[11px] text-white/70">
              Capture: {viewerState.captureHz.toFixed(1)} fps | {viewerState.lastCaptureMs.toFixed(1)} ms
            </div>
            <div className="text-[11px] text-white/70">
              Viewer mounted: {viewerState.mounted ? 'yes' : 'offscreen'} | enabled: {viewerState.enabled ? 'yes' : 'no'}
            </div>
            <div className="text-[11px] text-white/70">
              Vision mount tag: {frame?.mountNode || 'vision_fpv'}
            </div>
            <div className="text-[11px] text-white/70">{formatTelemetry(frame)}</div>
          </div>
        </div>
      )}
    </>
  );
}
