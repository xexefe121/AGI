export interface ControlItem {
  keys: string[];
  description: string;
}

export const VEHICLE_CONTROLS: ControlItem[] = [
  { keys: ['W', 'A', 'S', 'D'], description: 'Orbit Camera Around Robot' },
];

export const CAMERA_CONTROLS: ControlItem[] = [
  { keys: ['C'], description: 'Switch Camera' },
  { keys: ['RMB'], description: 'Free Look (free camera)' },
  { keys: ['W', 'A', 'S', 'D'], description: 'Move (free camera)' },
  { keys: ['Q', 'E'], description: 'Down / Up (free camera)' },
  { keys: ['Shift', 'Ctrl'], description: 'Fast / Slow move (free camera)' },
  { keys: ['Scroll'], description: 'Zoom In / Out' },
];

export const MODE_CONTROLS: ControlItem[] = [
  { keys: ['R'], description: 'Reset Robot to Route Start' },
  { keys: ['P'], description: 'Open Planner Tab in Settings' },
  { keys: ['Esc'], description: 'Toggle Settings Menu' },
];
