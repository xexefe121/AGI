import * as Cesium from 'cesium';
import { TypedEventEmitter } from './TypedEventEmitter';
import type {
  GameEvents,
  VehicleStateData,
  StreamStateData,
  StatusData,
  NavigationContextChangedData,
  RouteChangedData,
} from './types';
import type { CesiumVehicleGame } from '../bootstrap/main';
import type { CameraType } from '../managers/CameraManager';
import type {
  QualityConfig,
} from '../core/Scene';
import type {
  AutonavConfigData,
  RoutePlanData,
  RoutePlanRequest,
  NavigationContextData,
  RuntimeMetricsData,
  VisionFrameData,
  VisionViewerStateData,
} from '../managers/VehicleManager';
import { type StreamState } from '../vehicles/g1/G1Robot';

export class GameBridge extends TypedEventEmitter<GameEvents> {
  private game: CesiumVehicleGame;
  private updateInterval: number | null = null;
  private diagnosticsInterval: number | null = null;

  constructor(game: CesiumVehicleGame) {
    super();
    this.game = game;
    this.startUpdates();
    this.setupVehicleChangeListener();
    this.setupAutonavListeners();
    void this.preloadAutonavConfig();
  }

  private async preloadAutonavConfig(): Promise<void> {
    const config = await this.game.getVehicleManager().loadAutonavConfig();
    this.emit('autonavConfigLoaded', { config });
  }

  private setupVehicleChangeListener(): void {
    this.game.getVehicleManager().addVehicleChangeListener((vehicle) => {
      this.emitVehicleChangeEvents(vehicle.getState());
    });
  }

  private setupAutonavListeners(): void {
    const vehicleManager = this.game.getVehicleManager();
    vehicleManager.onStreamStateChange((state) => {
      const payload: StreamStateData = { state };
      this.emit('streamStateChanged', payload);
    });
    vehicleManager.onStatusChange((message) => {
      const payload: StatusData = { message };
      this.emit('statusChanged', payload);
    });
    vehicleManager.onRouteChange((route) => {
      const payload: RouteChangedData = route;
      this.emit('routeChanged', payload);
    });
    vehicleManager.onVisionFrame((frame) => {
      this.emit('visionFrameChanged', { frame });
    });
    vehicleManager.onNavigationContextChange((context) => {
      const payload: NavigationContextChangedData = context;
      this.emit('navigationContextChanged', payload);
    });
  }

  private startUpdates(): void {
    this.updateInterval = window.setInterval(() => {
      this.emitVehicleState();
    }, 50);
    this.diagnosticsInterval = window.setInterval(() => {
      this.emit('runtimeMetricsChanged', {
        metrics: this.game.getVehicleManager().getRuntimeMetrics(),
      });
      this.emit('visionViewerStateChanged', {
        state: this.game.getVehicleManager().getVisionViewerState(),
      });
    }, 400);
  }

  private emitVehicleState(): void {
    const vehicle = this.game.getVehicleManager().getActiveVehicle();
    if (vehicle && vehicle.isModelReady()) {
      const state = vehicle.getState();
      this.emit('vehicleStateChanged', {
        speed: state.speed,
        velocity: state.velocity,
        position: state.position,
        heading: state.heading,
        pitch: state.pitch,
        roll: state.roll,
      });
    }
  }

  private emitVehicleChangeEvents(state: VehicleStateData): void {
    this.emit('collisionDetectionChanged', { enabled: false });
    this.emit('roverModeChanged', { enabled: false });
    this.emit('vehicleStateChanged', state);
  }

  public switchCamera(): void {
    const cameraManager = this.game.getCameraManager();
    cameraManager.switchCamera();
    this.emit('cameraChanged', {
      type: cameraManager.getActiveCameraType(),
    });
  }

  public getCameraType(): CameraType {
    return this.game.getCameraManager().getActiveCameraType();
  }

  public toggleRoverMode(): void {
    this.emit('statusChanged', { message: 'Mode switch is disabled in the G1 build.' });
  }

  public toggleVehicleType(): void {
    void this.game.getVehicleManager().toggleVehicleType();
  }

  public getRoverMode(): boolean {
    return false;
  }

  public toggleCollisionDetection(): void {
    this.emit('collisionDetectionChanged', { enabled: false });
    this.emit('statusChanged', { message: 'Collision toggle is disabled in the G1 build.' });
  }

  public getCollisionDetection(): boolean {
    return false;
  }

  public getVehicleState(): VehicleStateData | null {
    const vehicle = this.game.getVehicleManager().getActiveVehicle();
    if (!vehicle || !vehicle.isModelReady()) {
      return null;
    }
    const state = vehicle.getState();
    return {
      speed: state.speed,
      velocity: state.velocity,
      position: state.position,
      heading: state.heading,
      pitch: state.pitch,
      roll: state.roll,
    };
  }

