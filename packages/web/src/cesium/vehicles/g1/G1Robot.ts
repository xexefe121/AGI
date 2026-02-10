import * as Cesium from 'cesium';
import { Vehicle, type VehicleConfig } from '../Vehicle';

export type StreamState = 'offline' | 'connecting' | 'live';

export interface G1RootPose {
  lat: number;
  lon: number;
  height: number;
  quat: [number, number, number, number];
}

export interface G1LinkPose {
  pos: [number, number, number];
  quat: [number, number, number, number];
}

export interface G1PosePayload {
  type?: string;
  message?: string;
  t?: number;
  simTimeS?: number;
  wallTimeS?: number;
  root?: Partial<G1RootPose>;
  links?: Record<string, Partial<G1LinkPose>>;
  nav?: Partial<G1NavigationPayload>;
  error?: string;
}

export interface G1NavigationPayload {
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

export interface G1RobotTelemetry {
  lat: number;
  lon: number;
  heading: number;
  speed: number;
}

export interface G1VisionFrame {
  imageDataUrl: string;
  capturedAtMs: number;
  robot?: G1RobotTelemetry;
  mountNode?: string;
}

export interface G1RuntimeMetrics {
  poseApplyHz: number;
  terrainQueryHz: number;
  terrainProbeHz: number;
  wsInHz: number;
  wsOutHz: number;
  avgCaptureMs: number;
}

interface NodeMapFile {
  map?: Record<string, string>;
  ignore?: string[];
  enable?: boolean;
}

export interface G1RobotConfig extends VehicleConfig {
  streamUrl: string;
  nodeMapUrl?: string;
  linkScale?: number;
  onStreamStateChange?: (state: StreamState) => void;
  onStatus?: (message: string) => void;
  onVisionFrame?: (frame: G1VisionFrame) => void;
  onNavigationContext?: (context: G1NavigationPayload) => void;
  visionCaptureProvider?: (robot: G1RobotTelemetry) => Promise<Pick<G1VisionFrame, 'imageDataUrl' | 'mountNode'> | null>;
}

export class G1Robot extends Vehicle {
  private streamUrl: string;
  private nodeMapUrl: string;
  private linkScale: number;
  private onStreamStateChange?: (state: StreamState) => void;
  private onStatus?: (message: string) => void;
  private onVisionFrame?: (frame: G1VisionFrame) => void;
  private onNavigationContext?: (context: G1NavigationPayload) => void;
  private visionCaptureProvider?: (
    robot: G1RobotTelemetry
  ) => Promise<Pick<G1VisionFrame, 'imageDataUrl' | 'mountNode'> | null>;

  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private destroyed = false;
  private latestPayload: G1PosePayload | null = null;
  private lastProcessedT = Number.NaN;

  private nodeMap: Record<string, string> = {};
  private ignoredNodes = new Set<string>();
  private nodeCache = new Map<string, unknown>();
  private enableLinkAnimation = false;

  private lastPosePosition: Cesium.Cartesian3 | null = null;
  private lastPoseTimeMs: number | null = null;
  private lastGeoLat: number | null = null;
  private lastGeoLon: number | null = null;
  private smoothedHeadingRad = Number.NaN;
  private terrainHeightM = 0;
  private terrainHeightValid = false;
  private currentLat: number | null = null;
  private currentLon: number | null = null;
  private lastStaticPoseRefreshMs = 0;
  private frameCaptureTimer: number | null = null;
  private terrainProbeTimer: number | null = null;
  private frameCaptureIntervalMs = 2300;
  private terrainProbeIntervalMs = 1500;
  private terrainProbeSeq = 0;
  private dynamicObstacleSeq = 0;
  private lastPoseApplyMs = 0;
  private minPoseApplyIntervalMs = 33;
  private lastTerrainSampleMs = 0;
  private minTerrainSampleIntervalMs = 300;
  private lastCaptureErrorMs = 0;
  private lastBlackFrameNoticeMs = 0;
  private pendingVisionCapture = false;
  private pendingVisionCaptureListener: Cesium.Event.RemoveCallback | null = null;
  private pendingVisionCaptureRestore: (() => void) | null = null;
  private lastVisionMountNodeUsed: string | null = null;
  private visionMountNodeName: string | null = null;
  private visionMountAnnounced = false;
  private frameProbeCtx: CanvasRenderingContext2D | null = null;
  private readonly pelvisToGroundOffsetM = 0.86;
  private perfWindowStartedMs = performance.now();
  private perfPoseApplied = 0;
  private perfTerrainQueries = 0;
  private perfTerrainProbes = 0;
  private perfFramesCaptured = 0;
  private perfFrameCaptureMsTotal = 0;
  private perfWsIn = 0;
  private perfWsOut = 0;
  private lastMetrics: G1RuntimeMetrics = {
    poseApplyHz: 0,
    terrainQueryHz: 0,
    terrainProbeHz: 0,
    wsInHz: 0,
    wsOutHz: 0,
    avgCaptureMs: 0,
  };

  private static readonly scratchModelMatrix = new Cesium.Matrix4();
  private static readonly scratchRotationMatrix = new Cesium.Matrix3();
  private static readonly scratchRotationMatrix4 = new Cesium.Matrix4();
  private static readonly scratchQuat = new Cesium.Quaternion();
  private static readonly scratchRobotHPR = new Cesium.HeadingPitchRoll();
  private static readonly scratchModelHPR = new Cesium.HeadingPitchRoll();
  private static readonly visionNodeCandidates = ['head_link', 'Head', 'head', 'd435_link', 'mid360_link', 'logo_link'];
  private static readonly headingOffsetStorageKey = 'g1_heading_offset_v1';
  private headingCalibrationSamples = 0;
  private headingFastLockComplete = false;
  private headingAlignedStreak = 0;

