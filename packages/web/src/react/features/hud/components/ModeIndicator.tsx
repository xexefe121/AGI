import { useEffect, useMemo, useState } from 'react';
import { useGameEvent } from '../../../hooks/useGameEvent';

type NavigationHudState = 'OFFLINE' | 'IDLE' | 'NAVIGATING' | 'ARRIVED';

export function NavigationStateIndicator() {
  const navContext = useGameEvent('navigationContextChanged');
  const streamState = useGameEvent('streamStateChanged');
  const statusEvent = useGameEvent('statusChanged');
  const [statusToast, setStatusToast] = useState('');

  useEffect(() => {
    const message = statusEvent?.message?.trim();
    if (!message) return;
    setStatusToast(message);
    const timeout = window.setTimeout(() => {
      setStatusToast((current) => (current === message ? '' : current));
    }, 3000);
    return () => window.clearTimeout(timeout);
  }, [statusEvent?.message]);

  const state = useMemo<NavigationHudState>(() => {
    if (!streamState || streamState.state === 'offline') return 'OFFLINE';
    if (navContext?.running) return 'NAVIGATING';
    if (
      navContext?.running === false &&
      typeof navContext.remainingWaypoints === 'number' &&
      navContext.remainingWaypoints === 0
    ) {
      return 'ARRIVED';
    }
    return 'IDLE';
  }, [navContext, streamState]);

  const config = {
    OFFLINE: { color: 'bg-rose-500', label: 'Offline', pulse: false },
    IDLE: { color: 'bg-amber-400', label: 'Ready', pulse: false },
    NAVIGATING: { color: 'bg-emerald-400', label: 'Navigating', pulse: true },
    ARRIVED: { color: 'bg-sky-400', label: 'Arrived!', pulse: true },
  }[state];

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none max-w-[320px]">
      <div className="glass-panel px-5 py-2 flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${config.color} ${config.pulse ? 'animate-pulse' : ''}`} />
        <span className="text-sm font-medium text-white">{config.label}</span>
        {typeof navContext?.remainingWaypoints === 'number' && navContext.remainingWaypoints > 0 && (
          <span className="text-xs text-white/60">{navContext.remainingWaypoints} waypoints left</span>
        )}
      </div>
      {statusToast && (
        <div className="mt-2 glass-panel px-4 py-2 text-xs text-white/80 text-center truncate">
          {statusToast}
        </div>
      )}
    </div>
  );
}