  public teleportTo(
    longitude: number,
    latitude: number,
    altitude: number,
    heading: number = 0
  ): void {
    const vehicle = this.game.getVehicleManager().getActiveVehicle();
    if (!vehicle) return;

    const newPosition = Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude);
    const currentState = vehicle.getState();
    vehicle.setState({
      ...currentState,
      position: newPosition,
      heading: Cesium.Math.toRadians(heading),
      pitch: 0,
      roll: 0,
      velocity: 0,
      speed: 0,
    });
    this.emit('locationChanged', {
      longitude,
      latitude,
      altitude,
    });
  }

  public restart(): void {
    void this.game.getVehicleManager().restartCurrentVehicle();
  }

  public async planRoute(request: RoutePlanRequest): Promise<RoutePlanData> {
    const result = await this.game.getVehicleManager().planRoute(request);
    this.emit('routeChanged', result);
    return result;
  }

  public async startNavigation(restart: boolean = true): Promise<boolean> {
    return this.game.getVehicleManager().startNavigation(restart);
  }

  public async stopNavigation(): Promise<void> {
    await this.game.getVehicleManager().stopNavigation();
  }

  public async getSimulationSpeed(): Promise<number> {
    return this.game.getVehicleManager().getSimulationSpeed();
  }

  public async setSimulationSpeed(multiplier: number): Promise<number> {
    return this.game.getVehicleManager().setSimulationSpeed(multiplier);
  }

  public async getAutonavConfig(force: boolean = false): Promise<AutonavConfigData | null> {
    const config = await this.game.getVehicleManager().loadAutonavConfig(force);
    this.emit('autonavConfigLoaded', { config });
    return config;
  }

  public getStreamState(): StreamState {
    return this.game.getVehicleManager().getCurrentStreamState();
  }

  public getLastStatusMessage(): string {
    return this.game.getVehicleManager().getLastStatusMessage();
  }

  public getCurrentRoute(): RoutePlanData | null {
    return this.game.getVehicleManager().getCurrentRoute();
  }

  public getCurrentVisionFrame(): VisionFrameData | null {
    return this.game.getVehicleManager().getCurrentVisionFrame();
  }

  public getCurrentNavigationContext(): NavigationContextData | null {
    return this.game.getVehicleManager().getCurrentNavigationContext();
  }

  public getCurrentSimulationSpeed(): number {
    return this.game.getVehicleManager().getCurrentSimulationSpeed();
  }

  public setTrafficEnabled(enabled: boolean): void {
    this.game.getVehicleManager().setTrafficEnabled(enabled);
  }

  public getTrafficEnabled(): boolean {
    return this.game.getVehicleManager().isTrafficEnabled();
  }

  public destroy(): void {
    if (this.updateInterval !== null) {
      window.clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.diagnosticsInterval !== null) {
      window.clearInterval(this.diagnosticsInterval);
      this.diagnosticsInterval = null;
    }
    this.removeAllListeners();
  }

  public getQualitySettings(): QualityConfig {
    return this.game.getScene().getQualityConfig();
  }

  public updateQualitySettings(config: Partial<QualityConfig>): void {
    this.game.getScene().updateQualityConfig(config);
  }

  public applyQualityPreset(preset: 'performance' | 'balanced' | 'quality' | 'ultra'): void {
    const presets: Record<string, Partial<QualityConfig>> = {
      performance: {
        maximumScreenSpaceError: 32,
        dynamicScreenSpaceError: true,
        dynamicScreenSpaceErrorFactor: 32,
        skipLevelOfDetail: true,
        fxaaEnabled: false,
        bloomEnabled: false,
        hdr: false,
        exposure: 1.0,
      },
      balanced: {
        maximumScreenSpaceError: 16,
        dynamicScreenSpaceError: true,
        dynamicScreenSpaceErrorFactor: 24,
        skipLevelOfDetail: true,
        fxaaEnabled: true,
        bloomEnabled: true,
        hdr: true,
        exposure: 1.5,
      },
      quality: {
        maximumScreenSpaceError: 8,
        dynamicScreenSpaceError: true,
        dynamicScreenSpaceErrorFactor: 16,
        skipLevelOfDetail: true,
        fxaaEnabled: true,
        bloomEnabled: true,
        hdr: true,
        exposure: 1.5,
      },
      ultra: {
        maximumScreenSpaceError: 4,
        dynamicScreenSpaceError: false,
        dynamicScreenSpaceErrorFactor: 12,
        skipLevelOfDetail: false,
        fxaaEnabled: true,
        bloomEnabled: true,
        hdr: true,
        exposure: 1.8,
      },
    };

    const config = presets[preset];
    if (config) {
      this.updateQualitySettings(config);
      console.log(`Applied ${preset} quality preset`);
    }
  }

  public setThrottle(percent: number): void {
    this.game.getInputManager().setThrottlePercent(percent * 100);
  }

  public setVisionViewerEnabled(enabled: boolean): void {
    this.game.getVehicleManager().setVisionViewerEnabled(enabled);
    this.emit('visionViewerStateChanged', {
      state: this.game.getVehicleManager().getVisionViewerState(),
    });
  }

  public setVisionViewerContainer(container: HTMLElement | null): void {
    this.game.getVehicleManager().setVisionViewerContainer(container);
    this.emit('visionViewerStateChanged', {
      state: this.game.getVehicleManager().getVisionViewerState(),
    });
  }

  public getVisionViewerState(): VisionViewerStateData {
    return this.game.getVehicleManager().getVisionViewerState();
  }

  public getRuntimeMetrics(): RuntimeMetricsData | null {
    return this.game.getVehicleManager().getRuntimeMetrics();
  }

  public getHeadingOffsetRad(): number | null {
    return this.game.getVehicleManager().getHeadingOffsetRad();
  }

  public setHeadingOffsetRad(offsetRad: number): number | null {
    return this.game.getVehicleManager().setHeadingOffsetRad(offsetRad);
  }
}
