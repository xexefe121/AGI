import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import Map, {
  Layer,
  Marker,
  NavigationControl,
  Source,
  type MapRef,
} from 'react-map-gl/mapbox';
import type { FeatureCollection, LineString } from 'geojson';
import { useVehiclePosition } from '../hooks/useVehiclePosition';
import { useGameEvent } from '../../../hooks/useGameEvent';
import { useGameMethod } from '../../../hooks/useGameMethod';
import { getTokens } from '../../../../utils/tokenValidator';
import type { RoutePlanData } from '../../../../cesium/managers/VehicleManager';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = getTokens().mapbox;
const EPSILON = 1e-7;

interface SearchResult {
  id: string;
  place_name: string;
  center: [number, number];
}

type LonLat = [number, number];
type TurnKind = 'straight' | 'slight_left' | 'left' | 'sharp_left' | 'slight_right' | 'right' | 'sharp_right' | 'uturn';

interface NextDirection {
  kind: TurnKind;
  instruction: string;
  distanceM: number;
}

interface SnappedRoute {
  coordinates: LonLat[];
  steps: Array<{ instruction: string; index: number }>;
}

function toLonLatPair(value: unknown): LonLat | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const lat = Number(value[0]);
  const lon = Number(value[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lon, lat];
}

function toRouteLonLat(route: RoutePlanData | null | undefined): LonLat[] {
  if (!route) return [];
  const out: LonLat[] = [];
  if (Array.isArray(route.waypoints)) {
    for (const waypoint of route.waypoints) {
      const lonLat = toLonLatPair(waypoint);
      if (!lonLat) continue;
      out.push(lonLat);
    }
  }
  if (out.length === 0) {
    const start = toLonLatPair(route.start);
    const goal = toLonLatPair(route.goal);
    if (start) out.push(start);
    if (goal && !pointsEqual(out[out.length - 1], goal)) {
      out.push(goal);
    }
  }
  return out;
}

function pointsEqual(a: LonLat | undefined, b: LonLat): boolean {
  if (!a) return false;
  return Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON;
}

function lineCollection(coords: LonLat[]): FeatureCollection<LineString> {
  if (coords.length < 2) {
    return {
      type: 'FeatureCollection',
      features: [],
    };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: coords,
        },
      },
    ],
  };
}

function distanceMeters(a: LonLat, b: LonLat): number {
  const toRad = Math.PI / 180;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearingDegrees(a: LonLat, b: LonLat): number {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * toDeg) + 360) % 360;
}

function normalizeTurnDelta(deltaDeg: number): number {
  let v = deltaDeg;
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  return v;
}

function classifyTurn(deltaDeg: number): { kind: TurnKind; label: string } {
  const absDelta = Math.abs(deltaDeg);
  if (absDelta < 18) return { kind: 'straight', label: 'Continue straight' };
  if (absDelta >= 160) return { kind: 'uturn', label: 'Make a U-turn' };
  if (deltaDeg > 0) {
    if (absDelta < 42) return { kind: 'slight_right', label: 'Slight right' };
    if (absDelta < 115) return { kind: 'right', label: 'Turn right' };
    return { kind: 'sharp_right', label: 'Sharp right' };
  }
  if (absDelta < 42) return { kind: 'slight_left', label: 'Slight left' };
  if (absDelta < 115) return { kind: 'left', label: 'Turn left' };
  return { kind: 'sharp_left', label: 'Sharp left' };
}

function formatDistance(distanceM: number): string {
  if (!Number.isFinite(distanceM) || distanceM < 0) return '--';
  if (distanceM < 1000) return `${Math.max(1, Math.round(distanceM))} m`;
  return `${(distanceM / 1000).toFixed(distanceM >= 5000 ? 0 : 1)} km`;
}

function formatEtaMinutes(distanceM: number): string {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return '--';
  // Human walking pace baseline so the card feels like mobile navigation.
  const walkingMps = 1.35;
  const minutes = Math.max(1, Math.round(distanceM / walkingMps / 60));
  return `${minutes} min`;
}

