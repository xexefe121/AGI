import * as Cesium from 'cesium';
import { Camera } from './Camera';

export class FollowCloseCamera extends Camera {
  private baseDistance: number = 5;

  private targetCameraHeading: number = 0;
  private targetCameraPitch: number = 0;
  private currentCameraHeading: number = 0;
  private currentCameraPitch: number = 0;

  private readonly cameraLerpFactor: number = 0.15;

  private hpRange: Cesium.HeadingPitchRange = new Cesium.HeadingPitchRange();

  // GTA-style orbit state
  private userYawOffset: number = 0;
  private userPitchOffset: number = 0;
  private userDistanceOffset: number = 0;
  private orbiting: boolean = false;

  protected onActivate(): void {
    if (this.target && this.target.isModelReady()) {
      const boundingSphere = this.target.getBoundingSphere();
      if (boundingSphere) {
        const state = this.target.getState();
        const heading = state.heading + Math.PI;
        const pitch = Cesium.Math.toRadians(-10.0);

        this.currentCameraHeading = this.targetCameraHeading = Cesium.Math.zeroToTwoPi(heading);
        this.currentCameraPitch = this.targetCameraPitch = pitch;

        this.hpRange.heading = heading;
        this.hpRange.pitch = pitch;
        this.hpRange.range = this.baseDistance;

        this.userYawOffset = 0;
        this.userPitchOffset = 0;
        this.userDistanceOffset = 0;
        this.orbiting = false;
      }
    }
  }

  public override addYawInput(delta: number): void {
    this.userYawOffset += delta;
    this.orbiting = true;
  }

  public override addPitchInput(delta: number): void {
    this.userPitchOffset = Math.max(-1.2, Math.min(0.5, this.userPitchOffset + delta));
  }

  public override addDistanceInput(delta: number): void {
    this.userDistanceOffset = Math.max(-3, Math.min(30, this.userDistanceOffset + delta));
  }

  public override setOrbiting(active: boolean): void {
    this.orbiting = active;
  }

  public update(_deltaTime: number): void {
    if (!this.isActive || !this.target || !this.target.isModelReady()) {
      return;
    }

    const boundingSphere = this.target.getBoundingSphere();
    if (!boundingSphere) return;

    const state = this.target.getState();
    const center = boundingSphere.center;

    // Auto-recenter yaw when not orbiting
    if (!this.orbiting && Math.abs(this.userYawOffset) > 0.001) {
      this.userYawOffset *= 0.93;
      if (Math.abs(this.userYawOffset) < 0.005) {
        this.userYawOffset = 0;
      }
    }

    // Target heading: behind vehicle + user yaw offset
    this.targetCameraHeading = state.heading + Math.PI + this.userYawOffset;
    this.targetCameraPitch = Cesium.Math.toRadians(-10.0) + this.userPitchOffset;

    // Smooth interpolation
    this.currentCameraHeading = this.lerpAngle(this.currentCameraHeading, this.targetCameraHeading, this.cameraLerpFactor);
    this.currentCameraPitch = Cesium.Math.lerp(this.currentCameraPitch, this.targetCameraPitch, this.cameraLerpFactor);

    // Apply camera
    this.hpRange.heading = this.currentCameraHeading;
    this.hpRange.pitch = this.currentCameraPitch;
    this.hpRange.range = this.baseDistance + this.userDistanceOffset;

    this.cesiumCamera.lookAt(center, this.hpRange);
    this.cesiumCamera.lookAtTransform(Cesium.Matrix4.IDENTITY);

  }

  private lerpAngle(start: number, end: number, factor: number): number {
    start = Cesium.Math.zeroToTwoPi(start);
    end = Cesium.Math.zeroToTwoPi(end);

    let delta = end - start;

    if (delta > Math.PI) {
      delta -= Cesium.Math.TWO_PI;
    } else if (delta < -Math.PI) {
      delta += Cesium.Math.TWO_PI;
    }

    return Cesium.Math.zeroToTwoPi(start + delta * factor);
  }
}
