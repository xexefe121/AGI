import { ControlsPanel } from '../features/controls/components/ControlsPanel';
import { CameraControls } from '../features/camera/components/CameraControls';
import { CrashScreen } from '../features/crash/components/CrashScreen';
import { MiniMap } from '../features/minimap/components/MiniMap';
import { VisionViewerPanel } from '../features/vision/components/VisionViewerPanel';
import { GeminiPromptPanel } from '../features/gemini/components/GeminiPromptPanel';
import { NavigationStateIndicator } from '../features/hud/components/ModeIndicator';
import { useGameEvent } from '../hooks/useGameEvent';

export function PlayModeUI() {
  const crashData = useGameEvent('crashed');
  const isCrashed = !!crashData?.crashed;

  return (
    <>
      <NavigationStateIndicator />
      <VisionViewerPanel />
      <GeminiPromptPanel />
      <ControlsPanel />
      <div className="fixed top-20 right-8 z-[65] flex gap-2 pointer-events-auto">
        <CameraControls />
      </div>
      {!isCrashed && <MiniMap />}
      <CrashScreen />
    </>
  );
}