function turnIcon(kind: TurnKind): string {
  switch (kind) {
    case 'left':
    case 'slight_left':
    case 'sharp_left':
      return 'M18 6h-6a6 6 0 0 0-6 6v2H3l4 4 4-4H8v-2a4 4 0 0 1 4-4h6V6z';
    case 'right':
    case 'slight_right':
    case 'sharp_right':
      return 'M6 6h6a6 6 0 0 1 6 6v2h3l-4 4-4-4h3v-2a4 4 0 0 0-4-4H6V6z';
    case 'uturn':
      return 'M6 8h8a5 5 0 0 1 0 10H9l3 3 3-3h-1a3 3 0 0 0 0-6H6V8z';
    default:
      return 'M12 4l4 5h-3v11h-2V9H8l4-5z';
  }
}

function nearestRouteIndex(coords: LonLat[], target: LonLat): number {
  if (coords.length === 0) return 0;
  const cosLat = Math.max(0.2, Math.cos((target[1] * Math.PI) / 180));
  let nearestIndex = 0;
  let nearestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < coords.length; i += 1) {
    const dLon = (coords[i][0] - target[0]) * cosLat;
    const dLat = coords[i][1] - target[1];
    const score = dLon * dLon + dLat * dLat;
    if (score < nearestScore) {
      nearestScore = score;
      nearestIndex = i;
    }
  }
  return nearestIndex;
}

function turnKindFromInstruction(instruction: string): TurnKind {
  const text = instruction.toLowerCase();
  if (text.includes('u-turn') || text.includes('uturn')) return 'uturn';
  if (text.includes('sharp right')) return 'sharp_right';
  if (text.includes('sharp left')) return 'sharp_left';
  if (text.includes('slight right') || text.includes('keep right') || text.includes('bear right')) return 'slight_right';
  if (text.includes('slight left') || text.includes('keep left') || text.includes('bear left')) return 'slight_left';
  if (text.includes('right')) return 'right';
  if (text.includes('left')) return 'left';
  return 'straight';
}

async function snapToMapboxRoads(coords: LonLat[]): Promise<SnappedRoute> {
  if (!MAPBOX_TOKEN || coords.length < 3) {
    return { coordinates: coords, steps: [] };
  }
  const maxCoords = 25;
  const reduced: LonLat[] = [coords[0]];
  const stride = Math.max(1, Math.ceil((coords.length - 2) / (maxCoords - 2)));
  for (let i = 1; i < coords.length - 1; i += stride) {
    reduced.push(coords[i]);
  }
  const last = coords[coords.length - 1];
  if (!pointsEqual(reduced[reduced.length - 1], last)) {
    reduced.push(last);
  }
  const coordStr = reduced.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/walking/${coordStr}` +
    `?geometries=geojson&overview=full&steps=true&access_token=${MAPBOX_TOKEN}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (import.meta.env.DEV) {
        console.warn('[MiniMap] Mapbox route snap failed:', response.status, response.statusText);
      }
      return { coordinates: coords, steps: [] };
    }
    const data = await response.json() as {
      routes?: Array<{
        geometry?: { coordinates?: unknown };
        legs?: Array<{
          steps?: Array<{
            maneuver?: {
              instruction?: unknown;
              location?: unknown;
            };
          }>;
        }>;
      }>;
    };
    const route = data.routes?.[0];
    const rawCoordinates = route?.geometry?.coordinates;
    if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2) {
      return { coordinates: coords, steps: [] };
    }
    const snapped: LonLat[] = [];
    for (const point of rawCoordinates) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const lon = Number(point[0]);
      const lat = Number(point[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      snapped.push([lon, lat]);
    }
    const snappedCoords = snapped.length >= 2 ? snapped : coords;
    const steps: Array<{ instruction: string; index: number }> = [];
    for (const leg of route?.legs ?? []) {
      for (const step of leg.steps ?? []) {
        const instruction = String(step.maneuver?.instruction ?? '').trim();
        const location = step.maneuver?.location;
        if (!instruction || !Array.isArray(location) || location.length < 2) continue;
        const lon = Number(location[0]);
        const lat = Number(location[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        steps.push({
          instruction,
          index: nearestRouteIndex(snappedCoords, [lon, lat]),
        });
      }
    }
    return { coordinates: snappedCoords, steps };
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[MiniMap] Mapbox snap failed:', error);
    }
    return { coordinates: coords, steps: [] };
  }
}

