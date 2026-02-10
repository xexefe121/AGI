import * as Cesium from 'cesium';
import type { CameraType } from '../managers/CameraManager';
import type {
  AutonavConfigData,
  RoutePlanData,
  RuntimeMetricsData,
  VisionFrameData,
  VisionViewerStateData,
} from '../managers/VehicleManager';
import type { StreamState } from '../vehicles/g1/G1Robot';

export interface VehicleStateData {
  speed: number;
  velocity: number;
  position: Cesium.Cartesian3;
  heading: number;
  pitch: number;
  roll: number;
}

export interface CameraStateData {
  type: CameraType;
}

export interface RoverModeData {
  enabled: boolean;
}

export interface CollisionDetectionData {
  enabled: boolean;
}

export interface OnlinePlayer {
  id: string;
  name: string;
  position: Cesium.Cartesian3;
  heading: number;
  vehicleType: string;
}

export interface PlayersData {
  players: OnlinePlayer[];
  updateType: 'full' | 'incremental';
}

export interface GameReadyData {
  ready: boolean;
}

export interface LocationChangedData {
  longitude: number;
  latitude: number;
  altitude: number;
}

export interface CrashData {
  crashed: boolean;
}

export interface StreamStateData {
  state: StreamState;
}

export interface StatusData {
  message: string;
}

export interface RouteChangedData extends RoutePlanData {}

export interface AutonavConfigLoadedData {
  config: AutonavConfigData | null;
}

export interface VisionFrameChangedData {
  frame: VisionFrameData;
}

export interface NavigationContextChangedData {
  currentWaypoint?: [number, number] | null;
  remainingWaypoints?: number;
  running?: boolean;
  simTimeS?: number;
  wallTimeS?: number;
  speedRequested?: number;
  speedAchieved?: number;
  crossTrackErrorM?: number;
  progressPct?: number;
  offRoute?: boolean;
  terrainBlockReason?: string;
  obstacleBlockReason?: string;
}

export interface RuntimeMetricsChangedData {
  metrics: RuntimeMetricsData | null;
}

export interface VisionViewerStateChangedData {
  state: VisionViewerStateData;
}

export interface GameEvents {
  gameReady: GameReadyData;
  vehicleStateChanged: VehicleStateData;
  cameraChanged: CameraStateData;
  roverModeChanged: RoverModeData;
  collisionDetectionChanged: CollisionDetectionData;
  playersUpdated: PlayersData;
  locationChanged: LocationChangedData;
  crashed: CrashData;
  streamStateChanged: StreamStateData;
  statusChanged: StatusData;
  routeChanged: RouteChangedData;
  autonavConfigLoaded: AutonavConfigLoadedData;
  visionFrameChanged: VisionFrameChangedData;
  navigationContextChanged: NavigationContextChangedData;
  runtimeMetricsChanged: RuntimeMetricsChangedData;
  visionViewerStateChanged: VisionViewerStateChangedData;
  [key: string]: unknown;
}
