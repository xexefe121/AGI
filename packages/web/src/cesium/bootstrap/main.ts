import * as Cesium from 'cesium';
import { Scene } from '../core/Scene';
import { GameLoop } from '../core/GameLoop';
import { VehicleManager } from '../managers/VehicleManager';
import { CameraManager } from '../managers/CameraManager';
import { InputManager } from '../input/InputManager';
import { TouchInputManager } from '../input/TouchInputManager';

export class CesiumVehicleGame {
  private scene: Scene;
  private gameLoop: GameLoop;
  private vehicleManager: VehicleManager;
  private cameraManager: CameraManager;
  private inputManager: InputManager;
  private touchInputManager: TouchInputManager | null = null;

  constructor(containerId: string = "cesiumContainer") {
    this.scene = new Scene(containerId);
    this.gameLoop = new GameLoop(this.scene);
    this.vehicleManager = new VehicleManager(this.scene);
    this.cameraManager = new CameraManager(this.scene.camera, this.scene.scene);
    this.inputManager = new InputManager();

    this.setupSystems();
    this.setupInputHandling();
    this.setupTouchControls(containerId);
  }

  private setupSystems(): void {
    this.gameLoop.addUpdatable(this.vehicleManager);
    this.gameLoop.addUpdatable(this.cameraManager);

    this.vehicleManager.onVehicleChange((vehicle) => {
      this.cameraManager.setTarget(vehicle);
      console.log('Camera target updated to new vehicle');
    });
  }

  private setupInputHandling(): void {
    this.vehicleManager.setupInputHandling(this.inputManager);
    this.cameraManager.setupInputHandling(this.inputManager);
  }

  private setupTouchControls(containerId: string): void {
    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isMobile) return;

    const container = document.getElementById(containerId);
    if (!container) return;

    this.touchInputManager = new TouchInputManager(container);

    this.touchInputManager.onInput('rollLeft', (pressed) =>
      this.vehicleManager.handleInput('rollLeft', pressed)
    );
    this.touchInputManager.onInput('rollRight', (pressed) =>
      this.vehicleManager.handleInput('rollRight', pressed)
    );
    this.touchInputManager.onInput('altitudeUp', (pressed) =>
      this.vehicleManager.handleInput('altitudeUp', pressed)
    );
    this.touchInputManager.onInput('altitudeDown', (pressed) =>
      this.vehicleManager.handleInput('altitudeDown', pressed)
    );

    console.log('Touch controls initialized');
  }

  public async startCinematicSequence(): Promise<void> {
    const config = await this.vehicleManager.loadAutonavConfig();
    const configStart = Array.isArray(config?.start) && config.start.length === 2 ? config.start : null;
    const spawnPosition = configStart
      ? Cesium.Cartesian3.fromDegrees(configStart[1], configStart[0], 24)
      : Cesium.Cartesian3.fromDegrees(151.2147663, -33.8582722, 24);

    console.log('Starting cinematic sequence...');

    this.scene.startEarthSpin();
    await this.delay(3000);

    this.scene.stopEarthSpin();
    await this.scene.zoomToLocation(spawnPosition, 4500);
    console.log('Warming up terrain tiles around spawn...');
    await this.scene.waitForWarmup(spawnPosition);

    console.log('Spawning Unitree G1...');
    const robot = await this.vehicleManager.spawnG1Robot();
    this.cameraManager.setTarget(robot);
    this.start();

    console.log('Ready to walk!');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public start(): void {
    this.gameLoop.start();
    console.log('Cesium Vehicle Game started!');
  }

  public stop(): void {
    this.gameLoop.stop();
  }

  public getVehicleManager(): VehicleManager {
    return this.vehicleManager;
  }

  public getCameraManager(): CameraManager {
    return this.cameraManager;
  }

  public getInputManager(): InputManager {
    return this.inputManager;
  }

  public getScene(): Scene {
    return this.scene;
  }

  public destroy(): void {
    this.stop();
    this.scene.stopEarthSpin();
    this.vehicleManager.destroy();
    this.cameraManager.destroy();
    this.inputManager.destroy();
    this.touchInputManager?.destroy();
  }
}

export async function startCesiumVehicleGame(): Promise<CesiumVehicleGame> {
  const game = new CesiumVehicleGame();
  await game.startCinematicSequence();
  return game;
}
