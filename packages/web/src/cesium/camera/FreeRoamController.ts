import * as Cesium from 'cesium';
import type { InputState } from '../input/InputManager';

export class FreeRoamController {
  private readonly camera: Cesium.Camera;
  private readonly canvas: HTMLCanvasElement | null;
  private enabled = false;
  private rotateActive = false;
  private yawDelta = 0;
  private pitchDelta = 0;
  private readonly lookSensitivity = 0.0024;
  private readonly baseMoveSpeed = 55;
  private onMouseDown?: (event: MouseEvent) => void;
  private onMouseUp?: (event: MouseEvent) => void;
  private onMouseMove?: (event: MouseEvent) => void;
  private onPointerLockChange?: () => void;

  constructor(camera: Cesium.Camera, canvas: HTMLCanvasElement | null) {
    this.camera = camera;
    this.canvas = canvas;
  }

  public enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.attachListeners();
  }

  public disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.rotateActive = false;
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.detachListeners();
    if (document.pointerLockElement === this.canvas) {
      void document.exitPointerLock();
    }
  }

  public update(deltaTime: number, input: Readonly<InputState>): void {
    if (!this.enabled) return;

    if (Math.abs(this.yawDelta) > 1e-6 || Math.abs(this.pitchDelta) > 1e-6) {
      const yaw = -this.yawDelta * this.lookSensitivity;
      const pitch = -this.pitchDelta * this.lookSensitivity;
      this.camera.rotateRight(yaw);
      this.camera.rotateUp(pitch);
      this.yawDelta = 0;
      this.pitchDelta = 0;
    }

    const shiftHeld = input.fastMove;
    const ctrlHeld = input.slowMove;
    let moveSpeed = this.baseMoveSpeed;
    if (shiftHeld) moveSpeed *= 3.0;
    if (ctrlHeld) moveSpeed *= 0.25;
    const step = moveSpeed * deltaTime;

    if (input.throttle) {
      this.camera.moveForward(step);
    }
    if (input.brake) {
      this.camera.moveBackward(step);
    }
    if (input.turnLeft) {
      this.camera.moveLeft(step);
    }
    if (input.turnRight) {
      this.camera.moveRight(step);
    }
    if (input.rollLeft) {
      this.camera.moveDown(step);
    }
    if (input.rollRight) {
      this.camera.moveUp(step);
    }
  }

  private attachListeners(): void {
    const canvas = this.canvas;
    if (!canvas) return;

    this.onMouseDown = (event: MouseEvent) => {
      if (!this.enabled) return;
      if (event.button !== 2) return;
      event.preventDefault();
      this.rotateActive = true;
      if (document.pointerLockElement !== canvas) {
        void canvas.requestPointerLock();
      }
    };
    this.onMouseUp = (event: MouseEvent) => {
      if (!this.enabled) return;
      if (event.button !== 2) return;
      event.preventDefault();
      this.rotateActive = false;
      if (document.pointerLockElement === canvas) {
        void document.exitPointerLock();
      }
    };
    this.onMouseMove = (event: MouseEvent) => {
      if (!this.enabled || !this.rotateActive) return;
      if (document.pointerLockElement !== canvas) return;
      this.yawDelta += event.movementX;
      this.pitchDelta += event.movementY;
    };
    this.onPointerLockChange = () => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas) {
        this.rotateActive = false;
      }
    };

    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  private detachListeners(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    if (this.onMouseDown) canvas.removeEventListener('mousedown', this.onMouseDown);
    if (this.onMouseUp) window.removeEventListener('mouseup', this.onMouseUp);
    if (this.onMouseMove) window.removeEventListener('mousemove', this.onMouseMove);
    if (this.onPointerLockChange) document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.onMouseDown = undefined;
    this.onMouseUp = undefined;
    this.onMouseMove = undefined;
    this.onPointerLockChange = undefined;
  }
}
