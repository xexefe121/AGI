import { useState, useEffect } from 'react';
import { Panel } from '../../../shared/components/Panel';
import { Button } from '../../../shared/components/Button';
import { useGameMethod } from '../../../hooks/useGameMethod';
import { useDebugInfo } from '../hooks/useDebugInfo';
import { useQualitySettings } from '../hooks/useQualitySettings';
import { QualityPresets } from './QualityPresets';
import { QualityControls } from './QualityControls';
import {
  getDebugVisibility,
  subscribeDebugVisibility,
  toggleDebugVisibility,
} from '../debugVisibility';

export function DebugPanel() {
  const [isOpen, setIsOpen] = useState(getDebugVisibility());
  const { switchCamera, restart } = useGameMethod();
  const { fps } = useDebugInfo();
  const { config, updateSetting, applyPreset } = useQualitySettings();

  useEffect(() => subscribeDebugVisibility(setIsOpen), []);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === '`' || e.key === '~') {
        e.preventDefault();
        toggleDebugVisibility();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  return (
    <>
      <button
        onClick={toggleDebugVisibility}
        className="fixed top-8 left-8 z-50 w-10 h-10 flex items-center justify-center
                   glass-panel hover:bg-white/10 transition-all duration-300
                   text-white/60 hover:text-white text-sm font-mono group"
        title="Toggle Debug Panel (~)"
      >
        <span className="group-hover:scale-110 transition-transform">~</span>
      </button>

      {isOpen && (
        <div className="fixed top-20 left-8 z-50 animate-slide-in max-h-[calc(100vh-120px)] overflow-y-auto">
          <Panel title="Runtime & Quality" className="min-w-[280px] max-w-[320px]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/80 font-medium">FPS</span>
                <span
                  className={`font-mono font-semibold text-lg ${
                    fps >= 50 ? 'text-green-400' : fps >= 30 ? 'text-yellow-400' : 'text-red-400'
                  }`}
                >
                  {fps}
                </span>
              </div>

              <div className="border-t border-white/5 pt-4">
                <QualityPresets onApplyPreset={applyPreset} />
              </div>

              <div className="border-t border-white/5 pt-4">
                <QualityControls config={config} onUpdateSetting={updateSetting} />
              </div>

              <div className="border-t border-white/10 pt-4 space-y-2">
                <div className="text-[11px] text-white/70 uppercase tracking-wider mb-2 font-medium">
                  G1 Controls
                </div>
                <Button onClick={switchCamera} variant="secondary" size="sm" className="w-full">
                  Switch Camera (C)
                </Button>

                <Button onClick={restart} variant="secondary" size="sm" className="w-full">
                  Reset Robot (R)
                </Button>
              </div>

              <div className="border-t border-white/10 pt-3">
                <div className="text-[10px] text-white/50">
                  Press <kbd className="px-1 py-0.5 bg-white/10 rounded text-white/70">~</kbd> to close
                </div>
              </div>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
