import { useState } from 'react';
import { Button } from './Button';
import { isMobileDevice } from '../utils/mobileDetect';

export function IntroScreen() {
  const [isVisible, setIsVisible] = useState(true);
  const isMobile = isMobileDevice();

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[180] bg-black/60 backdrop-blur-lg flex items-center justify-center animate-fade-in">
      <div className="max-w-2xl w-full mx-4">
        <div className="glass-panel p-8 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-future-primary to-future-secondary bg-clip-text text-transparent">
              Welcome to AGI
            </h1>
            <p className="text-white/60 text-sm">
              {isMobile
                ? 'Touch controls for camera and movement assist'
                : 'Autonomous Geonavigation Intelligence: review controls for planning and supervising the robot'}
            </p>
          </div>

          {isMobile ? <MobileControls /> : <DesktopControls />}

          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <h3 className="text-xs uppercase tracking-wider text-future-primary font-semibold mb-2">Quick Tips</h3>
            <ul className="space-y-1.5 text-xs text-white/60">
              <li className="flex items-start gap-2">
                <span className="text-future-primary mt-0.5">-</span>
                <span>Open Planner from Settings (P or Esc) to plan/start/stop routes.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-future-primary mt-0.5">-</span>
                <span>Use Runtime diagnostics in Settings to verify route source and adherence.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-future-primary mt-0.5">-</span>
                <span>If vision reports black frames, wait a few seconds after load for full render.</span>
              </li>
            </ul>
          </div>

          <div className="flex justify-center pt-2">
            <Button
              onClick={() => setIsVisible(false)}
              variant="primary"
              size="lg"
              className="px-12"
            >
              Enter Simulation
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileControls() {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold">Touch Controls</h3>
        <div className="space-y-2.5">
          <TouchControlRow
            icon="LR"
            action="Swipe Left / Right"
            description="Turn and inspect the nearby path"
          />
          <TouchControlRow
            icon="UD"
            action="Swipe Up / Down"
            description="Adjust camera pitch"
          />
          <TouchControlRow
            icon="TH"
            action="Right Slider"
            description="Manual throttle override"
          />
        </div>
      </div>
    </div>
  );
}

function DesktopControls() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-3">
        <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold">Robot Controls</h3>
        <div className="space-y-2">
          <ControlRow keys={['W', 'Up']} action="Move Forward" />
          <ControlRow keys={['S', 'Down']} action="Slow / Backstep" />
          <ControlRow keys={['A', 'D', 'Left', 'Right']} action="Turn Left / Right" />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold">System</h3>
        <div className="space-y-2">
          <ControlRow keys={['C']} action="Switch Camera" />
          <ControlRow keys={['RMB + WASD']} action="UE-style free camera roam" />
          <ControlRow keys={['Q', 'E']} action="Free camera vertical move" />
          <ControlRow keys={['Esc']} action="Open Settings" />
          <ControlRow keys={['?']} action="Show Controls Panel" />
        </div>
      </div>
    </div>
  );
}

interface ControlRowProps {
  keys: string[];
  action: string;
}

function ControlRow({ keys, action }: ControlRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex gap-1.5 flex-wrap">
        {keys.map((key) => (
          <kbd
            key={key}
            className="px-2 py-1 text-[10px] font-medium text-white bg-white/5 border border-white/10 rounded-lg min-w-[24px] text-center"
          >
            {key}
          </kbd>
        ))}
      </div>
      <span className="text-xs text-white/70 flex-1">{action}</span>
    </div>
  );
}

interface TouchControlRowProps {
  icon: string;
  action: string;
  description: string;
}

function TouchControlRow({ icon, action, description }: TouchControlRowProps) {
  return (
    <div className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-lg p-3">
      <div className="text-sm font-semibold text-white/70 flex-shrink-0">{icon}</div>
      <div className="flex-1 space-y-0.5">
        <div className="text-sm font-medium text-white">{action}</div>
        <div className="text-xs text-white/60">{description}</div>
      </div>
    </div>
  );
}
