import * as Cesium from 'cesium';
import { Camera } from './Camera';

export class FirstPersonCamera extends Camera {
  private readonly eyeHeightM = 1.55;
  private readonly fovDeg = 75;

  private static readonly scratchUp = new Cesium.Cartesian3();
  private static readonly scratchForward = new Cesium.Cartesian3();
  private static readonly scratchEyePos = new Cesium.Cartesian3();
  private static readonly scratchLookDir = new Cesium.Cartesian3();
  private static readonly scratchTmp = new Cesium.Cartesian3();
  private static readonly scratchLocal = new Cesium.Cartesian3();

  constructor(cesiumCamera: Cesium.Camera) {
    super(cesiumCamera);
  }

  public update(_deltaTime: number): void {
    if (!this.isActive || !this.target || !this.target.isModelReady()) return;

    const state = this.target.getState();
    const position = state.position;
    const heading = state.heading;

    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(position);

    // World up vector
    const up = Cesium.Matrix4.multiplyByPointAsVector(
      enu,
      Cesium.Cartesian3.UNIT_Z,
      FirstPersonCamera.scratchUp
    );
    Cesium.Cartesian3.normalize(up, up);

    // Forward from heading
    FirstPersonCamera.scratchLocal.x = Math.sin(heading);
    FirstPersonCamera.scratchLocal.y = Math.cos(heading);
    FirstPersonCamera.scratchLocal.z = 0.0;
    const forward = Cesium.Matrix4.multiplyByPointAsVector(
      enu,
      FirstPersonCamera.scratchLocal,
      FirstPersonCamera.scratchForward
    );
    Cesium.Cartesian3.normalize(forward, forward);

    // Eye position = vehicle pos + eyeHeight * up + 0.08 * forward
    const eyePos = Cesium.Cartesian3.add(
      position,
      Cesium.Cartesian3.add(
        Cesium.Cartesian3.multiplyByScalar(up, this.eyeHeightM, FirstPersonCamera.scratchTmp),
        Cesium.Cartesian3.multiplyByScalar(forward, 0.08, FirstPersonCamera.scratchEyePos),
        FirstPersonCamera.scratchEyePos
      ),
      FirstPersonCamera.scratchEyePos
    );

    // Look direction: forward with slight downward tilt
    const downBias = Cesium.Cartesian3.multiplyByScalar(up, -0.03, FirstPersonCamera.scratchTmp);
    const lookDir = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.add(forward, downBias, FirstPersonCamera.scratchLookDir),
      FirstPersonCamera.scratchLookDir
    );

    this.cesiumCamera.setView({
      destination: eyePos,
      orientation: { direction: lookDir, up: up },
    });

    const frustum = this.cesiumCamera.frustum as Cesium.PerspectiveFrustum;
    if (frustum?.fov !== undefined) {
      frustum.fov = Cesium.Math.toRadians(this.fovDeg);
    }
  }
}
