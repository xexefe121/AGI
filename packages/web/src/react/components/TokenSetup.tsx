import { useState } from 'react';
import { saveTokens } from '../../utils/tokenValidator';

interface TokenSetupProps {
  onComplete: () => void;
}

function isPlaceholderToken(value: string): boolean {
  const token = value.trim().toLowerCase();
  if (!token) return true;
  if (token.startsWith('test_') || token.startsWith('pk.test')) return true;
  if (token === 'test' || token === 'placeholder' || token === 'changeme') return true;
  if (token.includes('your_token_here') || token.includes('your_key_here')) return true;
  return false;
}

export function TokenSetup({ onComplete }: TokenSetupProps) {
  const [mapboxToken, setMapboxToken] = useState('');
  const [cesiumToken, setCesiumToken] = useState('');
  const [geminiToken, setGeminiToken] = useState('');
  const [googleMapsToken, setGoogleMapsToken] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const cesium = cesiumToken.trim();
    if (!cesium) {
      setError('Cesium Ion token is required. Other tokens are optional.');
      return;
    }
    if (isPlaceholderToken(cesium)) {
      setError('Cesium token looks like a placeholder. Paste a real token from ion.cesium.com/tokens.');
      return;
    }

    saveTokens(
      mapboxToken.trim(),
      cesium,
      geminiToken.trim(),
      googleMapsToken.trim()
    );
    onComplete();
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-900 flex items-center justify-center p-4 z-[9999] overflow-y-auto">
      <div className="max-w-2xl w-full glass-panel p-8 space-y-6 my-auto max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-white">🚀 Setup Required</h1>
          <p className="text-white/60">
            Please provide your API tokens to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Mapbox Token */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-white/90">
                Mapbox Access Token
              </label>
              <a
                href="https://account.mapbox.com/access-tokens/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Get token →
              </a>
            </div>
            <input
              type="text"
              value={mapboxToken}
              onChange={(e) => setMapboxToken(e.target.value)}
              placeholder="pk.eyJ1Ijoi..."
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg 
                       text-white placeholder:text-white/30
                       focus:outline-none focus:border-blue-400/50 focus:bg-white/10
                       transition-all duration-200 font-mono text-sm"
            />
            <div className="text-xs text-white/50 space-y-1">
              <p>1. Go to <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Mapbox Tokens</a></p>
              <p>2. Create a new token or copy an existing one</p>
              <p>3. Paste it above</p>
            </div>
          </div>

          {/* Cesium Token */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-white/90">
                Cesium Ion Access Token
              </label>
              <a
                href="https://ion.cesium.com/tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Get token →
              </a>
            </div>
            <input
              type="text"
              value={cesiumToken}
              onChange={(e) => setCesiumToken(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg 
                       text-white placeholder:text-white/30
                       focus:outline-none focus:border-blue-400/50 focus:bg-white/10
                       transition-all duration-200 font-mono text-sm"
            />
            <div className="text-xs text-white/50 space-y-1">
              <p>1. Go to <a href="https://ion.cesium.com/tokens" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Cesium Ion Tokens</a></p>
              <p>2. Sign in or create an account (free)</p>
              <p>3. Copy your default token or create a new one</p>
              <p>4. Paste it above</p>
            </div>
          </div>

          {/* Gemini Token */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-white/90">
                Gemini API Key
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Get key →
              </a>
            </div>
            <input
              type="text"
              value={geminiToken}
              onChange={(e) => setGeminiToken(e.target.value)}
              placeholder="AIza..."
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg 
                       text-white placeholder:text-white/30
                       focus:outline-none focus:border-blue-400/50 focus:bg-white/10
                       transition-all duration-200 font-mono text-sm"
            />
            <div className="text-xs text-white/50 space-y-1">
              <p>1. Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Google AI Studio</a></p>
              <p>2. Create an API key</p>
              <p>3. Paste it above</p>
            </div>
          </div>

          {/* Google Maps Token */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-white/90">
                Google Maps API Key
              </label>
              <a
                href="https://developers.google.com/maps/documentation/directions/get-api-key"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Get key
              </a>
            </div>
            <input
              type="text"
              value={googleMapsToken}
              onChange={(e) => setGoogleMapsToken(e.target.value)}
              placeholder="AIza..."
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg 
                       text-white placeholder:text-white/30
                       focus:outline-none focus:border-blue-400/50 focus:bg-white/10
                       transition-all duration-200 font-mono text-sm"
            />
            <div className="text-xs text-white/50 space-y-1">
              <p>1. Go to <a href="https://developers.google.com/maps/documentation/directions/get-api-key" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Google Maps API key docs</a></p>
              <p>2. Enable Directions API for your project</p>
              <p>3. Create an API key and paste it above</p>
            </div>
          </div>

          {error && (
            <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <button
            type="submit"
            className="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 
                     text-white font-medium rounded-lg
                     transition-all duration-200 transform hover:scale-[1.02]
                     active:scale-[0.98]"
          >
            Save & Continue
          </button>

          <div className="text-xs text-white/40 text-center space-y-1">
            <p>💡 Tip: For permanent setup, add tokens to your .env file:</p>
            <code className="block text-white/50 font-mono">
              VITE_MAPBOX_TOKEN=your_token_here<br />
              VITE_CESIUM_TOKEN=your_token_here<br />
              VITE_GEMINI_API_KEY=your_key_here<br />
              VITE_GOOGLE_MAPS_API_KEY=your_key_here
            </code>
          </div>
        </form>
      </div>
    </div>
  );
}


