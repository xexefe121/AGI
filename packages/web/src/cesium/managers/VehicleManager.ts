import * as Cesium from 'cesium';
import type { Vehicle } from '../vehicles/Vehicle';
import {
  G1Robot,
  type G1NavigationPayload,
  type G1RuntimeMetrics,
  type G1VisionFrame,
  type StreamState,
} from '../vehicles/g1/G1Robot';
import { Scene } from '../core/Scene';
import { Updatable } from '../core/GameLoop';
import { InputManager } from '../input/InputManager';
import { getTokens } from '../../utils/tokenValidator';
import {
  TrafficManager,
  type DynamicObstacle,
} from '../traffic/TrafficManager';
import {
  VisionViewerManager,
  type VisionViewerState,
} from '../vision/VisionViewerManager';

const DEFAULT_SPAWN_LOCATION = {
  lng: 151.2147663,
  lat: -33.8582722,
};

const DEFAULT_WS_HOST = '127.0.0.1:8080';

export interface AutonavConfigData {
  cesiumToken?: string;
  wsPath?: string;
  wsUrl?: string;
  photorealistic?: boolean;
  simulationSpeed?: number;
  start?: [number, number];
  goal?: [number, number];
  waypoints?: [number, number][];
  notes?: string;
  source?: string;
  googleMapsRequested?: boolean;
  googleMapsUsed?: boolean;
  warning?: string;
  distanceM?: number;
  durationS?: number;
  summary?: string;
  routeSourceVerified?: boolean;
}

export interface RoutePlanRequest {
  prompt?: string | null;
  start?: [number, number];
  goal?: [number, number];
  useGemini?: boolean;
  useGoogleMaps?: boolean;
  waypoints?: number;
}

export interface RoutePlanData {
  start: [number, number];
  goal: [number, number];
  waypoints: [number, number][];
  notes: string;
  source?: string;
  googleMapsRequested?: boolean;
  googleMapsUsed?: boolean;
  warning?: string;
  distanceM?: number;
  durationS?: number;
  summary?: string;
  routeSourceVerified?: boolean;
  running?: boolean;
}

export interface VisionFrameData extends G1VisionFrame {}
export interface NavigationContextData extends G1NavigationPayload {}
export interface RuntimeMetricsData extends G1RuntimeMetrics {}
export interface VisionViewerStateData extends VisionViewerState {}

export class VehicleManager implements Updatable {
  private vehicles: Map<string, Vehicle> = new Map();
  private activeVehicle: Vehicle | null = null;
  private scene: Scene;
  private onVehicleChangeCallback: ((vehicle: Vehicle) => void) | null = null;
  private onVehicleChangeCallbacks: Array<(vehicle: Vehicle) => void> = [];

  private onStreamStateCallbacks: Array<(state: StreamState) => void> = [];
  private onStatusCallbacks: Array<(message: string) => void> = [];
  private onRouteCallbacks: Array<(route: RoutePlanData) => void> = [];
  private onVisionFrameCallbacks: Array<(frame: VisionFrameData) => void> = [];
  private onNavigationContextCallbacks: Array<(context: NavigationContextData) => void> = [];
  private currentStreamState: StreamState = 'offline';
  private lastStatusMessage = '';
  private currentRoute: RoutePlanData | null = null;
  private currentVisionFrame: VisionFrameData | null = null;
  private currentNavigationContext: NavigationContextData | null = null;
  private currentSimulationSpeed = 1;

  private autonavConfig: AutonavConfigData | null = null;
  private pendingSpawnSettleVehicleId: string | null = null;
  private spawnSettleInFlight = false;
  private spawnSettleAttempts = 0;
  private visionViewer = new VisionViewerManager();
  private visionViewerEnabled = true;
  private trafficManager: TrafficManager;
  private trafficEnabled = true;
  private lastDynamicObstacleSentMs = 0;
  private dynamicObstacleIntervalMs = 160;

  constructor(scene: Scene) {
    this.scene = scene;
    this.trafficManager = new TrafficManager(this.scene.viewer);
  }

