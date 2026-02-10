import * as Cesium from 'cesium';

export interface DynamicObstacle {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
  kind: string;
  speedMps: number;
}

interface TrafficAgent {
  id: string;
  kind: string;
  route: Array<[number, number]>;
  speedMps: number;
  radiusM: number;
  distanceM: number;
  progressM: number;
  entity: Cesium.Entity | null;
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const lat1 = a[0] * toRad;
  const lat2 = b[0] * toRad;
  const dLat = (b[0] - a[0]) * toRad;
  const dLon = (b[1] - a[1]) * toRad;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function routeLength(route: Array<[number, number]>): number {
  let total = 0;
  for (let i = 0; i < route.length - 1; i += 1) {
    total += distanceMeters(route[i], route[i + 1]);
  }
  return Math.max(1, total);
}

function interpolateRoute(route: Array<[number, number]>, distanceM: number): [number, number] {
  if (route.length === 0) return [0, 0];
  if (route.length === 1) return route[0];
  let remaining = Math.max(0, distanceM);
  for (let i = 0; i < route.length - 1; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    const segment = distanceMeters(a, b);
    if (remaining <= segment) {
      const t = segment <= 1e-6 ? 0 : remaining / segment;
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ];
    }
    remaining -= segment;
  }
  return route[route.length - 1];
}

export class TrafficManager {
  private readonly viewer: Cesium.Viewer;
  private readonly agents: TrafficAgent[] = [];
  private enabled = true;

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    this.bootstrapAgents();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = Boolean(enabled);
    for (const agent of this.agents) {
      if (agent.entity) {
        agent.entity.show = this.enabled;
      }
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public update(deltaTimeS: number): void {
    if (!this.enabled) return;
    for (const agent of this.agents) {
      agent.progressM = (agent.progressM + agent.speedMps * Math.max(0, deltaTimeS)) % agent.distanceM;
      const [lat, lon] = interpolateRoute(agent.route, agent.progressM);
      if (agent.entity) {
        const nextPosition = Cesium.Cartesian3.fromDegrees(lon, lat, 2.2);
        const current = agent.entity.position;
        if (current instanceof Cesium.ConstantPositionProperty) {
          current.setValue(nextPosition);
        } else {
          agent.entity.position = new Cesium.ConstantPositionProperty(nextPosition);
        }
      }
    }
  }

  public getObstacleSnapshot(): DynamicObstacle[] {
    if (!this.enabled) return [];
    const out: DynamicObstacle[] = [];
    for (const agent of this.agents) {
      const [lat, lon] = interpolateRoute(agent.route, agent.progressM);
      out.push({
        id: agent.id,
        lat,
        lon,
        radiusM: agent.radiusM,
        kind: agent.kind,
        speedMps: agent.speedMps,
      });
    }
    return out;
  }

  public destroy(): void {
    for (const agent of this.agents) {
      if (agent.entity) {
        this.viewer.entities.remove(agent.entity);
      }
      agent.entity = null;
    }
    this.agents.length = 0;
  }

  private bootstrapAgents(): void {
    const southToNorth: Array<[number, number]> = [
      [-33.8589867, 151.2136910],
      [-33.85855, 151.21392],
      [-33.85810, 151.21440],
      [-33.85775, 151.21478],
      [-33.85730, 151.21508],
      [-33.8567844, 151.2152967],
    ];
    const northToSouth: Array<[number, number]> = [...southToNorth].reverse();
    const southToNorthOuter: Array<[number, number]> = southToNorth.map(([lat, lon]) => [lat, lon + 0.00028]);
    const northToSouthOuter: Array<[number, number]> = [...southToNorthOuter].reverse();

    const specs = [
      { id: 'bridge-car-1', route: southToNorth, speedMps: 7.8, phase: 0.05 },
      { id: 'bridge-car-2', route: southToNorthOuter, speedMps: 8.6, phase: 0.55 },
      { id: 'bridge-car-3', route: northToSouth, speedMps: 7.2, phase: 0.2 },
      { id: 'bridge-car-4', route: northToSouthOuter, speedMps: 9.1, phase: 0.75 },
    ];

    for (const spec of specs) {
      const total = routeLength(spec.route);
      const progressM = total * spec.phase;
      const [lat, lon] = interpolateRoute(spec.route, progressM);
      const entity = this.viewer.entities.add({
        id: spec.id,
        position: new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(lon, lat, 2.2)),
        point: {
          pixelSize: 8,
          color: Cesium.Color.ORANGE.withAlpha(0.9),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
          outlineWidth: 1,
        },
      });
      this.agents.push({
        id: spec.id,
        kind: 'vehicle',
        route: spec.route,
        speedMps: spec.speedMps,
        radiusM: 1.8,
        distanceM: total,
        progressM,
        entity,
      });
    }
  }
}
