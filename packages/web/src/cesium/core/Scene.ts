import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { getTokens } from '../../utils/tokenValidator';

export interface QualityConfig {
  fxaaEnabled: boolean;
  maximumScreenSpaceError: number;
  dynamicScreenSpaceError: boolean;
  dynamicScreenSpaceErrorFactor: number;
  skipLevelOfDetail: boolean;
  bloomEnabled: boolean;
  hdr: boolean;
  exposure: number;
}

export class Scene {
  public viewer: Cesium.Viewer;
  public scene: Cesium.Scene;
  public camera: Cesium.Camera;
  public clock: Cesium.Clock;
  public primitives: Cesium.PrimitiveCollection;

  private rotationSpeed = Cesium.Math.toRadians(0.1);
  private earthSpinListener: Cesium.Event.RemoveCallback | null = null;
  private tileset: Cesium.Cesium3DTileset | null = null;
  private terrainReadyPromise: Promise<void>;

  constructor(containerId: string) {
    Cesium.Ion.defaultAccessToken = getTokens().cesium;

    const fallbackBaseLayer = new Cesium.ImageryLayer(
      new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
      })
    );

    this.viewer = new Cesium.Viewer(containerId, {
      timeline: false,
      animation: false,
      baseLayer: fallbackBaseLayer,
      baseLayerPicker: false,
      geocoder: false,
      shadows: false,
      msaaSamples: 1,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      infoBox: false,
      selectionIndicator: false,
      contextOptions: {
        webgl: {
          // Keeps the main render path fast; vision capture uses a dedicated viewer.
          preserveDrawingBuffer: false,
        },
      },
    });

    this.scene = this.viewer.scene;
    this.camera = this.viewer.camera;
    this.clock = this.viewer.clock;
    this.primitives = this.scene.primitives;

    this.setupScene();
    this.setupPostProcessing();
    this.terrainReadyPromise = this.loadTerrain();
  }

  private setupScene(): void {
    // Force 3D rendering mode (not 2D or Columbus view)
    this.viewer.scene.mode = Cesium.SceneMode.SCENE3D;

    // Keep a globe fallback visible until photorealistic tiles are ready.
    this.viewer.scene.globe.show = true;
    this.scene.debugShowFramesPerSecond = true;

    // Disable default camera controller (we use custom cameras in play mode)
    this.viewer.scene.screenSpaceCameraController.enableRotate = false;
    this.viewer.scene.screenSpaceCameraController.enableZoom = false;
    this.viewer.scene.screenSpaceCameraController.enableLook = false;
    this.viewer.scene.screenSpaceCameraController.enableTilt = false;

    // Mars-like atmosphere
    if (this.scene.skyAtmosphere) {
      // this.scene.skyAtmosphere.atmosphereMieCoefficient = new Cesium.Cartesian3(9.0e-5, 2.0e-5, 1.0e-5);
      // this.scene.skyAtmosphere.atmosphereRayleighCoefficient = new Cesium.Cartesian3(9.0e-6, 2.0e-6, 1.0e-6);
      // this.scene.skyAtmosphere.atmosphereRayleighScaleHeight = 9000;
      // this.scene.skyAtmosphere.atmosphereMieScaleHeight = 2700.0;
      // this.scene.skyAtmosphere.saturationShift = -0.1;
      // this.scene.skyAtmosphere.perFragmentAtmosphere = true;
    }
  }

  private setupPostProcessing(): void {
    const bloom = this.viewer.scene.postProcessStages.bloom;
    bloom.enabled = true;
    bloom.uniforms.brightness = -0.5;
    bloom.uniforms.stepSize = 1.0;
    bloom.uniforms.sigma = 3.0;
    bloom.uniforms.delta = 1.5;
    this.scene.highDynamicRange = true;
    this.viewer.scene.postProcessStages.exposure = 1.5;
    
    this.viewer.scene.postProcessStages.fxaa.enabled = true;
  }

  private async loadTerrain(): Promise<void> {
    console.log('Loading Google Photorealistic 3D Tiles...');
    try {
      this.tileset = await Cesium.createGooglePhotorealistic3DTileset(
        {
          onlyUsingWithGoogleGeocoder: true,
        },
        {
          maximumScreenSpaceError: 24,
          dynamicScreenSpaceError: true,
          dynamicScreenSpaceErrorDensity: 2.0e-4,
          dynamicScreenSpaceErrorFactor: 24.0,
          dynamicScreenSpaceErrorHeightFalloff: 0.25,
          cullRequestsWhileMoving: true,
          cullRequestsWhileMovingMultiplier: 60.0,
          skipLevelOfDetail: true,
          baseScreenSpaceError: 1024,
          skipScreenSpaceErrorFactor: 16,
          skipLevels: 1,
          preloadFlightDestinations: true,
          preloadWhenHidden: true,
        }
      );
      this.primitives.add(this.tileset);
      this.viewer.scene.globe.show = false;
      this.setVehicleQualityMode('g1');
      console.log('✓ Google Photorealistic 3D Tileset loaded successfully');
      console.log('3D tiles streaming - terrain will load as camera moves');
    } catch (error) {
      const message = String(error || '').toLowerCase();
      if (
        message.includes('401') ||
        message.includes('403') ||
        message.includes('unauthorized') ||
        message.includes('forbidden') ||
        message.includes('access token')
      ) {
        window.dispatchEvent(
          new CustomEvent('token:invalid', {
            detail: {
              provider: 'cesium',
              reason: 'photorealistic tiles authentication failed',
            },
          })
        );
      }
      // If 3D tiles fail, keep the globe fallback so the world is still visible.
      this.viewer.scene.globe.show = true;
      console.error('✗ 3D Tiles failed to load - falling back to 2D globe:', error);
      console.warn('Scene will render in 2D mode. Check Cesium token or network connection.');
    }
  }

  public async waitForTerrainReady(): Promise<void> {
    await this.terrainReadyPromise;
  }

  public async waitForWarmup(spawnPosition: Cesium.Cartesian3, timeoutMs: number = 15000): Promise<void> {
    console.log('Warming up terrain tiles around spawn location...');
    await this.waitForTerrainReady();
    if (!this.tileset) {
      console.warn('No 3D tileset available for warmup - skipping');
      return;
    }

    const spawnCartographic = Cesium.Cartographic.fromCartesian(spawnPosition);
    this.camera.setView({
      destination: Cesium.Cartesian3.fromRadians(
        spawnCartographic.longitude,
        spawnCartographic.latitude,
        480
      ),
      orientation: {
        heading: Cesium.Math.toRadians(230.0),
        pitch: Cesium.Math.toRadians(-20.0),
        roll: 0.0,
      },
    });

    const startMs = performance.now();
    let quietSinceMs = 0;

    await new Promise<void>((resolve) => {
      const removeListener = this.scene.postRender.addEventListener(() => {
        const nowMs = performance.now();
        const elapsedMs = nowMs - startMs;
        const stats = (
          this.tileset as unknown as {
            statistics?: {
              numberOfPendingRequests?: number;
              numberOfTilesProcessing?: number;
            };
          }
        )?.statistics;
        const pendingRequests = (stats?.numberOfPendingRequests ?? 0) + (stats?.numberOfTilesProcessing ?? 0);

        if (pendingRequests <= 0) {
          if (quietSinceMs <= 0) {
            quietSinceMs = nowMs;
          }
        } else {
          quietSinceMs = 0;
        }

        const probe = Cesium.Cartesian3.fromRadians(
          spawnCartographic.longitude,
          spawnCartographic.latitude,
          140
        );
        const clamped = this.clampToHeight(probe);
        const globeHeight = this.scene.globe?.getHeight?.(spawnCartographic);
        const hasTerrainSample = Boolean(clamped) || Number.isFinite(globeHeight);

        if (hasTerrainSample && quietSinceMs > 0 && nowMs - quietSinceMs >= 700) {
          console.log(`✓ Terrain warmup complete (${(elapsedMs / 1000).toFixed(1)}s) - 3D tiles ready`);
          removeListener();
          resolve();
          return;
        }

        if (elapsedMs >= timeoutMs) {
          console.warn(`Terrain warmup timeout (${(elapsedMs / 1000).toFixed(1)}s) - proceeding anyway`);
          console.log(`Pending tile requests: ${pendingRequests}, hasTerrainSample: ${hasTerrainSample}`);
          removeListener();
          resolve();
          return;
        }

        this.scene.requestRender?.();
      });
    });
  }

  public clampToHeight(position: Cesium.Cartesian3, objectsToExclude?: any[]): Cesium.Cartesian3 | undefined {
    return this.scene.clampToHeight(position, objectsToExclude);
  }

  public setVehicleQualityMode(vehicleType: 'aircraft' | 'car' | 'g1'): void {
    if (!this.tileset) return;
    
    this.tileset.maximumScreenSpaceError = 24;
    const icon = vehicleType === 'car' ? '🚗' : vehicleType === 'aircraft' ? '✈️' : '🤖';
    console.log(`${icon} Switched to ${vehicleType} mode - SSE: 24`);
  }

  public getQualityConfig(): QualityConfig {
    return {
      fxaaEnabled: this.viewer.scene.postProcessStages.fxaa.enabled,
      maximumScreenSpaceError: this.tileset?.maximumScreenSpaceError ?? 24,
      dynamicScreenSpaceError: this.tileset?.dynamicScreenSpaceError ?? true,
      dynamicScreenSpaceErrorFactor: this.tileset?.dynamicScreenSpaceErrorFactor ?? 24.0,
      skipLevelOfDetail: this.tileset?.skipLevelOfDetail ?? true,
      bloomEnabled: this.viewer.scene.postProcessStages.bloom.enabled,
      hdr: this.scene.highDynamicRange,
      exposure: this.viewer.scene.postProcessStages.exposure,
    };
  }

  public updateQualityConfig(config: Partial<QualityConfig>): void {
    if (config.fxaaEnabled !== undefined) {
      this.viewer.scene.postProcessStages.fxaa.enabled = config.fxaaEnabled;
    }

    if (this.tileset) {
      if (config.maximumScreenSpaceError !== undefined) {
        this.tileset.maximumScreenSpaceError = config.maximumScreenSpaceError;
      }
      if (config.dynamicScreenSpaceError !== undefined) {
        this.tileset.dynamicScreenSpaceError = config.dynamicScreenSpaceError;
      }
      if (config.dynamicScreenSpaceErrorFactor !== undefined) {
        this.tileset.dynamicScreenSpaceErrorFactor = config.dynamicScreenSpaceErrorFactor;
      }
      if (config.skipLevelOfDetail !== undefined) {
        this.tileset.skipLevelOfDetail = config.skipLevelOfDetail;
      }
    }

    if (config.bloomEnabled !== undefined) {
      this.viewer.scene.postProcessStages.bloom.enabled = config.bloomEnabled;
    }
    if (config.hdr !== undefined) {
      this.scene.highDynamicRange = config.hdr;
    }
    if (config.exposure !== undefined) {
      this.viewer.scene.postProcessStages.exposure = config.exposure;
    }
  }

  // Earth spinning functionality for startup sequence
  public startEarthSpin(): void {
    if (this.earthSpinListener) {
      return; // Already spinning
    }

    this.earthSpinListener = this.scene.postRender.addEventListener(() => {
      this.camera.rotateRight(this.rotationSpeed);
    });

    console.log('🌍 Earth spinning started - exploring the world...');
  }

  public stopEarthSpin(): void {
    if (this.earthSpinListener) {
      this.earthSpinListener();
      this.earthSpinListener = null;
      console.log('🌍 Earth spinning stopped');
    }
  }

  public enableDefaultCameraControls(enable: boolean): void {
    this.viewer.scene.screenSpaceCameraController.enableRotate = enable;
    this.viewer.scene.screenSpaceCameraController.enableZoom = enable;
    this.viewer.scene.screenSpaceCameraController.enableLook = enable;
    this.viewer.scene.screenSpaceCameraController.enableTilt = enable;
    this.viewer.scene.screenSpaceCameraController.enableTranslate = enable;
    console.log(`📷 Cesium default camera controls: ${enable ? 'ENABLED' : 'DISABLED'}`);
  }

  // Two-phase smooth zoom animation to target location
  public async zoomToLocation(position: Cesium.Cartesian3, duration: number = 5000): Promise<void> {
    const phase1Duration = duration - 1000; // Most of the time for approach
    const phase2Duration = 1000; // Last 1 second for final positioning

    console.log('📍 Zooming to spawn location...');

    // Phase 1: Approach the location without specific orientation
    await new Promise<void>((resolve) => {
      this.camera.flyTo({
        destination: Cesium.Cartesian3.fromRadians(
          Cesium.Cartographic.fromCartesian(position).longitude,
          Cesium.Cartographic.fromCartesian(position).latitude,
          400
        ),
        duration: phase1Duration / 1000, // Convert to seconds
        complete: () => {
          console.log('📍 Phase 1 complete - approaching target...');
          resolve();
        }
      });
    });

    // Phase 2: Final positioning with specific orientation
    // NOTE: Spawn at Opera House Forecourt pedestrian node (151.2147663, -33.8582722)
    // Heading 230° faces southwest (away from Opera House)
    // To see Opera House + roundabout, consider heading ~100-130° (east/southeast)
    return new Promise((resolve) => {
      const heading = Cesium.Math.toRadians(230.0);
      const pitch = Cesium.Math.toRadians(-15.0);

      this.camera.flyTo({
        destination: position,
        orientation: {
          heading: heading,
          pitch: pitch,
          roll: 0.0
        },
        duration: phase2Duration / 1000, // Convert to seconds
        complete: () => {
          console.log('📍 Zoom complete - ready for vehicle spawn');
          resolve();
        }
      });
    });
  }
}