  constructor(id: string, config: G1RobotConfig) {
    super(id, config);
    this.loadHeadingOffsetFromStorage();
    this.streamUrl = config.streamUrl;
    this.nodeMapUrl = config.nodeMapUrl || '/assets/g1_node_map.json';
    this.linkScale = config.linkScale ?? 1.0;
    this.onStreamStateChange = config.onStreamStateChange;
    this.onStatus = config.onStatus;
    this.onVisionFrame = config.onVisionFrame;
    this.onNavigationContext = config.onNavigationContext;
    this.visionCaptureProvider = config.visionCaptureProvider;
  }

  public override async initialize(scene: Cesium.Scene): Promise<void> {
    await super.initialize(scene);
    await this.loadNodeMap();
    this.connectStream();
  }

  protected override onModelReady(): void {
    this.onStatus?.('G1 model ready.');
  }

  public override update(_deltaTime: number): void {
    const payload = this.latestPayload;
    if (!payload || !payload.root) return;

    const stamp = Number(payload.t);
    if (Number.isFinite(stamp) && stamp === this.lastProcessedT) {
      return;
    }
    if (Number.isFinite(stamp)) {
      this.lastProcessedT = stamp;
    } else {
      this.lastProcessedT = Date.now();
    }

    const nowMs = performance.now();
    if (nowMs - this.lastPoseApplyMs < this.minPoseApplyIntervalMs) {
      return;
    }
    this.lastPoseApplyMs = nowMs;
    this.perfPoseApplied += 1;

    this.applyPose(payload);
    this.maybeEmitPerfStatus();
  }

