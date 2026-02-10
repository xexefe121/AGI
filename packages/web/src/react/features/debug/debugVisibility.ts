type DebugVisibilityListener = (isVisible: boolean) => void;

let debugVisible = false;
const listeners = new Set<DebugVisibilityListener>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener(debugVisible);
  }
}

export function getDebugVisibility(): boolean {
  return debugVisible;
}

export function setDebugVisibility(nextVisible: boolean): void {
  if (debugVisible === nextVisible) return;
  debugVisible = nextVisible;
  notifyListeners();
}

export function toggleDebugVisibility(): void {
  setDebugVisibility(!debugVisible);
}

export function subscribeDebugVisibility(listener: DebugVisibilityListener): () => void {
  listeners.add(listener);
  listener(debugVisible);
  return () => {
    listeners.delete(listener);
  };
}
