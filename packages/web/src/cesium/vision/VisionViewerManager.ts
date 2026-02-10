import * as Cesium from 'cesium';
import { getTokens } from '../../utils/tokenValidator';
import type { G1RobotTelemetry } from '../vehicles/g1/G1Robot';

export interface VisionViewerState {
  enabled: boolean;
  mounted: boolean;
  captureHz: number;
  lastCaptureMs: number;
}

export class VisionViewerManager {
  private viewer: Cesium.Viewer | null = null;
  private terrainReady: Promise<void> | null = null;
  private rootElement: HTMLDivElement | null = null;
  private offscreenHost: HTMLDivElement | null = null;
  private displayHost: HTMLElement | null = null;
  private enabled = true;
  private lastCaptureAtMs = 0;
  private minCaptureIntervalMs = 100;
  private captureCount = 0;
  private captureWindowStartedMs = performance.now();
  private captureHz = 0;
  private lastCaptureMs = 0;

  constructor() {
    this.ensureHosts();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = Boolean(enabled);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setDisplayHost(container: HTMLElement | null): void {
    this.displayHost = container;
    this.ensureHosts();
    if (!this.rootElement) return;
    const parent = container ?? this.offscreenHost;
    if (!parent) return;
    if (this.rootElement.parentElement !== parent) {
      parent.appendChild(this.rootElement);
    }
  }

  public async capture(
    robot: G1RobotTelemetry
  ): Promise<{ imageDataUrl: string; mountNode: string } | null> {
    if (!this.enabled) return null;
    const nowMs = performance.now();
    if ((nowMs - this.lastCaptureAtMs) < this.minCaptureIntervalMs) {
      return null;
    }
    this.lastCaptureAtMs = nowMs;

    const viewer = this.ensureViewer();
    await this.ensureTerrainReady(viewer);
    this.setFirstPersonPose(viewer, robot);
    viewer.scene.requestRender?.();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const captureStartMs = performance.now();
    const dataUrl = viewer.scene.canvas.toDataURL('image/jpeg', 0.62);
    this.lastCaptureMs = Math.max(0, performance.now() - captureStartMs);
    this.captureCount += 1;
    this.updateCaptureRate(performance.now());
    return {
      imageDataUrl: dataUrl,
      mountNode: 'vision_fpv',
    };
  }

  public getState(): VisionViewerState {
    return {
      enabled: this.enabled,
      mounted: Boolean(this.displayHost),
      captureHz: this.captureHz,
      lastCaptureMs: this.lastCaptureMs,
    };
  }

  public destroy(): void {
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.destroy();
    }
    this.viewer = null;
    this.terrainReady = null;
    this.rootElement?.remove();
    this.offscreenHost?.remove();
    this.rootElement = null;
    this.offscreenHost = null;
    this.displayHost = null;
  }

  private ensureHosts(): void {
    if (!this.rootElement) {
      this.rootElement = document.createElement('div');
      this.rootElement.className = 'w-full h-full rounded-md overflow-hidden bg-black';
      this.rootElement.style.width = '100%';
      this.rootElement.style.height = '100%';
    }
    if (!this.offscreenHost) {
      this.offscreenHost = document.createElement('div');
      this.offscreenHost.style.position = 'fixed';
      this.offscreenHost.style.left = '-20000px';
      this.offscreenHost.style.top = '-20000px';
      this.offscreenHost.style.width = '320px';
      this.offscreenHost.style.height = '180px';
      this.offscreenHost.style.pointerEvents = 'none';
      this.offscreenHost.style.opacity = '0';
      document.body.appendChild(this.offscreenHost);
    }
    const parent = this.displayHost ?? this.offscreenHost;
    if (parent && this.rootElement.parentElement !== parent) {
      parent.appendChild(this.rootElement);
    }
  }