  public override destroy(): void {
    this.destroyed = true;
    this.cancelPendingVisionCapture();
    this.stopPerceptionStreaming();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore websocket shutdown errors.
      }
      this.ws = null;
    }
    this.emitStreamState('offline');
    super.destroy();
  }

  private async loadNodeMap(): Promise<void> {
    try {
      const response = await fetch(this.nodeMapUrl, { cache: 'no-store' });
      if (!response.ok) return;
      const parsed = (await response.json()) as NodeMapFile | Record<string, string>;
      const mapCandidate =
        typeof (parsed as NodeMapFile).map === 'object' && (parsed as NodeMapFile).map !== null
          ? (parsed as NodeMapFile).map
          : parsed;
      this.nodeMap = { ...(mapCandidate as Record<string, string>) };
      this.ignoredNodes = new Set((parsed as NodeMapFile).ignore ?? []);
      this.enableLinkAnimation = (parsed as NodeMapFile).enable !== false;
    } catch {
      this.nodeMap = {};
      this.ignoredNodes = new Set();
      // Still allow direct sourceName->nodeName animation when node map is absent.
      this.enableLinkAnimation = true;
    }
  }

  private connectStream(): void {
    if (this.destroyed) return;
    this.stopPerceptionStreaming();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore stale websocket close errors.
      }
      this.ws = null;
    }

    this.emitStreamState('connecting');
    this.ws = new WebSocket(this.streamUrl);

    this.ws.onopen = () => {
      this.emitStreamState('live');
      this.onStatus?.('Pose stream connected.');
      this.startPerceptionStreaming();
      this.sendWsPayload({
        type: 'session_start',
        source: 'browser',
        t: Date.now() / 1000,
      });
    };

    this.ws.onmessage = (event: MessageEvent<string>) => {
      try {
        this.perfWsIn += 1;
        const payload = JSON.parse(event.data) as G1PosePayload;
        if (payload.type === 'status' && typeof payload.message === 'string') {
          this.onStatus?.(payload.message);
          return;
        }
        if (payload.error) {
          this.onStatus?.(payload.error);
          return;
        }
        if (payload.root) {
          this.latestPayload = payload;
        }
      } catch {
        // Ignore malformed websocket payloads.
      }
    };

    this.ws.onerror = () => {
      this.emitStreamState('offline');
      this.stopPerceptionStreaming();
    };

    this.ws.onclose = () => {
      this.emitStreamState('offline');
      this.stopPerceptionStreaming();
      if (this.destroyed) return;
      if (this.reconnectTimer !== null) {
        window.clearTimeout(this.reconnectTimer);
      }
      this.reconnectTimer = window.setTimeout(() => this.connectStream(), 1500);
    };
  }

  private emitStreamState(state: StreamState): void {
    this.onStreamStateChange?.(state);
  }

  private startPerceptionStreaming(): void {
    this.stopPerceptionStreaming();
    this.frameCaptureTimer = window.setInterval(
      () => this.sendCameraFrame(),
      this.frameCaptureIntervalMs
    );
    this.terrainProbeTimer = window.setInterval(
      () => this.sendTerrainProbe(),
      this.terrainProbeIntervalMs
    );
    this.sendTerrainProbe();
  }

  private stopPerceptionStreaming(): void {
    this.cancelPendingVisionCapture();
    if (this.frameCaptureTimer !== null) {
      window.clearInterval(this.frameCaptureTimer);
      this.frameCaptureTimer = null;
    }
    if (this.terrainProbeTimer !== null) {
      window.clearInterval(this.terrainProbeTimer);
      this.terrainProbeTimer = null;
    }
  }

  private canSendToServer(): boolean {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  private sendWsPayload(payload: Record<string, unknown>): void {
    if (!this.canSendToServer() || !this.ws) return;
    try {
      this.ws.send(JSON.stringify(payload));
      this.perfWsOut += 1;
    } catch {
      // Ignore transient websocket send failures.
    }
  }

  private buildRobotTelemetry(): G1RobotTelemetry | null {
    if (this.currentLat === null || this.currentLon === null) return null;
    return {
      lat: this.currentLat,
      lon: this.currentLon,
      heading: this.hpRoll.heading,
      speed: this.velocity,
    };
  }

  private sendCameraFrame(): void {
    if (!this.canSendToServer() || this.pendingVisionCapture) return;
    const robot = this.buildRobotTelemetry();
    if (!robot) return;

    if (this.visionCaptureProvider) {
      this.pendingVisionCapture = true;
      const captureStartedMs = performance.now();
      void this.visionCaptureProvider(robot)
        .then((result) => {
          if (!result?.imageDataUrl) return;
          const dataUrl = result.imageDataUrl;
          const comma = dataUrl.indexOf(',');
          const image = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
          const capturedAtMs = Date.now();
          this.lastVisionMountNodeUsed = result.mountNode ?? this.lastVisionMountNodeUsed;
          this.onVisionFrame?.({
            imageDataUrl: dataUrl,
            capturedAtMs,
            robot,
            mountNode: this.lastVisionMountNodeUsed || undefined,
          });
          this.sendWsPayload({
            type: 'camera_frame',
            image,
            robot,
          });
          this.recordFrameCapture(performance.now() - captureStartedMs);
        })
        .catch(() => {
          const now = Date.now();
          if (now - this.lastCaptureErrorMs > 6000) {
            this.lastCaptureErrorMs = now;
            this.onStatus?.('Vision viewer capture unavailable.');
          }
        })
        .finally(() => {
          this.pendingVisionCapture = false;
          this.maybeEmitPerfStatus();
        });
      return;
    }
    this.captureWithVisionRig(robot);
  }

  private cancelPendingVisionCapture(): void {
    if (this.pendingVisionCaptureListener) {
      this.pendingVisionCaptureListener();
      this.pendingVisionCaptureListener = null;
    }
    if (this.pendingVisionCaptureRestore) {
      this.pendingVisionCaptureRestore();
      this.pendingVisionCaptureRestore = null;
    }
    this.pendingVisionCapture = false;
  }

  private captureWithVisionRig(robot: G1RobotTelemetry): void {
    if (!this.sceneRef || this.pendingVisionCapture) return;

    const pose = this.getVisionCameraPose();
    if (!pose) return;

    const camera = this.sceneRef.camera;
    const savedPosition = Cesium.Cartesian3.clone(camera.positionWC);
    const savedDirection = Cesium.Cartesian3.clone(camera.directionWC);
    const savedUp = Cesium.Cartesian3.clone(camera.upWC);
    const perspective = camera.frustum as Cesium.PerspectiveFrustum;
    const savedFov =
      perspective && typeof (perspective as { fov?: unknown }).fov === 'number'
        ? Number((perspective as Cesium.PerspectiveFrustum).fov)
        : null;

    const restoreCamera = () => {
      if (!this.sceneRef) return;
      if (savedFov !== null) {
        (camera.frustum as Cesium.PerspectiveFrustum).fov = savedFov;
      }
      camera.setView({
        destination: savedPosition,
        orientation: {
          direction: savedDirection,
          up: savedUp,
        },
      });
      this.sceneRef.requestRender?.();
    };

    const clearPendingCapture = () => {
      if (this.pendingVisionCaptureListener) {
        this.pendingVisionCaptureListener();
        this.pendingVisionCaptureListener = null;
      }
      this.pendingVisionCaptureRestore = null;
      this.pendingVisionCapture = false;
    };

    this.pendingVisionCapture = true;
    this.pendingVisionCaptureRestore = restoreCamera;
    const captureStartedMs = performance.now();

    try {
      if (savedFov !== null) {
        (camera.frustum as Cesium.PerspectiveFrustum).fov = Cesium.Math.toRadians(78);
      }
      camera.setView({
        destination: pose.destination,
        orientation: {
          direction: pose.direction,
          up: pose.up,
        },
      });
      this.pendingVisionCaptureListener = this.sceneRef.postRender.addEventListener(() => {
        try {
          if (!this.sceneRef) return;
          if (this.isFrameLikelyBlack()) {
            const now = Date.now();
            if (now - this.lastBlackFrameNoticeMs > 8000) {
              this.lastBlackFrameNoticeMs = now;
              this.onStatus?.('Gemini vision camera is black; waiting for rendered scene.');
            }
            return;
          }
          const dataUrl = this.sceneRef.canvas.toDataURL('image/jpeg', 0.6);
          const comma = dataUrl.indexOf(',');
          const image = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
          this.lastVisionMountNodeUsed = pose.mountNode;
          const capturedAtMs = Date.now();
          this.onVisionFrame?.({
            imageDataUrl: dataUrl,
            capturedAtMs,
            robot,
            mountNode: this.lastVisionMountNodeUsed || undefined,
          });
          this.sendWsPayload({
            type: 'camera_frame',
            image,
            robot,
          });
          this.recordFrameCapture(performance.now() - captureStartedMs);
        } catch {
          const now = Date.now();
          if (now - this.lastCaptureErrorMs > 6000) {
            this.lastCaptureErrorMs = now;
            this.onStatus?.('Camera capture unavailable in this browser context.');
          }
        } finally {
          restoreCamera();
          clearPendingCapture();
          this.maybeEmitPerfStatus();
        }
      });
      this.sceneRef.requestRender?.();
    } catch {
      restoreCamera();
      clearPendingCapture();
      const now = Date.now();
      if (now - this.lastCaptureErrorMs > 6000) {
        this.lastCaptureErrorMs = now;
        this.onStatus?.('Camera capture unavailable in this browser context.');
      }
    }
  }

  private getVisionCameraPose():
    | { destination: Cesium.Cartesian3; direction: Cesium.Cartesian3; up: Cesium.Cartesian3; mountNode: string }
    | null {
    if (!this.primitive || !this.sceneRef) return this.getFallbackVisionPose();
    const primitiveWithNodes = this.primitive as unknown as { getNode?: (name: string) => any };
    const mountNodeName = this.resolveVisionMountNodeName(primitiveWithNodes);
    if (!mountNodeName) {
      return this.getFallbackVisionPose();
    }
    const mountNode = this.getNode(primitiveWithNodes, mountNodeName);
    const nodeMatrix = mountNode?.matrix as Cesium.Matrix4 | undefined;
    if (!mountNode || !nodeMatrix) {
      return this.getFallbackVisionPose();
    }

    const worldMatrix = Cesium.Matrix4.multiply(
      this.primitive.modelMatrix,
      nodeMatrix,
      new Cesium.Matrix4()
    );
    const nodePosition = Cesium.Matrix4.getTranslation(worldMatrix, new Cesium.Cartesian3());
    const nodeRotation = Cesium.Matrix4.getMatrix3(worldMatrix, new Cesium.Matrix3());
    const axisX = Cesium.Matrix3.getColumn(nodeRotation, 0, new Cesium.Cartesian3());
    const axisY = Cesium.Matrix3.getColumn(nodeRotation, 1, new Cesium.Cartesian3());

    const headingForward = this.forwardFromHeading(nodePosition, this.hpRoll.heading);
    const forwardCandidates = [
      Cesium.Cartesian3.normalize(axisX, new Cesium.Cartesian3()),
      Cesium.Cartesian3.normalize(axisY, new Cesium.Cartesian3()),
      Cesium.Cartesian3.negate(Cesium.Cartesian3.normalize(axisX, new Cesium.Cartesian3()), new Cesium.Cartesian3()),
      Cesium.Cartesian3.negate(Cesium.Cartesian3.normalize(axisY, new Cesium.Cartesian3()), new Cesium.Cartesian3()),
    ];
    let forward = forwardCandidates[0];
    let bestScore = -Number.MAX_VALUE;
    for (const candidate of forwardCandidates) {
      const score = Cesium.Cartesian3.dot(candidate, headingForward);
      if (score > bestScore) {
        bestScore = score;
        forward = candidate;
      }
    }

    const up = this.worldUpAt(nodePosition);
    const blendedForward = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.add(
        Cesium.Cartesian3.multiplyByScalar(headingForward, 0.15, new Cesium.Cartesian3()),
        Cesium.Cartesian3.multiplyByScalar(forward, 0.85, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      ),
      new Cesium.Cartesian3()
    );
    const downBias = Cesium.Cartesian3.multiplyByScalar(up, -0.02, new Cesium.Cartesian3());
    const viewDirection = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.add(blendedForward, downBias, new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    const cameraPosition = Cesium.Cartesian3.add(
      nodePosition,
      Cesium.Cartesian3.add(
        Cesium.Cartesian3.multiplyByScalar(up, 0.06, new Cesium.Cartesian3()),
        Cesium.Cartesian3.multiplyByScalar(viewDirection, 0.10, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      ),
      new Cesium.Cartesian3()
    );

    return {
      destination: cameraPosition,
      direction: viewDirection,
      up,
      mountNode: mountNodeName,
    };
  }

  private getFallbackVisionPose():
    | { destination: Cesium.Cartesian3; direction: Cesium.Cartesian3; up: Cesium.Cartesian3; mountNode: string }
    | null {
    if (!this.sceneRef) return null;
    const up = this.worldUpAt(this.position);
    const forward = this.forwardFromHeading(this.position, this.hpRoll.heading);
    const direction = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.add(
        forward,
        Cesium.Cartesian3.multiplyByScalar(up, -0.02, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      ),
      new Cesium.Cartesian3()
    );
    const destination = Cesium.Cartesian3.add(
      this.position,
      Cesium.Cartesian3.add(
        Cesium.Cartesian3.multiplyByScalar(up, 1.55, new Cesium.Cartesian3()),
        Cesium.Cartesian3.multiplyByScalar(forward, 0.05, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      ),
      new Cesium.Cartesian3()
    );
    return {
      destination,
      direction,
      up,
      mountNode: 'fallback_head',
    };
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

  private resolveVisionMountNodeName(primitiveWithNodes: { getNode?: (name: string) => any }): string | null {
    if (this.visionMountNodeName) return this.visionMountNodeName;
    for (const candidate of G1Robot.visionNodeCandidates) {
      const node = this.getNode(primitiveWithNodes, candidate);
      if (!node) continue;
      this.visionMountNodeName = candidate;
      if (!this.visionMountAnnounced) {
        this.visionMountAnnounced = true;
        this.onStatus?.(`Gemini vision rig mounted to ${candidate}.`);
      }
      return candidate;
    }
    return null;
  }

  private ensureProbeContext(): CanvasRenderingContext2D | null {
    if (this.frameProbeCtx) return this.frameProbeCtx;
    const probeCanvas = document.createElement('canvas');
    probeCanvas.width = 64;
    probeCanvas.height = 36;
    const ctx = probeCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    this.frameProbeCtx = ctx;
    return ctx;
  }

  private isFrameLikelyBlack(): boolean {
    if (!this.sceneRef) return false;
    const ctx = this.ensureProbeContext();
    if (!ctx) return false;
    try {
      const src = this.sceneRef.canvas;
      ctx.drawImage(src, 0, 0, 64, 36);
      const pixels = ctx.getImageData(0, 0, 64, 36).data;
      let lumaSum = 0;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 16) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        lumaSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        count += 1;
      }
      if (count <= 0) return false;
      const avgLuma = lumaSum / count;
      return avgLuma < 2.5;
    } catch {
      return false;
    }
  }

  private sampleProbeHeights(
    worldPoint: Cesium.Cartesian3
  ): { heightM: number; groundHeightM: number; surfaceDeltaM: number } | null {
    if (!this.sceneRef) return null;
    const cartographic = Cesium.Cartographic.fromCartesian(worldPoint);
    this.perfTerrainQueries += 1;
    const groundRaw = this.sceneRef.globe?.getHeight?.(cartographic);
    const groundHeightM = Number.isFinite(groundRaw) ? Number(groundRaw) : Number.NaN;

    this.perfTerrainQueries += 1;
    const exclude = this.primitive ? [this.primitive] : undefined;
    const clamped = this.sceneRef.clampToHeight(worldPoint, exclude);
    const surfaceHeightM = clamped
      ? Number(Cesium.Cartographic.fromCartesian(clamped).height)
      : Number.NaN;

    const hasGround = Number.isFinite(groundHeightM);
    const hasSurface = Number.isFinite(surfaceHeightM);
    if (!hasGround && !hasSurface) {
      return null;
    }
    if (hasGround && hasSurface) {
      return {
        heightM: groundHeightM,
        groundHeightM,
        surfaceDeltaM: surfaceHeightM - groundHeightM,
      };
    }
    const height = hasGround ? groundHeightM : surfaceHeightM;
    return {
      heightM: height,
      groundHeightM: height,
      surfaceDeltaM: 0,
    };
  }

  private sendTerrainProbe(): void {
    if (!this.canSendToServer() || !this.sceneRef) return;
    const robot = this.buildRobotTelemetry();
    if (!robot) return;

    const baseHeight = this.terrainHeightValid ? this.terrainHeightM : 0;
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(this.position);
    const bearingsDeg = [-60, -40, -20, -10, 0, 10, 20, 40, 60];
    const distancesM = [1.5, 3, 5, 7];
    const samples: Array<Record<string, number>> = [];

    for (const bearingDeg of bearingsDeg) {
      const absoluteHeading = this.hpRoll.heading + Cesium.Math.toRadians(bearingDeg);
      const east = Math.sin(absoluteHeading);
      const north = Math.cos(absoluteHeading);
      for (const distanceM of distancesM) {
        const local = new Cesium.Cartesian3(east * distanceM, north * distanceM, 100.0);
        const world = Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3());
        const sampled = this.sampleProbeHeights(world);
        if (!sampled) continue;
        samples.push({
          bearingDeg,
          distanceM,
          heightM: sampled.heightM,
          groundHeightM: sampled.groundHeightM,
          surfaceDeltaM: sampled.surfaceDeltaM,
          deltaM: sampled.heightM - baseHeight,
        });
      }
    }

    if (samples.length === 0) return;
    this.terrainProbeSeq += 1;
    this.perfTerrainProbes += 1;
    this.sendWsPayload({
      type: 'terrain_probe',
      seq: this.terrainProbeSeq,
      capturedAtMs: Date.now(),
      baseHeightM: baseHeight,
      samples,
      robot,
    });
    this.maybeEmitPerfStatus();
  }

  public sendDynamicObstacles(
    obstacles: Array<{
      id: string;
      lat: number;
      lon: number;
      radiusM: number;
      kind: string;
      speedMps: number;
    }>
  ): void {
    if (!this.canSendToServer()) return;
    if (!Array.isArray(obstacles) || obstacles.length === 0) return;
    const cleaned = obstacles
      .map((item) => ({
        id: String(item.id || ''),
        lat: Number(item.lat),
        lon: Number(item.lon),
        radiusM: Number(item.radiusM),
        kind: String(item.kind || 'vehicle'),
        speedMps: Number(item.speedMps),
      }))
      .filter(
        (item) =>
          item.id.length > 0 &&
          Number.isFinite(item.lat) &&
          Number.isFinite(item.lon) &&
          Number.isFinite(item.radiusM) &&
          item.radiusM > 0
      );
    if (cleaned.length === 0) return;
    this.dynamicObstacleSeq += 1;
    this.sendWsPayload({
      type: 'dynamic_obstacles',
      seq: this.dynamicObstacleSeq,
      capturedAtMs: Date.now(),
      obstacles: cleaned,
    });
  }

  private applyPose(payload: G1PosePayload): void {
    const root = payload.root;
    if (!root) return;
    this.emitNavigationContext(payload.nav);

    const lat = Number(root.lat);
    const lon = Number(root.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const nowMs = performance.now();
    if (this.currentLat !== null && this.currentLon !== null) {
      const dLat = Math.abs(lat - this.currentLat);
      const dLon = Math.abs(lon - this.currentLon);
      if (dLat < 1e-9 && dLon < 1e-9) {
        // Keep refreshing height while stationary so early bad terrain samples do not lock the robot underground.
        if ((nowMs - this.lastStaticPoseRefreshMs) < 220) return;
      }
    }
    this.lastStaticPoseRefreshMs = nowMs;
    this.currentLat = lat;
    this.currentLon = lon;

    const terrainHeight = this.sampleTerrainHeight(lat, lon);
    const altitude = terrainHeight + this.pelvisToGroundOffsetM;
    this.position = Cesium.Cartesian3.fromDegrees(lon, lat, altitude);

    const moveHeading = this.estimateMotionHeading(lat, lon);
    const quat = this.sanitizeQuat(root.quat);
    this.applyRootTransform(quat, moveHeading);
    this.applyLinkAnimation(payload.links);
    const simTimeCandidate = Number(payload.nav?.simTimeS ?? payload.simTimeS);
    this.updateSpeedEstimate(Number.isFinite(simTimeCandidate) ? simTimeCandidate : payload.t);
  }

  private sampleTerrainHeight(lat: number, lon: number): number {
    if (!this.sceneRef) return 0;
    const nowMs = performance.now();
    if ((nowMs - this.lastTerrainSampleMs) < this.minTerrainSampleIntervalMs && this.terrainHeightValid) {
      return this.terrainHeightM;
    }
    this.lastTerrainSampleMs = nowMs;
    const maxTerrainHeightM = 3000;
    try {
      this.perfTerrainQueries += 1;
      const cartographic = Cesium.Cartographic.fromDegrees(lon, lat, 0);
      let sampledHeight = Number.NaN;
      const globeHeight = this.sceneRef.globe?.getHeight?.(cartographic);
      if (Number.isFinite(globeHeight)) {
        sampledHeight = Number(globeHeight);
      }

      // Secondary probe against scene geometry. Ignore tall rooftop hits and prefer bare-terrain height.
      const probe = Cesium.Cartesian3.fromDegrees(lon, lat, 100.0);
      const exclude = this.primitive ? [this.primitive] : undefined;
      this.perfTerrainQueries += 1;
      const clamped = this.sceneRef.clampToHeight(probe, exclude);
      if (clamped) {
        const clampedHeight = Cesium.Cartographic.fromCartesian(clamped).height;
        if (!Number.isFinite(sampledHeight)) {
          sampledHeight = clampedHeight;
        } else {
          const delta = clampedHeight - sampledHeight;
          // Prefer visible scene surface (photogrammetry/3D tiles) unless it is implausibly lower than terrain.
          if (delta >= -2.0) {
            sampledHeight = clampedHeight;
          }
        }
      }

      if (!Number.isFinite(sampledHeight) || Math.abs(sampledHeight) > maxTerrainHeightM) {
        return this.terrainHeightValid ? this.terrainHeightM : 0;
      }

      if (!this.terrainHeightValid) {
        this.terrainHeightM = sampledHeight;
        this.terrainHeightValid = true;
      } else {
        const delta = sampledHeight - this.terrainHeightM;
        // Snap big mismatches quickly so elevated surfaces do not remain below ground.
        if (Math.abs(delta) > 12.0) {
          this.terrainHeightM = sampledHeight;
        } else if (Math.abs(delta) > 2.0) {
          this.terrainHeightM += delta * 0.75;
        } else {
          this.terrainHeightM += delta * 0.5;
        }
      }
      return this.terrainHeightM;
    } catch {
      return this.terrainHeightValid ? this.terrainHeightM : 0;
    }
  }

  private emitNavigationContext(rawNav: unknown): void {
    if (!this.onNavigationContext || !rawNav || typeof rawNav !== 'object') return;
    const nav = rawNav as Record<string, unknown>;
    let currentWaypoint: [number, number] | null | undefined = undefined;
    if (Array.isArray(nav.currentWaypoint) && nav.currentWaypoint.length === 2) {
      const lat = Number(nav.currentWaypoint[0]);
      const lon = Number(nav.currentWaypoint[1]);
      currentWaypoint = Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
    } else if (nav.currentWaypoint === null) {
      currentWaypoint = null;
    }
    const remainingWaypoints = Number(nav.remainingWaypoints);
    const runningRaw = nav.running;
    const simTimeS = Number(nav.simTimeS);
    const wallTimeS = Number(nav.wallTimeS);
    const speedRequested = Number(nav.speedRequested);
    const speedAchieved = Number(nav.speedAchieved);
    const crossTrackErrorM = Number(nav.crossTrackErrorM);
    const progressPct = Number(nav.progressPct);
    const offRouteRaw = nav.offRoute;
    const terrainBlockReason = typeof nav.terrainBlockReason === 'string' ? nav.terrainBlockReason : undefined;
    const obstacleBlockReason = typeof nav.obstacleBlockReason === 'string' ? nav.obstacleBlockReason : undefined;
    this.onNavigationContext({
      currentWaypoint,
      remainingWaypoints: Number.isFinite(remainingWaypoints)
        ? Math.max(0, Math.floor(remainingWaypoints))
        : undefined,
      running: typeof runningRaw === 'boolean' ? runningRaw : undefined,
      simTimeS: Number.isFinite(simTimeS) ? simTimeS : undefined,
      wallTimeS: Number.isFinite(wallTimeS) ? wallTimeS : undefined,
      speedRequested: Number.isFinite(speedRequested) ? speedRequested : undefined,
      speedAchieved: Number.isFinite(speedAchieved) ? speedAchieved : undefined,
      crossTrackErrorM: Number.isFinite(crossTrackErrorM) ? crossTrackErrorM : undefined,
      progressPct: Number.isFinite(progressPct) ? progressPct : undefined,
      offRoute: typeof offRouteRaw === 'boolean' ? offRouteRaw : undefined,
      terrainBlockReason,
      obstacleBlockReason,
    });
  }

  private sanitizeQuat(raw: unknown): [number, number, number, number] {
    if (!Array.isArray(raw) || raw.length !== 4) {
      return [1, 0, 0, 0];
    }
    const q = raw.map((v) => Number(v));
    if (!q.every(Number.isFinite)) {
      return [1, 0, 0, 0];
    }
    return [q[0], q[1], q[2], q[3]];
  }

  private applyRootTransform(
    quatWxyz: [number, number, number, number],
    moveHeading: number | null
  ): void {
    const [qw, qx, qy, qz] = quatWxyz;
    G1Robot.scratchQuat.x = qx;
    G1Robot.scratchQuat.y = qy;
    G1Robot.scratchQuat.z = qz;
    G1Robot.scratchQuat.w = qw;

    Cesium.HeadingPitchRoll.fromQuaternion(G1Robot.scratchQuat, G1Robot.scratchRobotHPR);
    const rawHeading = G1Robot.scratchRobotHPR.heading;
    let heading = Number.isFinite(rawHeading) ? rawHeading : this.smoothedHeadingRad;
    if (moveHeading !== null) {
      // Align rendered facing with the movement direction while preserving model forward-axis offset.
      const targetBodyHeading = this.normalizeSignedAngle(moveHeading - this.modelHeadingOffset);
      if (Number.isFinite(heading)) {
        heading = this.lerpAngle(heading, targetBodyHeading, 0.72);
      } else {
        heading = targetBodyHeading;
      }
    }
    if (!Number.isFinite(heading)) heading = 0;
    if (!Number.isFinite(this.smoothedHeadingRad)) {
      this.smoothedHeadingRad = heading;
    } else {
      const smoothing = moveHeading !== null ? 0.32 : 0.08;
      this.smoothedHeadingRad = this.lerpAngle(this.smoothedHeadingRad, heading, smoothing);
    }
    this.hpRoll.heading = Cesium.Math.zeroToTwoPi(this.smoothedHeadingRad);
    this.hpRoll.pitch = G1Robot.scratchRobotHPR.pitch;
    this.hpRoll.roll = G1Robot.scratchRobotHPR.roll;
    this.maybeAutoCalibrateHeading(moveHeading);

    if (!this.primitive) return;
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(this.position);
    G1Robot.scratchModelHPR.heading = this.hpRoll.heading + this.modelHeadingOffset;
    G1Robot.scratchModelHPR.pitch = this.hpRoll.pitch;
    G1Robot.scratchModelHPR.roll = this.hpRoll.roll;
    Cesium.Quaternion.fromHeadingPitchRoll(G1Robot.scratchModelHPR, G1Robot.scratchQuat);
    Cesium.Matrix3.fromQuaternion(G1Robot.scratchQuat, G1Robot.scratchRotationMatrix);
    Cesium.Matrix4.fromRotationTranslation(
      G1Robot.scratchRotationMatrix,
      Cesium.Cartesian3.ZERO,
      G1Robot.scratchRotationMatrix4
    );
    Cesium.Matrix4.multiply(
      enu,
      G1Robot.scratchRotationMatrix4,
      G1Robot.scratchModelMatrix
    );
    Cesium.Matrix4.clone(G1Robot.scratchModelMatrix, this.primitive.modelMatrix);
  }

  private applyLinkAnimation(
    links: Record<string, Partial<G1LinkPose>> | undefined
  ): void {
    if (!this.enableLinkAnimation) return;
    if (!links || !this.primitive || !this.isModelReady()) return;
    const primitiveWithNodes = this.primitive as unknown as { getNode?: (name: string) => any };
    if (typeof primitiveWithNodes.getNode !== 'function') return;

    for (const [sourceName, pose] of Object.entries(links)) {
      const nodeName = this.mapNodeName(sourceName);
      if (!nodeName) continue;
      const node = this.getNode(primitiveWithNodes, nodeName);
      if (!node) continue;

      const pos = pose.pos;
      const quat = pose.quat;
      if (!Array.isArray(pos) || !Array.isArray(quat)) continue;
      if (pos.length !== 3 || quat.length !== 4) continue;
      if (![...pos, ...quat].every((v) => Number.isFinite(Number(v)))) continue;
      const px = Number(pos[0]);
      const py = Number(pos[1]);
      const pz = Number(pos[2]);
      const [adjX, adjY, adjZ] = this.remapLinkPosition(px, py, pz);
      // Reject obviously invalid link positions to avoid exploding meshes.
      if (Math.abs(adjX) > 2.5 || Math.abs(adjY) > 2.5 || Math.abs(adjZ) > 2.5) continue;

      const remappedQuat = this.remapLinkQuat(
        Number(quat[0]),
        Number(quat[1]),
        Number(quat[2]),
        Number(quat[3])
      );
      const nodeQuat = new Cesium.Quaternion(
        remappedQuat[1],
        remappedQuat[2],
        remappedQuat[3],
        remappedQuat[0]
      );
      const nodeRot = Cesium.Matrix3.fromQuaternion(nodeQuat);
      node.matrix = Cesium.Matrix4.fromRotationTranslation(
        nodeRot,
        new Cesium.Cartesian3(
          adjX * this.linkScale,
          adjY * this.linkScale,
          adjZ * this.linkScale
        )
      );
    }
  }

  private remapLinkPosition(x: number, y: number, z: number): [number, number, number] {
    // MuJoCo link frame (x,y,z) -> GLB link frame (x,z,-y).
    return [x, z, -y];
  }

  private remapLinkQuat(
    w: number,
    x: number,
    y: number,
    z: number
  ): [number, number, number, number] {
    // Same basis change as remapLinkPosition: R' = A R A^-1, where A = Rx(-90deg).
    const s = Math.SQRT1_2;
    const aW = s;
    const aX = -s;
    const aY = 0;
    const aZ = 0;
    const aiW = s;
    const aiX = s;
    const aiY = 0;
    const aiZ = 0;

    const tW = aW * w - aX * x - aY * y - aZ * z;
    const tX = aW * x + aX * w + aY * z - aZ * y;
    const tY = aW * y - aX * z + aY * w + aZ * x;
    const tZ = aW * z + aX * y - aY * x + aZ * w;

    const outW = tW * aiW - tX * aiX - tY * aiY - tZ * aiZ;
    const outX = tW * aiX + tX * aiW + tY * aiZ - tZ * aiY;
    const outY = tW * aiY - tX * aiZ + tY * aiW + tZ * aiX;
    const outZ = tW * aiZ + tX * aiY - tY * aiX + tZ * aiW;
    return [outW, outX, outY, outZ];
  }

  private mapNodeName(sourceName: string): string | null {
    if (this.ignoredNodes.has(sourceName)) return null;
    return this.nodeMap[sourceName] || sourceName;
  }

  private getNode(
    primitiveWithNodes: { getNode?: (name: string) => any },
    nodeName: string
  ): any | null {
    if (this.nodeCache.has(nodeName)) {
      return this.nodeCache.get(nodeName);
    }
    const node = primitiveWithNodes.getNode?.(nodeName) ?? null;
    if (node) {
      this.nodeCache.set(nodeName, node);
      return node;
    }
    return null;
  }

  private updateSpeedEstimate(simTimeS: number | undefined): void {
    const nowMs = Number.isFinite(Number(simTimeS)) ? Number(simTimeS) * 1000 : Date.now();
    if (!this.lastPosePosition || this.lastPoseTimeMs === null) {
      this.lastPosePosition = Cesium.Cartesian3.clone(this.position);
      this.lastPoseTimeMs = nowMs;
      this.velocity = 0;
      this.speed = 0;
      return;
    }

    const dt = Math.max(0.03, (nowMs - this.lastPoseTimeMs) / 1000);
    const distance = Cesium.Cartesian3.distance(this.position, this.lastPosePosition);
    const speedMps = Math.max(0, distance / dt);
    this.velocity = speedMps;
    this.speed = speedMps * 3.6;

    Cesium.Cartesian3.clone(this.position, this.lastPosePosition);
    this.lastPoseTimeMs = nowMs;
  }

  private estimateMotionHeading(lat: number, lon: number): number | null {
    const prevLat = this.lastGeoLat;
    const prevLon = this.lastGeoLon;
    this.lastGeoLat = lat;
    this.lastGeoLon = lon;
    if (prevLat === null || prevLon === null) return null;

    const toRad = Math.PI / 180;
    const dLat = (lat - prevLat) * toRad;
    const dLon = (lon - prevLon) * toRad;
    const meanLat = ((lat + prevLat) * 0.5) * toRad;
    const east = dLon * Math.cos(meanLat);
    const north = dLat;
    const movement = Math.hypot(east, north);
    if (movement < 5e-9) return null;
    return Math.atan2(east, north);
  }

  private lerpAngle(start: number, end: number, factor: number): number {
    const normalizedStart = Cesium.Math.zeroToTwoPi(start);
    const normalizedEnd = Cesium.Math.zeroToTwoPi(end);
    let delta = normalizedEnd - normalizedStart;
    if (delta > Math.PI) {
      delta -= Cesium.Math.TWO_PI;
    } else if (delta < -Math.PI) {
      delta += Cesium.Math.TWO_PI;
    }
    return Cesium.Math.zeroToTwoPi(normalizedStart + delta * factor);
  }

  private normalizeSignedAngle(rad: number): number {
    let value = Number(rad);
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
  }

  private loadHeadingOffsetFromStorage(): void {
    try {
      const raw = localStorage.getItem(G1Robot.headingOffsetStorageKey);
      if (!raw) return;
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        this.modelHeadingOffset = this.normalizeSignedAngle(parsed);
      }
    } catch {
      // Ignore storage errors and keep configured default.
    }
  }

  private persistHeadingOffset(): void {
    try {
      localStorage.setItem(G1Robot.headingOffsetStorageKey, String(this.modelHeadingOffset));
    } catch {
      // Ignore storage errors in restricted contexts.
    }
  }

  private maybeAutoCalibrateHeading(moveHeading: number | null): void {
    if (moveHeading === null) return;
    if (this.velocity < 0.12) return;
    if (this.headingCalibrationSamples >= 360) return;

    const modelHeading = this.hpRoll.heading + this.modelHeadingOffset;
    const error = this.normalizeSignedAngle(moveHeading - modelHeading);
    if (!Number.isFinite(error) || Math.abs(error) > Cesium.Math.toRadians(70)) {
      return;
    }

    if (!this.headingFastLockComplete) {
      const fastCorrection = Cesium.Math.clamp(error, -0.22, 0.22) * 0.35;
      if (Math.abs(fastCorrection) > 1e-4) {
        this.modelHeadingOffset = this.normalizeSignedAngle(this.modelHeadingOffset + fastCorrection);
      }
      this.headingCalibrationSamples += 1;
      if (Math.abs(error) <= Cesium.Math.toRadians(15)) {
        this.headingAlignedStreak += 1;
      } else {
        this.headingAlignedStreak = 0;
      }
      if (this.headingAlignedStreak >= 20 || this.headingCalibrationSamples >= 90) {
        this.headingFastLockComplete = true;
        this.persistHeadingOffset();
        this.onStatus?.(
          `Heading lock complete: ${(Cesium.Math.toDegrees(this.modelHeadingOffset)).toFixed(1)} deg`
        );
      }
      return;
    }

    const correction = Cesium.Math.clamp(error, -0.04, 0.04) * 0.06;
    if (Math.abs(correction) < 1e-4) return;
    this.modelHeadingOffset = this.normalizeSignedAngle(this.modelHeadingOffset + correction);
    this.headingCalibrationSamples += 1;
    if (this.headingCalibrationSamples % 45 === 0) {
      this.persistHeadingOffset();
      this.onStatus?.(`Heading auto-calibrated: ${(Cesium.Math.toDegrees(this.modelHeadingOffset)).toFixed(1)} deg`);
    }
  }

  public getModelHeadingOffsetRad(): number {
    return this.modelHeadingOffset;
  }

  public setModelHeadingOffsetRad(offsetRad: number): number {
    const next = Number(offsetRad);
    if (!Number.isFinite(next)) {
      return this.modelHeadingOffset;
    }
    this.modelHeadingOffset = this.normalizeSignedAngle(next);
    this.persistHeadingOffset();
    // Respect explicit manual override and stop further automatic drift.
    this.headingCalibrationSamples = 360;
    this.headingFastLockComplete = true;
    this.headingAlignedStreak = 0;
    this.updateModelMatrix();
    return this.modelHeadingOffset;
  }

  private recordFrameCapture(captureMs: number): void {
    this.perfFramesCaptured += 1;
    this.perfFrameCaptureMsTotal += Math.max(0, captureMs);
  }

  private maybeEmitPerfStatus(): void {
    const nowMs = performance.now();
    const elapsedS = (nowMs - this.perfWindowStartedMs) / 1000;
    if (elapsedS < 5.0) return;

    const avgCaptureMs =
      this.perfFramesCaptured > 0 ? this.perfFrameCaptureMsTotal / this.perfFramesCaptured : 0;
    this.lastMetrics = {
      poseApplyHz: this.perfPoseApplied / elapsedS,
      terrainQueryHz: this.perfTerrainQueries / elapsedS,
      terrainProbeHz: this.perfTerrainProbes / elapsedS,
      wsInHz: this.perfWsIn / elapsedS,
      wsOutHz: this.perfWsOut / elapsedS,
      avgCaptureMs,
    };
    this.onStatus?.(
      `[perf-client] pose=${this.lastMetrics.poseApplyHz.toFixed(1)}/s terrainQ=${this.lastMetrics.terrainQueryHz.toFixed(1)}/s probes=${this.lastMetrics.terrainProbeHz.toFixed(1)}/s wsIn=${this.lastMetrics.wsInHz.toFixed(1)}/s wsOut=${this.lastMetrics.wsOutHz.toFixed(1)}/s cap=${this.lastMetrics.avgCaptureMs.toFixed(1)}ms`
    );

    this.perfWindowStartedMs = nowMs;
    this.perfPoseApplied = 0;
    this.perfTerrainQueries = 0;
    this.perfTerrainProbes = 0;
    this.perfFramesCaptured = 0;
    this.perfFrameCaptureMsTotal = 0;
    this.perfWsIn = 0;
    this.perfWsOut = 0;
  }

  public getRuntimeMetrics(): G1RuntimeMetrics {
    return { ...this.lastMetrics };
  }
}
