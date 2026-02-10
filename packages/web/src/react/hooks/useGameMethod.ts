import { useGameBridge } from './useGameBridge';
import type { CameraType } from '../../cesium/managers/CameraManager';
import type { VehicleStateData } from '../../cesium/bridge/types';
import type { QualityConfig } from '../../cesium/core/Scene';
import type {
  AutonavConfigData,
  NavigationContextData,
  RuntimeMetricsData,
  RoutePlanData,
  RoutePlanRequest,
  VisionFrameData,
  VisionViewerStateData,
} from '../../cesium/managers/VehicleManager';
import type { StreamState } from '../../cesium/vehicles/g1/G1Robot';

export function useGameMethod() {
  const bridge = useGameBridge();

  return {
    switchCamera: () => bridge.switchCamera(),
    getCameraType: (): CameraType => bridge.getCameraType(),
    toggleRoverMode: () => bridge.toggleRoverMode(),
    toggleVehicleType: () => bridge.toggleVehicleType(),
    getRoverMode: (): boolean => bridge.getRoverMode(),
    toggleCollisionDetection: () => bridge.toggleCollisionDetection(),
    getCollisionDetection: (): boolean => bridge.getCollisionDetection(),
    getVehicleState: (): VehicleStateData | null => bridge.getVehicleState(),
    teleportTo: (longitude: number, latitude: number, altitude: number, heading?: number) =>
      bridge.teleportTo(longitude, latitude, altitude, heading),
    restart: () => bridge.restart(),
    getQualitySettings: (): QualityConfig => bridge.getQualitySettings(),
    updateQualitySettings: (config: Partial<QualityConfig>) => bridge.updateQualitySettings(config),
    applyQualityPreset: (preset: 'performance' | 'balanced' | 'quality' | 'ultra') => bridge.applyQualityPreset(preset),
    setThrottle: (percent: number) => bridge.setThrottle(percent),
    planRoute: (request: RoutePlanRequest): Promise<RoutePlanData> => bridge.planRoute(request),
    startNavigation: (restart?: boolean): Promise<boolean> => bridge.startNavigation(restart),
    stopNavigation: (): Promise<void> => bridge.stopNavigation(),
    getSimulationSpeed: (): Promise<number> => bridge.getSimulationSpeed(),
    setSimulationSpeed: (multiplier: number): Promise<number> => bridge.setSimulationSpeed(multiplier),
    getAutonavConfig: (force?: boolean): Promise<AutonavConfigData | null> => bridge.getAutonavConfig(force),
    getStreamState: (): StreamState => bridge.getStreamState(),
    getLastStatusMessage: (): string => bridge.getLastStatusMessage(),
    getCurrentRoute: (): RoutePlanData | null => bridge.getCurrentRoute(),
    getCurrentVisionFrame: (): VisionFrameData | null => bridge.getCurrentVisionFrame(),
    getCurrentNavigationContext: (): NavigationContextData | null => bridge.getCurrentNavigationContext(),
    getCurrentSimulationSpeed: (): number => bridge.getCurrentSimulationSpeed(),
    setTrafficEnabled: (enabled: boolean): void => bridge.setTrafficEnabled(enabled),
    getTrafficEnabled: (): boolean => bridge.getTrafficEnabled(),
    setVisionViewerEnabled: (enabled: boolean) => bridge.setVisionViewerEnabled(enabled),
    setVisionViewerContainer: (container: HTMLElement | null) => bridge.setVisionViewerContainer(container),
    getVisionViewerState: (): VisionViewerStateData => bridge.getVisionViewerState(),
    getRuntimeMetrics: (): RuntimeMetricsData | null => bridge.getRuntimeMetrics(),
    getHeadingOffsetRad: (): number | null => bridge.getHeadingOffsetRad(),
    setHeadingOffsetRad: (offsetRad: number): number | null => bridge.setHeadingOffsetRad(offsetRad),
  };
}