export function MiniMap() {
  if (!MAPBOX_TOKEN) {
    return null;
  }

  const [isVisible, setIsVisible] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isNorthUp, setIsNorthUp] = useState(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [rawRouteLonLat, setRawRouteLonLat] = useState<LonLat[]>([]);
  const [routeLonLat, setRouteLonLat] = useState<LonLat[]>([]);
  const [routeSteps, setRouteSteps] = useState<Array<{ instruction: string; index: number }>>([]);
  const [progressIndex, setProgressIndex] = useState(0);
  const [targetRouteIndex, setTargetRouteIndex] = useState<number | null>(null);
  const position = useVehiclePosition();
  const { teleportTo, getAutonavConfig, getCurrentRoute } = useGameMethod();
  const routeChanged = useGameEvent('routeChanged');
  const autonavConfigLoaded = useGameEvent('autonavConfigLoaded');
  const navigationContextChanged = useGameEvent('navigationContextChanged');
  const mapRef = useRef<MapRef>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const routeUpdateSeqRef = useRef(0);
  const progressIndexRef = useRef(-1);

  const handleToggleVisibility = useCallback(() => {
    setIsVisible((prev) => !prev);
  }, []);

  const handleToggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
    window.setTimeout(() => {
      mapRef.current?.resize();
    }, 320);
  }, []);

  const handleToggleNorthUp = useCallback(() => {
    setIsNorthUp((prev) => !prev);
  }, []);

  const handleToggleSearch = useCallback(() => {
    setIsSearchOpen((prev) => !prev);
    if (!isSearchOpen) {
      window.setTimeout(() => searchInputRef.current?.focus(), 100);
    } else {
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [isSearchOpen]);

  const setRoute = useCallback((route: RoutePlanData | null | undefined) => {
    const next = toRouteLonLat(route);
    if (import.meta.env.DEV) {
      console.log('[MiniMap] route update received', { points: next.length });
    }
    routeUpdateSeqRef.current += 1;
    const updateSeq = routeUpdateSeqRef.current;
    setRawRouteLonLat(next);
    setRouteLonLat(next);
    setRouteSteps([]);
    setProgressIndex(0);
    setTargetRouteIndex(null);
    if (next.length < 3) return;
    void (async () => {
      const snapped = await snapToMapboxRoads(next);
      if (routeUpdateSeqRef.current !== updateSeq) return;
      const resolvedCoords = snapped.coordinates.length >= 2 ? snapped.coordinates : next;
      if (import.meta.env.DEV) {
        console.log('[MiniMap] snapToMapboxRoads result', {
          points: resolvedCoords.length,
          steps: snapped.steps.length,
        });
      }
      setRouteLonLat(resolvedCoords);
      setRouteSteps(snapped.steps);
    })();
  }, []);

  useEffect(() => {
    const initialRoute = getCurrentRoute();
    if (initialRoute) {
      setRoute(initialRoute);
    }
    let active = true;
    void getAutonavConfig().then((config) => {
      if (!active || !config?.waypoints) return;
      setRoute({
        start: config.start ?? [0, 0],
        goal: config.goal ?? [0, 0],
        waypoints: config.waypoints,
        notes: config.notes ?? '',
      });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (routeChanged) {
      if (import.meta.env.DEV) {
        console.log('[MiniMap] routeChanged event received', {
          waypoints: routeChanged.waypoints?.length ?? 0,
        });
      }
      setRoute(routeChanged);
    }
  }, [routeChanged, setRoute]);

  useEffect(() => {
    const config = autonavConfigLoaded?.config;
    if (!config || !Array.isArray(config.waypoints)) return;
    if (routeLonLat.length >= 2 || rawRouteLonLat.length >= 2) return;
    if (import.meta.env.DEV) {
      console.log('[MiniMap] using late autonavConfigLoaded route data', {
        waypoints: config.waypoints.length,
      });
    }
    setRoute({
      start: config.start ?? [0, 0],
      goal: config.goal ?? [0, 0],
      waypoints: config.waypoints,
      notes: config.notes ?? '',
    });
  }, [autonavConfigLoaded, routeLonLat.length, rawRouteLonLat.length, setRoute]);

  const fetchSearchResults = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=5`
      );
      const data = await response.json();
      setSearchResults(data.features || []);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setSearchQuery(query);

      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = window.setTimeout(() => {
        void fetchSearchResults(query);
      }, 300);
    },
    [fetchSearchResults]
  );

  const handleSelectLocation = useCallback(
    (result: SearchResult) => {
      const [longitude, latitude] = result.center;
      teleportTo(longitude, latitude, 500, 0);
      setSearchQuery('');
      setSearchResults([]);
      setIsSearchOpen(false);
    },
    [teleportTo]
  );

  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (searchResults.length > 0) {
        handleSelectLocation(searchResults[0]);
      }
    },
    [searchResults, handleSelectLocation]
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const effectiveRouteLonLat = routeLonLat.length > 0 ? routeLonLat : rawRouteLonLat;

  useEffect(() => {
    if (effectiveRouteLonLat.length < 2) {
      setProgressIndex(0);
      return;
    }
    const lon = position.longitude;
    const lat = position.latitude;
    const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    let nearestIndex = 0;
    let nearestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < effectiveRouteLonLat.length; i += 1) {
      const routeLon = effectiveRouteLonLat[i][0];
      const routeLat = effectiveRouteLonLat[i][1];
      const dLon = (routeLon - lon) * cosLat;
      const dLat = routeLat - lat;
      const score = dLon * dLon + dLat * dLat;
      if (score < nearestScore) {
        nearestScore = score;
        nearestIndex = i;
      }
    }
    if (progressIndexRef.current !== nearestIndex) {
      progressIndexRef.current = nearestIndex;
      if (import.meta.env.DEV) {
        console.log('[MiniMap] progressIndex updated', nearestIndex);
      }
    }
    setProgressIndex(nearestIndex);
  }, [position.latitude, position.longitude, effectiveRouteLonLat]);

  useEffect(() => {
    if (effectiveRouteLonLat.length < 2) {
      setTargetRouteIndex(null);
      return;
    }
    const currentWaypoint = navigationContextChanged?.currentWaypoint;
    if (!Array.isArray(currentWaypoint) || currentWaypoint.length !== 2) {
      setTargetRouteIndex(null);
      return;
    }
    const lat = Number(currentWaypoint[0]);
    const lon = Number(currentWaypoint[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setTargetRouteIndex(null);
      return;
    }
    const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    let nearestIndex = 0;
    let nearestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < effectiveRouteLonLat.length; i += 1) {
      const routeLon = effectiveRouteLonLat[i][0];
      const routeLat = effectiveRouteLonLat[i][1];
      const dLon = (routeLon - lon) * cosLat;
      const dLat = routeLat - lat;
      const score = dLon * dLon + dLat * dLat;
      if (score < nearestScore) {
        nearestScore = score;
        nearestIndex = i;
      }
    }
    setTargetRouteIndex(nearestIndex);
  }, [navigationContextChanged, effectiveRouteLonLat]);

  const currentPoint = useMemo<LonLat>(() => [position.longitude, position.latitude], [position]);

  const traveledCoords = useMemo(() => {
    if (effectiveRouteLonLat.length < 2) return [] as LonLat[];
    const cappedIndex = Math.max(0, Math.min(progressIndex, effectiveRouteLonLat.length - 1));
    const coords = effectiveRouteLonLat.slice(0, cappedIndex + 1);
    if (!pointsEqual(coords[coords.length - 1], currentPoint)) {
      coords.push(currentPoint);
    }
    return coords;
  }, [currentPoint, progressIndex, effectiveRouteLonLat]);

  const remainingCoords = useMemo(() => {
    if (effectiveRouteLonLat.length < 2) return [] as LonLat[];
    const cappedIndex = Math.max(0, Math.min(progressIndex, effectiveRouteLonLat.length - 1));
    const coords = effectiveRouteLonLat.slice(cappedIndex);
    if (!pointsEqual(coords[0], currentPoint)) {
      coords.unshift(currentPoint);
    }
    return coords;
  }, [currentPoint, progressIndex, effectiveRouteLonLat]);

  const traveledGeoJson = useMemo(() => lineCollection(traveledCoords), [traveledCoords]);
  const remainingGeoJson = useMemo(() => lineCollection(remainingCoords), [remainingCoords]);

  const mapBearing = isNorthUp ? 0 : -position.heading;
  const hasMapboxToken = Boolean(MAPBOX_TOKEN);
  const size = isExpanded
    ? 'w-[280px] h-[280px] md:w-[500px] md:h-[500px]'
    : 'w-[160px] h-[160px] md:w-[280px] md:h-[280px]';
  const waypointTotal = effectiveRouteLonLat.length;
  const startPoint = waypointTotal > 0 ? effectiveRouteLonLat[0] : null;
  const goalPoint = waypointTotal > 0 ? effectiveRouteLonLat[waypointTotal - 1] : null;
  const waypointMarkerIndexes = useMemo(() => {
    if (effectiveRouteLonLat.length <= 2) return [] as number[];
    const indexes: number[] = [];
    const interiorCount = effectiveRouteLonLat.length - 2;
    const stride = Math.max(1, Math.floor(interiorCount / 20));
    for (let idx = 1; idx < effectiveRouteLonLat.length - 1; idx += stride) {
      indexes.push(idx);
    }
    const lastInterior = effectiveRouteLonLat.length - 2;
    if (indexes[indexes.length - 1] !== lastInterior) {
      indexes.push(lastInterior);
    }
    return indexes;
  }, [effectiveRouteLonLat]);
  const activeTargetIndex = useMemo(() => {
    if (effectiveRouteLonLat.length === 0) return -1;
    if (targetRouteIndex !== null) {
      return Math.max(0, Math.min(targetRouteIndex, effectiveRouteLonLat.length - 1));
    }
    return Math.max(0, Math.min(progressIndex + 1, effectiveRouteLonLat.length - 1));
  }, [effectiveRouteLonLat.length, targetRouteIndex, progressIndex]);
  const remainingDistanceM = useMemo(() => {
    if (effectiveRouteLonLat.length < 2) return 0;
    const currentIdx = Math.max(0, Math.min(progressIndex, effectiveRouteLonLat.length - 1));
    let total = distanceMeters(currentPoint, effectiveRouteLonLat[currentIdx]);
    for (let i = currentIdx; i < effectiveRouteLonLat.length - 1; i += 1) {
      total += distanceMeters(effectiveRouteLonLat[i], effectiveRouteLonLat[i + 1]);
    }
    return total;
  }, [effectiveRouteLonLat, progressIndex, currentPoint]);
  const nextDirection = useMemo<NextDirection | null>(() => {
    if (effectiveRouteLonLat.length < 2) return null;
    const currentIdx = Math.max(0, Math.min(progressIndex, effectiveRouteLonLat.length - 1));
    const distanceToIndex = (targetIdx: number): number => {
      if (targetIdx <= currentIdx) return 0;
      let total = distanceMeters(currentPoint, effectiveRouteLonLat[currentIdx]);
      for (let i = currentIdx; i < targetIdx; i += 1) {
        total += distanceMeters(effectiveRouteLonLat[i], effectiveRouteLonLat[i + 1]);
      }
      return total;
    };

    for (const step of routeSteps) {
      if (step.index <= currentIdx) continue;
      return {
        kind: turnKindFromInstruction(step.instruction),
        instruction: step.instruction,
        distanceM: distanceToIndex(step.index),
      };
    }

    for (let i = Math.max(1, currentIdx + 1); i < effectiveRouteLonLat.length - 1; i += 1) {
      const incoming = bearingDegrees(effectiveRouteLonLat[i - 1], effectiveRouteLonLat[i]);
      const outgoing = bearingDegrees(effectiveRouteLonLat[i], effectiveRouteLonLat[i + 1]);
      const delta = normalizeTurnDelta(outgoing - incoming);
      const turn = classifyTurn(delta);
      if (turn.kind === 'straight') continue;
      return {
        kind: turn.kind,
        instruction: turn.label,
        distanceM: distanceToIndex(i),
      };
    }

    let finalDistance = distanceMeters(currentPoint, effectiveRouteLonLat[currentIdx]);
    for (let i = currentIdx; i < effectiveRouteLonLat.length - 1; i += 1) {
      finalDistance += distanceMeters(effectiveRouteLonLat[i], effectiveRouteLonLat[i + 1]);
    }
    return {
      kind: 'straight',
      instruction: 'Continue to destination',
      distanceM: finalDistance,
    };
  }, [effectiveRouteLonLat, progressIndex, currentPoint, routeSteps]);

  if (!hasMapboxToken) {
    if (!isVisible) {
      return (
        <button
          onClick={handleToggleVisibility}
          className="fixed bottom-6 right-6 z-[35] w-12 h-12 flex items-center justify-center glass-panel hover:bg-white/10 transition-all duration-300 text-white/70 hover:text-white group"
          title="Show Navigation Card"
        >
          <svg className="group-hover:scale-110 transition-transform" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6.5L9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5z" />
            <path d="M9 4v13.5M15 6.5V20" />
          </svg>
        </button>
      );
    }
    return (
      <div className="fixed bottom-6 right-6 z-[35] w-[280px] glass-panel p-3 text-xs text-white/75">
        <div className="font-semibold text-white mb-1">Navigation</div>
        <div className="mb-2">Mapbox token missing. Live map is disabled.</div>
        <div>Position: {position.latitude.toFixed(4)}, {position.longitude.toFixed(4)}</div>
        <div>Remaining: {formatDistance(remainingDistanceM)} | ETA {formatEtaMinutes(remainingDistanceM)}</div>
        <button
          onClick={handleToggleVisibility}
          className="mt-2 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/80"
        >
          Hide
        </button>
      </div>
    );
  }

  return (
    <>
      {!isVisible && (
        <button
          onClick={handleToggleVisibility}
          className="fixed bottom-6 right-6 z-[35] w-12 h-12 flex items-center justify-center glass-panel hover:bg-white/10 transition-all duration-300 text-white/70 hover:text-white group"
          title="Show Map"
        >
          <svg className="group-hover:scale-110 transition-transform" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6.5L9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5z" />
            <path d="M9 4v13.5M15 6.5V20" />
          </svg>
        </button>
      )}

      {isVisible && (
        <div className={`fixed bottom-6 right-6 z-[35] ${size} transition-all duration-300`}>
          <div className="relative w-full h-full glass-panel overflow-hidden rounded-lg shadow-2xl">
            <div className="absolute top-0 left-0 right-0 z-20 bg-black/50 backdrop-blur-md border-b border-white/10">
              <div className="relative flex items-center justify-between h-10 px-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleToggleSearch}
                    disabled={!hasMapboxToken}
                    className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-md transition-all duration-200 text-white/70 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent"
                    title={hasMapboxToken ? 'Search location' : 'Mapbox token missing'}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.35-4.35" />
                    </svg>
                  </button>

                  {!isSearchOpen && (
                    <div className="text-[10px] text-white/50 font-mono">
                      {position.latitude.toFixed(4)} deg, {position.longitude.toFixed(4)} deg
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleToggleExpanded}
                    className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-md transition-all duration-200 text-white/70 hover:text-white"
                    title={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {isExpanded ? (
                        <path d="M4 14h6m0 0v6m0-6l-7 7M20 10h-6m0 0V4m0 6l7-7" />
                      ) : (
                        <path d="M15 3h6m0 0v6m0-6l-7 7M9 21H3m0 0v-6m0 6l7-7" />
                      )}
                    </svg>
                  </button>
                </div>

                <div
                  className={`absolute left-0 right-0 top-0 h-10 bg-black/70 backdrop-blur-md border-b border-white/10 transition-all duration-300 ease-out ${
                    isSearchOpen && hasMapboxToken ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full pointer-events-none'
                  }`}
                  style={{ zIndex: 30 }}
                >
                  <form onSubmit={handleSearchSubmit} className="h-full px-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleSearch}
                      className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-md transition-colors text-white/70 hover:text-white flex-shrink-0"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M5 12l7 7M5 12l7-7" />
                      </svg>
                    </button>
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={handleSearchChange}
                      onKeyDown={(e) => e.stopPropagation()}
                      onKeyUp={(e) => e.stopPropagation()}
                      onKeyPress={(e) => e.stopPropagation()}
                      placeholder="Search location..."
                      className="flex-1 h-7 px-3 bg-white/5 border border-white/10 rounded-md text-white/90 text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all duration-200"
                    />
                  </form>
                </div>
              </div>

              {isSearchOpen && hasMapboxToken && searchResults.length > 0 && (
                <div className="absolute top-10 left-0 right-0 bg-black/90 backdrop-blur-md border-b border-white/10 max-h-60 overflow-y-auto z-20">
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      onClick={() => handleSelectLocation(result)}
                      className="w-full px-3 py-2 text-left hover:bg-white/10 transition-colors border-b border-white/5 last:border-b-0"
                    >
                      <div className="text-sm text-white/90">{result.place_name}</div>
                    </button>
                  ))}
                </div>
              )}

              {isSearchOpen && hasMapboxToken && isSearching && (
                <div className="absolute top-10 left-0 right-0 bg-black/90 backdrop-blur-md border-b border-white/10 px-3 py-2 z-20">
                  <div className="text-xs text-white/50">Searching...</div>
                </div>
              )}
            </div>

            {!isSearchOpen && nextDirection && (
              <div className="absolute top-12 left-2 right-2 z-20 rounded-md bg-[#1a73e8]/92 text-white shadow-lg border border-white/20 backdrop-blur-sm">
                <div className="px-2 py-2 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-md bg-black/20 flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d={turnIcon(nextDirection.kind)} />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-blue-100/90">Next</div>
                    <div className="text-xs font-semibold leading-tight truncate">{nextDirection.instruction}</div>
                  </div>
                  <div className="text-xs font-mono text-blue-50">{formatDistance(nextDirection.distanceM)}</div>
                </div>
              </div>
            )}

            <Map
              ref={mapRef}
              mapboxAccessToken={MAPBOX_TOKEN}
              initialViewState={{
                longitude: position.longitude,
                latitude: position.latitude,
                zoom: isExpanded ? 14 : 13,
                bearing: mapBearing,
              }}
              {...(!isExpanded && {
                longitude: position.longitude,
                latitude: position.latitude,
                zoom: 13,
                bearing: mapBearing,
              })}
              style={{ width: '100%', height: '100%' }}
              mapStyle="mapbox://styles/mapbox/navigation-day-v1"
              attributionControl={false}
              dragPan={isExpanded}
              scrollZoom={isExpanded}
              doubleClickZoom={false}
              touchZoomRotate={isExpanded}
              interactive={isExpanded}
            >
              <Source id="route-remaining" type="geojson" data={remainingGeoJson}>
                <Layer
                  id="route-remaining-casing"
                  type="line"
                  layout={{
                    'line-cap': 'round',
                    'line-join': 'round',
                  }}
                  paint={{
                    'line-color': '#ffffff',
                    'line-width': 9,
                    'line-opacity': 0.95,
                  }}
                />
                <Layer
                  id="route-remaining-line"
                  type="line"
                  layout={{
                    'line-cap': 'round',
                    'line-join': 'round',
                  }}
                  paint={{
                    'line-color': '#4285f4',
                    'line-width': 6,
                    'line-opacity': 0.98,
                  }}
                />
                <Layer
                  id="route-remaining-arrows"
                  type="symbol"
                  layout={{
                    'symbol-placement': 'line',
                    'symbol-spacing': 44,
                    'text-field': '▶',
                    'text-size': 11,
                    'text-keep-upright': false,
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                  }}
                  paint={{
                    'text-color': '#ffffff',
                    'text-halo-color': '#4285f4',
                    'text-halo-width': 1.1,
                  }}
                />
              </Source>

              <Source id="route-traveled" type="geojson" data={traveledGeoJson}>
                <Layer
                  id="route-traveled-line"
                  type="line"
                  layout={{
                    'line-cap': 'round',
                    'line-join': 'round',
                  }}
                  paint={{
                    'line-color': '#7d8794',
                    'line-width': 5,
                    'line-opacity': 0.78,
                  }}
                />
              </Source>

              {waypointMarkerIndexes.map((index) => {
                const point = effectiveRouteLonLat[index];
                if (!point) return null;
                const visited = index <= progressIndex;
                return (
                  <Marker key={`route-waypoint-${index}`} longitude={point[0]} latitude={point[1]} anchor="center">
                    <div
                      className={`w-2.5 h-2.5 rounded-full border border-white/70 ${
                        visited ? 'bg-slate-400/70' : 'bg-sky-400/80'
                      }`}
                    />
                  </Marker>
                );
              })}

              {startPoint && (
                <Marker longitude={startPoint[0]} latitude={startPoint[1]} anchor="center">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/90 border border-white/80 text-[10px] text-white font-semibold flex items-center justify-center">
                    S
                  </div>
                </Marker>
              )}

              {goalPoint && (
                <Marker longitude={goalPoint[0]} latitude={goalPoint[1]} anchor="center">
                  <div className="w-5 h-5 rounded-full bg-rose-500/90 border border-white/80 text-[10px] text-white font-semibold flex items-center justify-center">
                    G
                  </div>
                </Marker>
              )}

              {activeTargetIndex >= 0 && activeTargetIndex < effectiveRouteLonLat.length && (
                <Marker
                  longitude={effectiveRouteLonLat[activeTargetIndex][0]}
                  latitude={effectiveRouteLonLat[activeTargetIndex][1]}
                  anchor="center"
                >
                  <div className="w-4 h-4 rounded-full bg-amber-400 border-2 border-white animate-pulse shadow-[0_0_10px_rgba(251,191,36,0.6)]" />
                </Marker>
              )}

              <Marker longitude={position.longitude} latitude={position.latitude} anchor="center">
                <div className="relative flex items-center justify-center">
                  <div
                    className="absolute animate-pulse rounded-full"
                    style={{
                      width: 44,
                      height: 44,
                      backgroundColor: 'rgba(66,133,244,0.20)',
                    }}
                  />
                  <div
                    className="absolute"
                    style={{
                      width: 0,
                      height: 0,
                      borderLeft: '9px solid transparent',
                      borderRight: '9px solid transparent',
                      borderBottom: '24px solid rgba(66,133,244,0.30)',
                      transform: `translateY(-13px) rotate(${position.heading}deg)`,
                      transformOrigin: '50% 80%',
                    }}
                  />
                  <div
                    className="relative rounded-full border-[3px] border-white shadow-lg"
                    style={{
                      width: 18,
                      height: 18,
                      backgroundColor: '#1a73e8',
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.08)',
                    }}
                  />
                </div>
              </Marker>

              {isExpanded && <NavigationControl position="bottom-right" showCompass={false} />}
            </Map>

            <div className="absolute bottom-10 left-2 z-10">
              <button
                onClick={handleToggleNorthUp}
                className="relative w-12 h-12 rounded-full bg-black/50 backdrop-blur-md border border-white/20 hover:bg-black/60 transition-all duration-200 flex items-center justify-center group shadow-lg"
                title={isNorthUp ? 'North Up' : 'Heading Up'}
              >
                <div className="transition-transform duration-300" style={{ transform: `rotate(${-mapBearing}deg)` }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M12 4 L15 12 L12 10 L9 12 Z" fill="#ffffff" className="group-hover:fill-sky-400 transition-colors" />
                    <path d="M12 20 L9 12 L12 14 L15 12 Z" fill="#ffffff22" />
                  </svg>
                </div>
              </button>
            </div>

            <div className="absolute bottom-0 left-0 right-0 z-10 h-8 bg-black/50 backdrop-blur-md border-t border-white/10 flex items-center justify-between px-3">
              <div className="text-[11px] text-white/60 font-mono">ALT {Math.round(position.altitude)}m</div>
              {waypointTotal > 1 ? (
                <div className="text-[11px] text-cyan-300 font-mono">
                  {formatDistance(remainingDistanceM)} • {formatEtaMinutes(remainingDistanceM)}
                </div>
              ) : (
                <div className="text-[11px] text-white/60 font-mono">HDG {(Math.round(position.heading) + 360) % 360} deg</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