  private async addVehicle(vehicle: Vehicle): Promise<void> {
    try {
      if (this.activeVehicle) {
        this.removeVehicle(this.activeVehicle.id);
      }

      await vehicle.initialize(this.scene.scene);
      this.vehicles.set(vehicle.id, vehicle);
      this.waitForVehicleReady(vehicle.id);
      console.log(`Vehicle ${vehicle.id} added successfully`);
    } catch (error) {
      console.error(`Failed to add vehicle ${vehicle.id}:`, error);
    }
  }

  private waitForVehicleReady(vehicleId: string): void {
    const checkReady = () => {
      if (this.setActiveVehicle(vehicleId)) {
        console.log(`Vehicle ${vehicleId} is now ready and active`);
      } else {
        window.setTimeout(checkReady, 100);
      }
    };
    checkReady();
  }

  private emitStreamState(state: StreamState): void {
    this.currentStreamState = state;
    for (const callback of this.onStreamStateCallbacks) {
      callback(state);
    }
  }

  private emitStatus(message: string): void {
    this.lastStatusMessage = message;
    for (const callback of this.onStatusCallbacks) {
      callback(message);
    }
  }

  private emitRoute(route: RoutePlanData): void {
    this.currentRoute = route;
    for (const callback of this.onRouteCallbacks) {
      callback(route);
    }
  }

  private emitVisionFrame(frame: VisionFrameData): void {
    this.currentVisionFrame = frame;
    for (const callback of this.onVisionFrameCallbacks) {
      callback(frame);
    }
  }

  private emitNavigationContext(context: NavigationContextData): void {
    this.currentNavigationContext = context;
    for (const callback of this.onNavigationContextCallbacks) {
      callback(context);
    }
  }

