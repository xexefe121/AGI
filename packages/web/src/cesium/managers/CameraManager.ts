import * as Cesium from 'cesium';
import { Camera } from '../camera/Camera';
import { FollowCamera } from '../camera/FollowCamera';
import { FollowCloseCamera } from '../camera/FollowCloseCamera';
import { FreeRoamController } from '../camera/FreeRoamController';
import { Vehicle } from '../vehicles/Vehicle';
import { Updatable } from '../core/GameLoop';
import { InputManager } from '../input/InputManager';

export type CameraType = 'follow' | 'followClose' | 'free';

export class CameraManager implements Updatable {
  private cameras: Map<'follow' | 'followClose', Camera> = new Map();
  private activeCamera: Camera | null = null;
  private activeCameraType: CameraType = 'follow';
  private cesiumCamera: Cesium.Camera;
  private scene: Cesium.Scene | null;
  private inputManager: InputManager | null = null;
  private freeRoamController: FreeRoamController;

  constructor(cesiumCamera: Cesium.Camera, scene?: Cesium.Scene) {
    this.cesiumCamera = cesiumCamera;
    this.scene = scene || null;
    this.freeRoamController = new FreeRoamController(
      this.cesiumCamera,
      this.scene?.canvas ?? null
    );
    this.initializeCameras();
  }

  private initializeCameras(): void {
    const followCamera = new FollowCamera(this.cesiumCamera);
    const followCloseCamera = new FollowCloseCamera(this.cesiumCamera);

    this.cameras.set('follow', followCamera);
    this.cameras.set('followClose', followCloseCamera);

    this.setActiveCamera('follow');
  }

  public setActiveCamera(cameraType: CameraType): void {
    if (this.activeCamera) {
      this.activeCamera.deactivate();
    }

    if (cameraType === 'free') {
      this.activeCamera = null;
      this.activeCameraType = 'free';
      this.cesiumCamera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      this.setCesiumFreeControls(false);
      this.freeRoamController.enable();
      console.log('Switched to free camera');
      return;
    }

    this.freeRoamController.disable();
    this.setCesiumFreeControls(false);

    const newCamera = this.cameras.get(cameraType);
    if (!newCamera) return;
    this.activeCamera = newCamera;
    this.activeCameraType = cameraType;
    this.activeCamera.activate();
    console.log(`Switched to ${cameraType} camera`);
  }

  public getActiveCamera(): Camera | null {
    return this.activeCamera;
  }

  public getActiveCameraType(): CameraType {
    return this.activeCameraType;
  }

  public switchCamera(): void {
    const cameraTypes: CameraType[] = ['follow', 'followClose', 'free'];
    const currentIndex = cameraTypes.indexOf(this.activeCameraType);
    const nextIndex = (currentIndex + 1) % cameraTypes.length;
    this.setActiveCamera(cameraTypes[nextIndex]);
  }

  public setTarget(vehicle: Vehicle | null): void {
    for (const camera of this.cameras.values()) {
      camera.setTarget(vehicle);
    }
  }

  public update(deltaTime: number): void {
    if (this.activeCameraType === 'free' && this.inputManager) {
      this.freeRoamController.update(deltaTime, this.inputManager.getInputState());
      return;
    }

    if (this.activeCamera && this.inputManager) {
      const input = this.inputManager.getInputState();

      // WASD orbit: A/D for yaw, W/S for pitch
      const yawSpeed = 2.0;
      const pitchSpeed = 1.0;
      let isOrbiting = false;

      if (input.turnLeft) {
        this.activeCamera.addYawInput(-yawSpeed * deltaTime);
        isOrbiting = true;
      }
      if (input.turnRight) {
        this.activeCamera.addYawInput(yawSpeed * deltaTime);
        isOrbiting = true;
      }
      if (input.throttle) {
        this.activeCamera.addPitchInput(-pitchSpeed * deltaTime);
      }
      if (input.brake) {
        this.activeCamera.addPitchInput(pitchSpeed * deltaTime);
      }

      if (!isOrbiting) {
        this.activeCamera.setOrbiting(false);
      }
    }

    if (this.activeCamera) {
      this.activeCamera.update(deltaTime);
    }
  }

  public getFollowCamera(): FollowCamera | null {
    return this.cameras.get('follow') as FollowCamera || null;
  }

  public getFollowCloseCamera(): FollowCloseCamera | null {
    return this.cameras.get('followClose') as FollowCloseCamera || null;
  }

  public setupInputHandling(inputManager: InputManager): void {
    this.inputManager = inputManager;
    inputManager.onInput('switchCamera', (pressed) => {
      if (pressed) this.switchCamera();
    });

    // Mouse wheel for zoom
    const canvas = this.scene?.canvas;
    if (canvas) {
      canvas.addEventListener('wheel', (e: WheelEvent) => {
        e.preventDefault();
        if (this.activeCamera) {
          this.activeCamera.addDistanceInput(e.deltaY * 0.02);
        }
      }, { passive: false });
    }
  }

  private setCesiumFreeControls(enabled: boolean): void {
    if (!this.scene) return;
    const controller = this.scene.screenSpaceCameraController;
    controller.enableRotate = enabled;
    controller.enableZoom = enabled;
    controller.enableLook = enabled;
    controller.enableTilt = enabled;
    controller.enableTranslate = enabled;
  }

  public destroy(): void {
    this.freeRoamController.disable();
    if (this.activeCamera) {
      this.activeCamera.deactivate();
    }
    this.cameras.clear();
    this.activeCamera = null;
  }
}
