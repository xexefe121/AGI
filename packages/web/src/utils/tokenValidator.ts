const MAPBOX_TOKEN_KEY = 'cesium_mapbox_token';
const CESIUM_TOKEN_KEY = 'cesium_ion_token';
const GEMINI_TOKEN_KEY = 'gemini_api_key';
const GOOGLE_MAPS_TOKEN_KEY = 'google_maps_api_key';

export interface Tokens {
  mapbox: string;
  cesium: string;
  gemini: string;
  googleMaps: string;
}

function normalizeToken(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlaceholderToken(value: string): boolean {
  const token = value.trim().toLowerCase();
  if (!token) return true;
  if (token === 'test' || token === 'placeholder' || token === 'changeme') return true;
  if (token.startsWith('test_')) return true;
  if (token.startsWith('pk.test')) return true;
  if (token.includes('your_token_here') || token.includes('your_key_here')) return true;
  return false;
}

function sanitizeToken(value: unknown): string {
  const token = normalizeToken(value);
  if (!token) return '';
  return isPlaceholderToken(token) ? '' : token;
}

function isLikelyCesiumToken(value: string): boolean {
  const token = value.trim();
  if (!token || isPlaceholderToken(token)) return false;
  // Cesium Ion JWT-like tokens are typically long, dot-delimited strings.
  if (token.includes('.')) return token.length >= 40;
  return token.length >= 24;
}

export function getTokens(): Tokens {
  const envMapbox = import.meta.env.VITE_MAPBOX_TOKEN;
  const envCesium = import.meta.env.VITE_CESIUM_TOKEN;
  const envGemini = import.meta.env.VITE_GEMINI_API_KEY;
  const envGoogleMaps = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (envMapbox && envCesium && envGemini && envGoogleMaps) {
    return {
      mapbox: sanitizeToken(envMapbox),
      cesium: sanitizeToken(envCesium),
      gemini: sanitizeToken(envGemini),
      googleMaps: sanitizeToken(envGoogleMaps),
    };
  }

  const localMapbox = localStorage.getItem(MAPBOX_TOKEN_KEY);
  const localCesium = localStorage.getItem(CESIUM_TOKEN_KEY);
  const localGemini = localStorage.getItem(GEMINI_TOKEN_KEY);
  const localGoogleMaps = localStorage.getItem(GOOGLE_MAPS_TOKEN_KEY);

  return {
    mapbox: sanitizeToken(envMapbox || localMapbox || ''),
    cesium: sanitizeToken(envCesium || localCesium || ''),
    gemini: sanitizeToken(envGemini || localGemini || ''),
    googleMaps: sanitizeToken(envGoogleMaps || localGoogleMaps || ''),
  };
}

export function hasValidTokens(): boolean {
  const tokens = getTokens();
  return isLikelyCesiumToken(tokens.cesium);
}

export function saveTokens(mapbox: string, cesium: string, gemini: string, googleMaps: string): void {
  localStorage.setItem(MAPBOX_TOKEN_KEY, mapbox);
  localStorage.setItem(CESIUM_TOKEN_KEY, cesium);
  localStorage.setItem(GEMINI_TOKEN_KEY, gemini);
  localStorage.setItem(GOOGLE_MAPS_TOKEN_KEY, googleMaps);
}

export function clearTokens(): void {
  localStorage.removeItem(MAPBOX_TOKEN_KEY);
  localStorage.removeItem(CESIUM_TOKEN_KEY);
  localStorage.removeItem(GEMINI_TOKEN_KEY);
  localStorage.removeItem(GOOGLE_MAPS_TOKEN_KEY);
}