  private resolveWsUrl(config: AutonavConfigData | null): string {
    if (config?.wsUrl) {
      return config.wsUrl;
    }
    let path = config?.wsPath || '/ws';
    if (path.startsWith('ws://') || path.startsWith('wss://')) {
      return path;
    }
    if (!path.startsWith('/')) {
      path = `/${path}`;
    }
    const host = window.location.host || DEFAULT_WS_HOST;
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${host}${path}`;
  }

  private async fetchJson<T>(
    url: string,
    init?: RequestInit,
    timeoutMs: number = 15000
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `${url} returned ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  private static isLatLon(value: unknown): value is [number, number] {
    if (!Array.isArray(value) || value.length !== 2) return false;
    return Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  private async sampleTerrainHeight(lon: number, lat: number): Promise<number | null> {
    try {
      const terrainProvider = this.scene.viewer.terrainProvider;
      if (!terrainProvider) return null;
      const positions = [Cesium.Cartographic.fromDegrees(lon, lat)];
      const sampled = await Cesium.sampleTerrainMostDetailed(terrainProvider, positions);
      const height = sampled?.[0]?.height;
      return Number.isFinite(height) ? Number(height) : null;
    } catch {
      return null;
    }
  }

  private async clampSpawnToTerrain(lon: number, lat: number): Promise<Cesium.Cartesian3> {
    const spawnOffsetM = 0.86;
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const probe = Cesium.Cartesian3.fromDegrees(lon, lat, 200.0);
      const clamped = this.scene.clampToHeight(probe);
      const globeHeight = this.scene.scene.globe?.getHeight?.(
        Cesium.Cartographic.fromDegrees(lon, lat)
      );
      if (clamped) {
        const tilesetHeight = Cesium.Cartographic.fromCartesian(clamped).height;
        if (!Number.isFinite(tilesetHeight)) {
          continue;
        }
        if (Number.isFinite(globeHeight)) {
          const delta = Number(tilesetHeight) - Number(globeHeight);
          // Prefer the visible photogrammetry surface to avoid underground spawns on elevated plazas/bridges.
          // Only fall back to globe when clamp returns an implausibly low value.
          if (delta < -2.0) {
            return Cesium.Cartesian3.fromDegrees(lon, lat, Number(globeHeight) + spawnOffsetM);
          }
        }
        return Cesium.Cartesian3.fromDegrees(lon, lat, Number(tilesetHeight) + spawnOffsetM);
      }
      if (attempt < maxAttempts - 1) {
        await this.sleep(120);
      }
    }

    const fallbackHeight = this.scene.scene.globe?.getHeight?.(Cesium.Cartographic.fromDegrees(lon, lat));
    let safeHeight = Number.isFinite(fallbackHeight) ? Number(fallbackHeight) : null;
    if (!Number.isFinite(safeHeight as number)) {
      safeHeight = await this.sampleTerrainHeight(lon, lat);
    }
    if (!Number.isFinite(safeHeight as number)) {
      // Last-resort floor to avoid underground spawn when terrain is still booting.
      safeHeight = 5.0;
    }
    return Cesium.Cartesian3.fromDegrees(lon, lat, Number(safeHeight) + spawnOffsetM);
  }

  private queueSpawnSettle(vehicleId: string): void {
    this.pendingSpawnSettleVehicleId = vehicleId;
    this.spawnSettleAttempts = 0;
  }

  private maybeSettleSpawnHeight(): void {
    const vehicleId = this.pendingSpawnSettleVehicleId;
    if (!vehicleId || this.spawnSettleInFlight) return;
    const vehicle = this.vehicles.get(vehicleId);
    if (!vehicle) {
      this.pendingSpawnSettleVehicleId = null;
      return;
    }
    if (!vehicle.isModelReady()) return;

    this.spawnSettleInFlight = true;
    this.spawnSettleAttempts += 1;
    const state = vehicle.getState();
    const cartographic = Cesium.Cartographic.fromCartesian(state.position);
    const lon = Cesium.Math.toDegrees(cartographic.longitude);
    const lat = Cesium.Math.toDegrees(cartographic.latitude);

    void this.clampSpawnToTerrain(lon, lat)
      .then((settledPosition) => {
        const nextState = vehicle.getState();
        vehicle.setState({
          ...nextState,
          position: settledPosition,
        });
        this.pendingSpawnSettleVehicleId = null;
        this.spawnSettleAttempts = 0;
      })
      .catch(() => {
        if (this.spawnSettleAttempts >= 4) {
          this.pendingSpawnSettleVehicleId = null;
          this.spawnSettleAttempts = 0;
        }
      })
      .finally(() => {
        this.spawnSettleInFlight = false;
      });
  }

  private async captureVisionFrame(
    robot: {
      lat: number;
      lon: number;
      heading: number;
      speed: number;
    }
  ): Promise<Pick<G1VisionFrame, 'imageDataUrl' | 'mountNode'> | null> {
    return this.visionViewer.capture(robot);
  }

  private maybeSendDynamicObstacles(nowMs: number): void {
    if (!this.trafficEnabled) return;
    if ((nowMs - this.lastDynamicObstacleSentMs) < this.dynamicObstacleIntervalMs) return;
    this.lastDynamicObstacleSentMs = nowMs;
    const active = this.activeVehicle;
    if (!active || !(active instanceof G1Robot)) return;
    const obstacles: DynamicObstacle[] = this.trafficManager.getObstacleSnapshot();
    if (obstacles.length === 0) return;
    active.sendDynamicObstacles(obstacles);
  }

  public async loadAutonavConfig(force: boolean = false): Promise<AutonavConfigData | null> {
    if (!force && this.autonavConfig) {
      return this.autonavConfig;
    }
    try {
      const config = await this.fetchJson<AutonavConfigData>('/config', { cache: 'no-store' }, 10000);
      this.autonavConfig = config;
      if (
        VehicleManager.isLatLon(config.start) &&
        VehicleManager.isLatLon(config.goal) &&
        Array.isArray(config.waypoints)
      ) {
        this.emitRoute({
          start: config.start,
          goal: config.goal,
          waypoints: config.waypoints,
          notes: config.notes || '',
          source: config.source,
          googleMapsRequested: config.googleMapsRequested,
          googleMapsUsed: config.googleMapsUsed,
          warning: config.warning,
          distanceM: config.distanceM,
          durationS: config.durationS,
          summary: config.summary,
          routeSourceVerified: config.routeSourceVerified,
        });
      }
      if (Number.isFinite(Number(config.simulationSpeed))) {
        this.currentSimulationSpeed = Number(config.simulationSpeed);
      }
      return config;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitStatus(`Config unavailable: ${message}`);
      return this.autonavConfig;
    }
  }

  public async spawnG1Robot(id: string = 'g1', position?: Cesium.Cartesian3): Promise<Vehicle> {
    const config = await this.loadAutonavConfig();
    const configStart = VehicleManager.isLatLon(config?.start) ? config?.start : undefined;
    const spawnPosition = position
      ? Cesium.Cartesian3.clone(position)
      : configStart
        ? await this.clampSpawnToTerrain(configStart[1], configStart[0])
        : await this.clampSpawnToTerrain(DEFAULT_SPAWN_LOCATION.lng, DEFAULT_SPAWN_LOCATION.lat);

    const robot = new G1Robot(id, {
      modelUrl: '/assets/g1.glb',
      scale: 1.0,
      position: spawnPosition,
      heading: 0,
      modelHeadingOffset: -Math.PI / 2,
      streamUrl: this.resolveWsUrl(config),
      nodeMapUrl: '/assets/g1_node_map.json',
      onStreamStateChange: (state) => this.emitStreamState(state),
      onStatus: (message) => this.emitStatus(message),
      onVisionFrame: (frame) => this.emitVisionFrame(frame),
      onNavigationContext: (context) => this.emitNavigationContext(context),
      visionCaptureProvider: (robotTelemetry) => this.captureVisionFrame(robotTelemetry),
    });

    await this.addVehicle(robot);
    this.queueSpawnSettle(robot.id);
    this.scene.setVehicleQualityMode('g1');
    this.emitStatus('Unitree G1 initialized.');
    return robot;
  }

  public async spawnCar(id: string = 'g1', position?: Cesium.Cartesian3): Promise<Vehicle> {
    return this.spawnG1Robot(id, position);
  }

  public async spawnAircraft(id: string = 'g1', position?: Cesium.Cartesian3): Promise<Vehicle> {
    return this.spawnG1Robot(id, position);
  }

  public async planRoute(request: RoutePlanRequest): Promise<RoutePlanData> {
    const body: Record<string, unknown> = {
      prompt: request.prompt?.trim() || null,
      useGemini: request.useGemini ?? true,
      useGoogleMaps: request.useGoogleMaps ?? true,
      waypoints: request.waypoints ?? 12,
    };
    const tokens = getTokens();
    if (tokens.gemini) {
      body.geminiApiKey = tokens.gemini;
    }
    if (tokens.googleMaps) {
      body.googleMapsApiKey = tokens.googleMaps;
    }
    if (VehicleManager.isLatLon(request.start)) {
      body.start = request.start;
    }
    if (VehicleManager.isLatLon(request.goal)) {
      body.goal = request.goal;
    }

    const data = await this.fetchJson<RoutePlanData>(
      '/api/plan',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      45000
    );
    this.emitRoute(data);
    this.emitStatus(data.notes || `Route planned (${data.waypoints.length} waypoints). Press Start Walking.`);
    return data;
  }

  public async startNavigation(restart: boolean = true): Promise<boolean> {
    const data = await this.fetchJson<{ running: boolean }>(
      '/api/start',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ restart }),
      },
      10000
    );
    this.emitStatus(data.running ? 'Navigation started.' : 'Navigation not started (missing route).');
    return Boolean(data.running);
  }

  public async stopNavigation(): Promise<void> {
    await this.fetchJson<{ running: boolean }>(
      '/api/stop',
      {
        method: 'POST',
      },
      10000
    );
    this.emitStatus('Navigation stopped.');
  }

  public async getSimulationSpeed(): Promise<number> {
    const data = await this.fetchJson<{ multiplier: number }>(
      '/api/sim/speed',
      { cache: 'no-store' },
      10000
    );
    const next = Number(data.multiplier);
    if (Number.isFinite(next) && next > 0) {
      this.currentSimulationSpeed = next;
    }
    return this.currentSimulationSpeed;
  }

  public async setSimulationSpeed(multiplier: number): Promise<number> {
    const data = await this.fetchJson<{ multiplier: number }>(
      '/api/sim/speed',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ multiplier }),
      },
      10000
    );
    const next = Number(data.multiplier);
    if (Number.isFinite(next) && next > 0) {
      this.currentSimulationSpeed = next;
    }
    this.emitStatus(`Simulation speed ${this.currentSimulationSpeed.toFixed(0)}x.`);
    return this.currentSimulationSpeed;
  }

  public removeVehicle(vehicleId: string): void {
    const vehicle = this.vehicles.get(vehicleId);
    if (vehicle) {
      vehicle.destroy();
      this.vehicles.delete(vehicleId);
      if (this.pendingSpawnSettleVehicleId === vehicleId) {
        this.pendingSpawnSettleVehicleId = null;
        this.spawnSettleAttempts = 0;
      }

      if (this.activeVehicle?.id === vehicleId) {
        const remainingVehicles = Array.from(this.vehicles.values());
        this.activeVehicle = remainingVehicles.length > 0 ? remainingVehicles[0] : null;
      }
      console.log(`Vehicle ${vehicleId} removed`);
    }
  }

  public setActiveVehicle(vehicleId: string): boolean {
    const vehicle = this.vehicles.get(vehicleId);
    if (vehicle && vehicle.isModelReady()) {
      this.activeVehicle = vehicle;
      if (this.onVehicleChangeCallback) {
        this.onVehicleChangeCallback(vehicle);
      }
      for (const callback of this.onVehicleChangeCallbacks) {
        callback(vehicle);
      }
      return true;
    }
    return false;
  }

  public getActiveVehicle(): Vehicle | null {
    return this.activeVehicle;
  }

  public getVehicle(vehicleId: string): Vehicle | null {
    return this.vehicles.get(vehicleId) || null;
  }

  public getAllVehicles(): Vehicle[] {
    return Array.from(this.vehicles.values());
  }

  public getVehicleCount(): number {
    return this.vehicles.size;
  }

  public update(deltaTime: number): void {
    this.maybeSettleSpawnHeight();
    this.trafficManager.update(Math.max(0, deltaTime));
    this.maybeSendDynamicObstacles(performance.now());
    for (const vehicle of this.vehicles.values()) {
      vehicle.update(deltaTime);
    }
  }

  public async toggleVehicleType(): Promise<void> {
    this.emitStatus('Only Unitree G1 is available in this build.');
  }

  public async restartCurrentVehicle(): Promise<void> {
    const config = await this.loadAutonavConfig();
    const start = VehicleManager.isLatLon(config?.start) ? config?.start : null;
    const vehicle = this.activeVehicle;
    if (!vehicle || !start) return;
    const settledStart = await this.clampSpawnToTerrain(start[1], start[0]);
    vehicle.setState({
      ...vehicle.getState(),
      position: settledStart,
      heading: 0,
      pitch: 0,
      roll: 0,
      velocity: 0,
      speed: 0,
    });
    this.queueSpawnSettle(vehicle.id);
  }

  public handleInput(inputName: string, pressed: boolean): void {
    if (!this.activeVehicle) return;
    this.activeVehicle.setInput({ [inputName]: pressed });
  }

  public setTargetSpeed(speed: number): void {
    if (!this.activeVehicle) return;
    this.activeVehicle.setInput({ targetSpeed: speed });
  }

  public setupInputHandling(inputManager: InputManager): void {
    inputManager.onInput('throttle', (pressed) => this.handleInput('throttle', pressed));
    inputManager.onInput('brake', (pressed) => this.handleInput('brake', pressed));
    inputManager.onInput('turnLeft', (pressed) => this.handleInput('turnLeft', pressed));
    inputManager.onInput('turnRight', (pressed) => this.handleInput('turnRight', pressed));
    inputManager.onInput('altitudeUp', (pressed) => this.handleInput('altitudeUp', pressed));
    inputManager.onInput('altitudeDown', (pressed) => this.handleInput('altitudeDown', pressed));
    inputManager.onInput('rollLeft', (pressed) => this.handleInput('rollLeft', pressed));
    inputManager.onInput('rollRight', (pressed) => this.handleInput('rollRight', pressed));
    inputManager.onTargetSpeedChange((speed) => this.setTargetSpeed(speed));

    inputManager.onInput('toggleRoverMode', (pressed) => {
      if (pressed) this.emitStatus('Mode switching is disabled in the G1 build.');
    });
    inputManager.onInput('toggleCollision', (pressed) => {
      if (pressed) this.emitStatus('Collision toggle is not used for Unitree G1.');
    });
    inputManager.onInput('restart', (pressed) => {
      if (pressed) void this.restartCurrentVehicle();
    });
  }

  public onVehicleChange(callback: (vehicle: Vehicle) => void): void {
    this.onVehicleChangeCallback = callback;
  }

  public addVehicleChangeListener(callback: (vehicle: Vehicle) => void): void {
    this.onVehicleChangeCallbacks.push(callback);
  }

  public onStreamStateChange(callback: (state: StreamState) => void): void {
    this.onStreamStateCallbacks.push(callback);
    callback(this.currentStreamState);
  }

  public onStatusChange(callback: (message: string) => void): void {
    this.onStatusCallbacks.push(callback);
    if (this.lastStatusMessage) {
      callback(this.lastStatusMessage);
    }
  }

  public onRouteChange(callback: (route: RoutePlanData) => void): void {
    this.onRouteCallbacks.push(callback);
    if (this.currentRoute) {
      callback(this.currentRoute);
    }
  }

  public onVisionFrame(callback: (frame: VisionFrameData) => void): void {
    this.onVisionFrameCallbacks.push(callback);
    if (this.currentVisionFrame) {
      callback(this.currentVisionFrame);
    }
  }

  public onNavigationContextChange(callback: (context: NavigationContextData) => void): void {
    this.onNavigationContextCallbacks.push(callback);
    if (this.currentNavigationContext) {
      callback(this.currentNavigationContext);
    }
  }

  public getCurrentStreamState(): StreamState {
    return this.currentStreamState;
  }

  public getLastStatusMessage(): string {
    return this.lastStatusMessage;
  }

  public getCurrentRoute(): RoutePlanData | null {
    return this.currentRoute;
  }

  public getCurrentVisionFrame(): VisionFrameData | null {
    return this.currentVisionFrame;
  }

  public getCurrentNavigationContext(): NavigationContextData | null {
    return this.currentNavigationContext;
  }

  public getCurrentSimulationSpeed(): number {
    return this.currentSimulationSpeed;
  }

  public setTrafficEnabled(enabled: boolean): void {
    this.trafficEnabled = Boolean(enabled);
    this.trafficManager.setEnabled(this.trafficEnabled);
    this.emitStatus(this.trafficEnabled ? 'Bridge traffic enabled.' : 'Bridge traffic disabled.');
  }

  public isTrafficEnabled(): boolean {
    return this.trafficEnabled;
  }

  public setVisionViewerEnabled(enabled: boolean): void {
    this.visionViewerEnabled = Boolean(enabled);
    this.visionViewer.setEnabled(this.visionViewerEnabled);
  }

  public setVisionViewerContainer(container: HTMLElement | null): void {
    this.visionViewer.setDisplayHost(container);
  }

  public getVisionViewerState(): VisionViewerStateData {
    return this.visionViewer.getState();
  }

  public getRuntimeMetrics(): RuntimeMetricsData | null {
    const active = this.activeVehicle;
    if (!active || !(active instanceof G1Robot)) {
      return null;
    }
    return active.getRuntimeMetrics();
  }

  public getHeadingOffsetRad(): number | null {
    const active = this.activeVehicle;
    if (!active || !(active instanceof G1Robot)) {
      return null;
    }
    return active.getModelHeadingOffsetRad();
  }

  public setHeadingOffsetRad(offsetRad: number): number | null {
    const active = this.activeVehicle;
    if (!active || !(active instanceof G1Robot)) {
      return null;
    }
    return active.setModelHeadingOffsetRad(offsetRad);
  }

  public destroy(): void {
    for (const vehicle of this.vehicles.values()) {
      vehicle.destroy();
    }
    this.vehicles.clear();
    this.activeVehicle = null;
    this.onStreamStateCallbacks = [];
    this.onStatusCallbacks = [];
    this.onRouteCallbacks = [];
    this.onVisionFrameCallbacks = [];
    this.onNavigationContextCallbacks = [];
    this.currentVisionFrame = null;
    this.currentNavigationContext = null;
    this.pendingSpawnSettleVehicleId = null;
    this.spawnSettleInFlight = false;
    this.spawnSettleAttempts = 0;
    this.trafficManager.destroy();
    this.visionViewer.destroy();
  }
}
