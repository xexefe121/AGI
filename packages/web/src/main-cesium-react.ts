import { CesiumVehicleGame } from './cesium/bootstrap/main';
import { GameBridge } from './cesium/bridge/GameBridge';
import { mountReactUI } from './react/index';
import { hasValidTokens } from './utils/tokenValidator';
import { mountTokenSetup } from './react/tokenSetup';
import './cesium.css';

let tokenSetupVisible = false;
let tokenListenerBound = false;

function showTokenSetup(reason: string): void {
  if (tokenSetupVisible) return;
  tokenSetupVisible = true;
  console.warn(`Token setup required: ${reason}`);
  mountTokenSetup(() => {
    window.location.reload();
  });
}

function bindTokenInvalidListener(): void {
  if (tokenListenerBound) return;
  tokenListenerBound = true;
  window.addEventListener('token:invalid', (event: Event) => {
    const custom = event as CustomEvent<{ provider?: string; reason?: string }>;
    const provider = custom.detail?.provider || 'token';
    const reason = custom.detail?.reason || 'invalid authentication';
    showTokenSetup(`${provider}: ${reason}`);
  });
}

async function initializeGame(): Promise<{ game: CesiumVehicleGame; gameBridge: GameBridge } | void> {
  bindTokenInvalidListener();
  if (!hasValidTokens()) {
    showTokenSetup('missing or placeholder Cesium token');
    return;
  }

  const game = new CesiumVehicleGame('cesiumContainer');
  await game.startCinematicSequence();

  const gameBridge = new GameBridge(game);
  gameBridge.emit('gameReady', { ready: true });
  mountReactUI(gameBridge);

  if (typeof window !== 'undefined') {
    (window as { cesiumGame?: CesiumVehicleGame }).cesiumGame = game;
    (window as { gameBridge?: GameBridge }).gameBridge = gameBridge;
  }
  return { game, gameBridge };
}

void initializeGame().catch((error) => {
  console.error('Failed to start AGI world sim:', error);
  showTokenSetup(String(error));
});