  private ensureViewer(): Cesium.Viewer {
    if (this.viewer && !this.viewer.isDestroyed()) {
      return this.viewer;
    }
    this.ensureHosts();
    if (!this.rootElement) {
      throw new Error('Vision viewer root element missing.');
    }

    Cesium.Ion.defaultAccessToken = getTokens().cesium;
    this.viewer = new Cesium.Viewer(this.rootElement, {
      timeline: false,
      animation: false,
      baseLayer: false,
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
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true,
        },
      },
    });

    this.viewer.scene.globe.show = false;
    this.viewer.scene.screenSpaceCameraController.enableRotate = false;
    this.viewer.scene.screenSpaceCameraController.enableZoom = false;
    this.viewer.scene.screenSpaceCameraController.enableLook = false;
    this.viewer.scene.screenSpaceCameraController.enableTilt = false;
    this.viewer.scene.screenSpaceCameraController.enableTranslate = false;
    return this.viewer;
  }

  private async ensureTerrainReady(viewer: Cesium.Viewer): Promise<void> {
    if (this.terrainReady) {
      await this.terrainReady;
      return;
    }
    this.terrainReady = (async () => {
      try {
        const tileset = await Cesium.createGooglePhotorealistic3DTileset(
          {
            onlyUsingWithGoogleGeocoder: true,
          },
          {
            maximumScreenSpaceError: 24,
            dynamicScreenSpaceError: true,
            dynamicScreenSpaceErrorFactor: 24.0,
            skipLevelOfDetail: true,
            preloadFlightDestinations: true,
            preloadWhenHidden: true,
          }
        );
        viewer.scene.primitives.add(tileset);
      } catch {
        // Leave viewer available even if tiles fail to load.
      }
    })();
    await this.terrainReady;
  }

  private setFirstPersonPose(viewer: Cesium.Viewer, robot: G1RobotTelemetry): void {
    const lat = Number(robot.lat);
    const lon = Number(robot.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const cartographic = Cesium.Cartographic.fromDegrees(lon, lat);
    const terrainHeight = viewer.scene.globe?.getHeight?.(cartographic);
    const eyeHeight = (Number.isFinite(terrainHeight) ? Number(terrainHeight) : 0) + 1.55;
    const heading = Number.isFinite(robot.heading) ? Number(robot.heading) : 0;

    const eyePos = Cesium.Cartesian3.fromDegrees(lon, lat, eyeHeight);
    const up = this.worldUpAt(eyePos);
    const forward = this.forwardFromHeading(eyePos, heading);
    const downBias = Cesium.Cartesian3.multiplyByScalar(up, -0.03, new Cesium.Cartesian3());
    const direction = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.add(forward, downBias, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );

    viewer.camera.setView({
      destination: eyePos,
      orientation: {
        direction,
        up,
      },
    });

    const frustum = viewer.camera.frustum as Cesium.PerspectiveFrustum;
    if (frustum && typeof frustum.fov === 'number') {
      frustum.fov = Cesium.Math.toRadians(78);
    }
  }

  private worldUpAt(position: Cesium.Cartesian3): Cesium.Cartesian3 {
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(position);
    const up = Cesium.Matrix4.multiplyByPointAsVector(
      enu,
      Cesium.Cartesian3.UNIT_Z,
      new Cesium.Cartesian3()
    );
    return Cesium.Cartesian3.normalize(up, up);
  }

  private forwardFromHeading(position: Cesium.Cartesian3, headingRad: number): Cesium.Cartesian3 {
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(position);
    const localForward = new Cesium.Cartesian3(Math.sin(headingRad), Math.cos(headingRad), 0.0);
    const worldForward = Cesium.Matrix4.multiplyByPointAsVector(
      enu,
      localForward,
      new Cesium.Cartesian3()
    );
    return Cesium.Cartesian3.normalize(worldForward, worldForward);
  }

  private updateCaptureRate(nowMs: number): void {
    const elapsedS = (nowMs - this.captureWindowStartedMs) / 1000;
    if (elapsedS < 1.0) return;
    this.captureHz = this.captureCount / elapsedS;
    this.captureCount = 0;
    this.captureWindowStartedMs = nowMs;
  }
}
