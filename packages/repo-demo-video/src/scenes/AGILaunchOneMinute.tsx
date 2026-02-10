import React, { useMemo } from "react";
import { useLoader, useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Mesh, MeshStandardMaterial, Object3D } from "three";

type Tone = "cool" | "warning";
type WordBeat = { word: string; frames: number; accent: string; tone: Tone };
type CameraMode = "hero" | "sweep" | "close";
type SceneEntry = { key: string; frames: number; render: (d: number) => React.ReactNode };

const palette = {
  black: "#020307",
  text: "#F6FAFF",
  cyan: "#54E4FF",
  violet: "#B38FFF",
  red: "#FF5D73",
  emerald: "#3EE1B2",
  steel: "#A8B7D6",
};

const introBeats: WordBeat[] = [
  { word: "AGI", frames: 45, accent: palette.cyan, tone: "cool" },
  { word: "IS", frames: 33, accent: palette.cyan, tone: "cool" },
  { word: "HERE", frames: 54, accent: palette.cyan, tone: "cool" },
  { word: "AUTONOMOUS", frames: 45, accent: palette.violet, tone: "cool" },
  { word: "GEONAVIGATION", frames: 45, accent: palette.violet, tone: "cool" },
  { word: "INTELLIGENCE", frames: 45, accent: palette.violet, tone: "cool" },
  { word: "NO", frames: 24, accent: palette.red, tone: "warning" },
  { word: "VLA", frames: 30, accent: palette.red, tone: "warning" },
  { word: "NO", frames: 24, accent: palette.red, tone: "warning" },
  { word: "WORLD", frames: 30, accent: palette.red, tone: "warning" },
  { word: "MODEL", frames: 30, accent: palette.red, tone: "warning" },
];

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const sceneAlpha = (frame: number, durationInFrames: number) => {
  const fadeIn = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const fadeOut = interpolate(frame, [durationInFrames - 14, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  return fadeIn * fadeOut;
};

const wordSize = (word: string) => {
  if (word.length <= 3) return 360;
  if (word.length <= 5) return 280;
  if (word.length <= 8) return 220;
  if (word.length <= 12) return 170;
  return 144;
};

const WordCard: React.FC<{ beat: WordBeat; durationInFrames: number }> = ({ beat, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ fps, frame, config: { damping: 10, mass: 0.7, stiffness: 180 } });
  const opacity = sceneAlpha(frame, durationInFrames);
  const scanOffset = (frame * 8) % 140;
  const cool = "radial-gradient(circle at 24% 18%, #0B1730 0%, #020307 72%)";
  const warn = "radial-gradient(circle at 22% 20%, #2A0B13 0%, #060205 74%)";

  return (
    <AbsoluteFill style={{ background: beat.tone === "warning" ? warn : cool, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.13,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.45) 1px, transparent 1px)",
          backgroundSize: "140px 140px",
          backgroundPosition: `${scanOffset}px ${scanOffset * 0.5}px`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${1.2 - pop * 0.2})`,
          fontFamily: "Sora, Space Grotesk, Segoe UI, sans-serif",
          fontWeight: 800,
          fontSize: wordSize(beat.word),
          letterSpacing: 2.5,
          color: palette.text,
          textTransform: "uppercase",
          textShadow: `0 0 20px ${beat.accent}, 0 0 52px ${beat.accent}`,
        }}
      >
        {beat.word}
      </div>
      <div style={{ position: "absolute", inset: 18, border: `1px solid ${beat.accent}4A` }} />
    </AbsoluteFill>
  );
};

const CameraRig: React.FC<{ mode: CameraMode }> = ({ mode }) => {
  const { camera } = useThree();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  let radius = 4.6;
  let speed = 0.4;
  let y = 1.35;
  let lookY = 0.95;

  if (mode === "sweep") {
    radius = 3.9;
    speed = 0.62;
    y = 1.1;
    lookY = 1.05;
  }
  if (mode === "close") {
    radius = 3.1;
    speed = 0.22;
    y = 1.24;
    lookY = 1.2;
  }

  camera.position.set(Math.cos(t * speed) * radius, y + Math.sin(t * 0.9) * 0.08, Math.sin(t * speed) * radius);
  camera.lookAt(0, lookY, 0);
  camera.near = 0.1;
  camera.far = 70;
  camera.updateProjectionMatrix();
  return null;
};

const G1Mesh: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const gltf = useLoader(GLTFLoader, staticFile("assets/g1.glb"));

  const model = useMemo(() => {
    const clone = gltf.scene.clone(true) as Object3D;
    clone.traverse((item) => {
      const maybeMesh = item as Mesh;
      if (!("isMesh" in maybeMesh) || !maybeMesh.material) return;
      const mat = maybeMesh.material as MeshStandardMaterial;
      if ("metalness" in mat) {
        mat.metalness = 0.52;
        mat.roughness = 0.32;
      }
    });
    return clone;
  }, [gltf.scene]);

  const t = frame / fps;
  return (
    <group position={[0, -1.02 + Math.sin(t * 2.2) * 0.035, 0]} rotation={[0, t * 0.45, 0]} scale={[1.5, 1.5, 1.5]}>
      <primitive object={model} />
    </group>
  );
};

const G1Stage: React.FC<{ mode: CameraMode }> = ({ mode }) => {
  const { width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame / 15) * 0.05;

  return (
    <AbsoluteFill>
      <ThreeCanvas width={width} height={height}>
        <color attach="background" args={["#030811"]} />
        <fog attach="fog" args={["#040912", 6, 20]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[4, 6, 3]} intensity={1.5} color="#D0E7FF" />
        <pointLight position={[-4, 2.5, -4]} intensity={1.0} color={palette.cyan} />
        <pointLight position={[4, 2, 4]} intensity={0.95} color={palette.violet} />
        <CameraRig mode={mode} />
        <G1Mesh />
        <mesh position={[0, -1.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[4.2, 72]} />
          <meshStandardMaterial color="#081427" roughness={0.6} metalness={0.12} />
        </mesh>
        <mesh position={[0, -1.1, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[pulse, pulse, pulse]}>
          <torusGeometry args={[2.2, 0.045, 18, 150]} />
          <meshStandardMaterial emissive={palette.cyan} emissiveIntensity={1.2} color="#2CCEF4" />
        </mesh>
      </ThreeCanvas>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 24% 20%, rgba(12,24,46,0.22) 0%, rgba(0,0,0,0.58) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

const ThesisScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const alpha = sceneAlpha(frame, durationInFrames);
  const dash = (frame * 8) % 1100;
  const lines = ["WHY SIMULATE THE WORLD", "WHEN YOU CAN NAVIGATE", "THE REAL ONE?"];

  return (
    <AbsoluteFill style={{ opacity: alpha, background: "linear-gradient(145deg, #060F1F 0%, #050911 100%)" }}>
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="thesisPath" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#54E4FF" stopOpacity="0.0" />
            <stop offset="48%" stopColor="#54E4FF" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#B38FFF" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path
          d="M -220 780 C 250 590, 580 760, 1020 560 C 1380 398, 1750 510, 2140 260"
          fill="none"
          stroke="url(#thesisPath)"
          strokeWidth="5"
          strokeDasharray="34 24"
          strokeDashoffset={`${-dash}`}
        />
      </svg>
      <div style={{ position: "absolute", left: 96, top: 100, fontFamily: "Sora, sans-serif" }}>
        {lines.map((line, index) => {
          const pop = spring({
            fps,
            frame: frame - index * 30,
            config: { damping: 16, mass: 0.8, stiffness: 120 },
          });
          return (
            <div
              key={line}
              style={{
                fontSize: 74,
                fontWeight: 780,
                letterSpacing: 1.8,
                lineHeight: 1.03,
                marginBottom: 16,
                opacity: pop,
                transform: `translateY(${(1 - pop) * 30}px)`,
                color: index === 2 ? palette.cyan : palette.text,
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: 96,
          bottom: 86,
          color: palette.steel,
          fontSize: 28,
          fontFamily: "Space Grotesk, Segoe UI, sans-serif",
        }}
      >
        AGI treats simulation as acceleration, not destination.
      </div>
    </AbsoluteFill>
  );
};

const HeroScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const alpha = sceneAlpha(frame, durationInFrames);
  const stripe = (frame * 10) % 640;

  return (
    <AbsoluteFill style={{ opacity: alpha }}>
      <G1Stage mode="hero" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          fontFamily: "Sora, Space Grotesk, Segoe UI, sans-serif",
          padding: "86px 94px",
          color: palette.text,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ fontSize: 18, color: palette.cyan, letterSpacing: 3.2 }}>AGI LAUNCH</div>
        <div style={{ marginTop: 14, fontSize: 128, lineHeight: 0.9, fontWeight: 800 }}>AGI</div>
        <div style={{ marginTop: 12, fontSize: 42, lineHeight: 1.1, color: palette.cyan, fontWeight: 600 }}>
          AUTONOMOUS GEONAVIGATION INTELLIGENCE
        </div>
        <div style={{ marginTop: 20, fontSize: 34, maxWidth: 1360, color: palette.steel, lineHeight: 1.2 }}>
          Unitree G1 + Cesium terrain + MuJoCo control + Gemini vision loops.
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            height: 52,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.3)",
            background: "rgba(6,12,24,0.72)",
            overflow: "hidden",
            position: "relative",
            display: "flex",
            alignItems: "center",
            paddingLeft: 22,
            fontSize: 22,
            letterSpacing: 1.1,
          }}
        >
          REAL-TIME ROBOT NAVIGATION FOR THE PHYSICAL WORLD
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              width: 180,
              left: stripe - 180,
              background: "linear-gradient(90deg, transparent 0%, rgba(84,228,255,0.55) 45%, transparent 100%)",
              filter: "blur(4px)",
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const MissionFlowScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const alpha = sceneAlpha(frame, durationInFrames);
  const progress = clamp01((frame - 8) / Math.max(1, durationInFrames - 28));
  const nodes = [
    { label: "SET START", x: 170 },
    { label: "PLAN ROUTE", x: 500 },
    { label: "START", x: 840 },
    { label: "NAVIGATE", x: 1170 },
    { label: "ARRIVE", x: 1510 },
  ];

  return (
    <AbsoluteFill style={{ opacity: alpha, background: "radial-gradient(circle at 20% 20%, #111D36 0%, #050913 74%)" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.16,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.28) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.28) 1px, transparent 1px)",
          backgroundSize: "120px 120px",
          backgroundPosition: `${(frame * 1.8) % 120}px ${(frame * 0.8) % 120}px`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 94,
          top: 80,
          fontFamily: "Sora, Space Grotesk, Segoe UI, sans-serif",
          color: palette.text,
          fontSize: 78,
          fontWeight: 760,
          lineHeight: 1,
        }}
      >
        FROM PROMPT TO ARRIVAL
      </div>
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 172,
          color: palette.steel,
          fontSize: 30,
          fontFamily: "Space Grotesk, Segoe UI, sans-serif",
        }}
      >
        Prompt + lat/lon + optional Gemini/Google route sources.
      </div>
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
        <line x1="170" y1="560" x2="1680" y2="560" stroke="rgba(255,255,255,0.25)" strokeWidth="4" />
        <line x1="170" y1="560" x2={170 + 1510 * progress} y2="560" stroke={palette.cyan} strokeWidth="8" />
        {nodes.map((node, index) => {
          const p = clamp01(progress * nodes.length - index);
          const r = 14 + p * 8;
          return (
            <g key={node.label}>
              <circle cx={node.x} cy="560" r={r} fill={`rgba(84,228,255,${0.2 + p * 0.7})`} />
              <circle cx={node.x} cy="560" r="8" fill={palette.text} />
              <text
                x={node.x}
                y="626"
                fill={p > 0.3 ? palette.text : palette.steel}
                fontSize="26"
                textAnchor="middle"
                fontFamily="Space Grotesk, Segoe UI, sans-serif"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          left: 96,
          right: 96,
          bottom: 94,
          display: "flex",
          gap: 18,
          fontFamily: "Space Grotesk, Segoe UI, sans-serif",
          fontSize: 24,
          color: palette.steel,
        }}
      >
        <div style={{ flex: 1 }}>Gemini planning optional</div>
        <div style={{ flex: 1 }}>Google route optional</div>
        <div style={{ flex: 1 }}>Local fallback always available</div>
      </div>
    </AbsoluteFill>
  );
};

const VisionScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const alpha = sceneAlpha(frame, durationInFrames);
  const scanY = 88 + ((frame * 5.4) % 400);
  const lines = [
    '{ \"action\": \"steer_right\",',
    '  \"yaw_adjustment\": 0.48,',
    '  \"speed_factor\": 0.62,',
    '  \"source\": \"GeminiVisionBrain\" }',
  ];

  return (
    <AbsoluteFill style={{ opacity: alpha, background: "linear-gradient(150deg, #0B1222 0%, #060B15 100%)" }}>
      <div style={{ position: "absolute", left: 92, top: 78, color: palette.violet, fontSize: 18, letterSpacing: 3.2 }}>
        PERCEPTION + REASONING
      </div>
      <div
        style={{
          position: "absolute",
          left: 92,
          top: 108,
          fontFamily: "Sora, Segoe UI, sans-serif",
          color: palette.text,
          fontSize: 80,
          fontWeight: 760,
          lineHeight: 1,
        }}
      >
        GEMINI 3 VISION
      </div>
      <div
        style={{
          position: "absolute",
          left: 92,
          top: 194,
          color: palette.steel,
          fontSize: 30,
          maxWidth: 920,
          fontFamily: "Space Grotesk, Segoe UI, sans-serif",
        }}
      >
        Camera frame + robot telemetry in, steering decision out.
      </div>

      <div
        style={{
          position: "absolute",
          left: 92,
          top: 268,
          width: 1080,
          height: 560,
          borderRadius: 18,
          border: "1px solid rgba(84,228,255,0.55)",
          background: "rgba(7,13,24,0.76)",
          overflow: "hidden",
        }}
      >
        <svg width="1080" height="560" style={{ position: "absolute", inset: 0 }}>
          <rect x="34" y="40" width="1010" height="480" rx="14" ry="14" fill="rgba(13,22,39,0.72)" />
          <rect x="160" y="130" width="200" height="210" rx="12" fill="none" stroke="rgba(84,228,255,0.82)" strokeWidth="3" />
          <rect x="430" y="180" width="240" height="160" rx="12" fill="none" stroke="rgba(179,143,255,0.82)" strokeWidth="3" />
          <rect x="760" y="140" width="190" height="230" rx="12" fill="none" stroke="rgba(62,225,178,0.82)" strokeWidth="3" />
          <line x1="60" y1={scanY} x2="1020" y2={scanY} stroke="rgba(84,228,255,0.72)" strokeWidth="2" />
        </svg>
      </div>

      <div
        style={{
          position: "absolute",
          right: 92,
          top: 300,
          width: 620,
          borderRadius: 14,
          border: "1px solid rgba(179,143,255,0.45)",
          background: "rgba(6,10,20,0.78)",
          padding: "18px 22px",
          fontFamily: "Consolas, Menlo, monospace",
          fontSize: 26,
          color: "#D9E8FF",
          lineHeight: 1.35,
        }}
      >
        {lines.map((line, index) => (
          <div key={line} style={{ opacity: frame > index * 16 ? 1 : 0.15 }}>
            {line}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const AutonomyScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const alpha = sceneAlpha(frame, durationInFrames);
  const progress = clamp01((frame - 12) / Math.max(1, durationInFrames - 24));
  const pulse = 0.2 + Math.abs(Math.sin(frame / 12)) * 0.8;
  const words = ["SENSE", "DECIDE", "CORRECT"];

  return (
    <AbsoluteFill style={{ opacity: alpha, background: "linear-gradient(135deg, #0A1324 0%, #04070F 100%)" }}>
      <div
        style={{
          position: "absolute",
          left: 94,
          top: 80,
          color: palette.text,
          fontFamily: "Sora, Segoe UI, sans-serif",
          fontSize: 76,
          lineHeight: 1,
          fontWeight: 760,
        }}
      >
        OBSTACLE-AWARE AUTONOMY
      </div>
      <div
        style={{
          position: "absolute",
          left: 94,
          top: 166,
          color: palette.steel,
          fontFamily: "Space Grotesk, Segoe UI, sans-serif",
          fontSize: 30,
        }}
      >
        Terrain probes + dynamic obstacles + vision decisions merged into control commands.
      </div>
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
        <path d="M 120 730 C 490 560, 740 770, 1100 600 C 1360 470, 1620 500, 1790 430" fill="none" stroke="rgba(84,228,255,0.8)" strokeWidth="6" />
        <path
          d="M 120 790 C 470 630, 720 840, 1080 690 C 1350 560, 1610 600, 1790 540"
          fill="none"
          stroke="rgba(255,93,115,0.72)"
          strokeWidth="4"
          strokeDasharray="15 12"
        />
        <circle cx={170 + progress * 1540} cy={730 - progress * 300 + Math.sin(frame / 10) * 5} r="13" fill={palette.emerald} />
        <circle cx="680" cy="650" r={30 + pulse * 20} fill={`rgba(255,93,115,${0.1 + pulse * 0.2})`} />
        <circle cx="680" cy="650" r="14" fill="rgba(255,93,115,0.9)" />
        <circle cx="1250" cy="570" r={24 + pulse * 14} fill={`rgba(255,93,115,${0.08 + pulse * 0.16})`} />
        <circle cx="1250" cy="570" r="11" fill="rgba(255,93,115,0.9)" />
      </svg>
      <div
        style={{
          position: "absolute",
          right: 96,
          top: 250,
          width: 460,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {words.map((word, index) => {
          const visible = clamp01((frame - index * 24) / 16);
          return (
            <div
              key={word}
              style={{
                fontFamily: "Sora, Segoe UI, sans-serif",
                fontSize: 66,
                lineHeight: 0.95,
                fontWeight: 780,
                color: index === 2 ? palette.cyan : palette.text,
                opacity: visible,
                transform: `translateX(${(1 - visible) * 32}px)`,
              }}
            >
              {word}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const MetricsScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const alpha = sceneAlpha(frame, durationInFrames);
  const poseHz = 18 + Math.sin(frame / 16) * 2.6;
  const visionHz = 8.4 + Math.cos(frame / 18) * 1.6;
  const crossTrack = Math.abs(Math.sin(frame / 24)) * 1.28;

  return (
    <AbsoluteFill style={{ opacity: alpha, background: "radial-gradient(circle at 28% 20%, #111F3E 0%, #050913 72%)" }}>
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 92,
          fontFamily: "Sora, Segoe UI, sans-serif",
          color: palette.text,
          fontSize: 78,
          lineHeight: 1,
          fontWeight: 760,
        }}
      >
        RUNTIME TRANSPARENCY
      </div>
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 180,
          color: palette.steel,
          fontFamily: "Space Grotesk, Segoe UI, sans-serif",
          fontSize: 30,
        }}
      >
        Live telemetry, stream health, and route stability in one interface.
      </div>
      <div
        style={{
          position: "absolute",
          left: 96,
          right: 96,
          top: 300,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
        }}
      >
        {[
          { label: "POSE STREAM", value: `${poseHz.toFixed(1)} Hz`, color: palette.cyan },
          { label: "VISION CAPTURE", value: `${visionHz.toFixed(1)} fps`, color: palette.violet },
          { label: "CROSS-TRACK", value: `${crossTrack.toFixed(2)} m`, color: palette.emerald },
        ].map((metric) => (
          <div
            key={metric.label}
            style={{
              borderRadius: 16,
              border: `1px solid ${metric.color}88`,
              background: "rgba(7,13,24,0.78)",
              padding: "20px 22px",
              minHeight: 210,
            }}
          >
            <div style={{ color: palette.steel, fontSize: 20, letterSpacing: 0.9 }}>{metric.label}</div>
            <div style={{ color: metric.color, marginTop: 16, fontSize: 64, lineHeight: 1, fontWeight: 760 }}>
              {metric.value}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 96,
          right: 96,
          bottom: 90,
          height: 12,
          borderRadius: 999,
          background: "rgba(255,255,255,0.15)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${clamp01(frame / Math.max(1, durationInFrames - 1)) * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${palette.cyan}, ${palette.violet}, ${palette.emerald})`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const FinaleScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const alpha = sceneAlpha(frame, durationInFrames);
  const pop = spring({ fps, frame, config: { damping: 13, mass: 0.76, stiffness: 115 } });

  return (
    <AbsoluteFill style={{ opacity: alpha }}>
      <G1Stage mode="close" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          fontFamily: "Sora, Space Grotesk, Segoe UI, sans-serif",
          color: palette.text,
          transform: `scale(${0.92 + pop * 0.08})`,
        }}
      >
        <div style={{ fontSize: 130, fontWeight: 800, letterSpacing: 2, lineHeight: 0.9 }}>AGI IS HERE</div>
        <div style={{ marginTop: 18, fontSize: 38, color: palette.cyan, letterSpacing: 1.4, fontWeight: 600 }}>
          AUTONOMOUS GEONAVIGATION INTELLIGENCE
        </div>
        <div
          style={{
            marginTop: 30,
            fontSize: 26,
            color: palette.steel,
            border: "1px solid rgba(255,255,255,0.28)",
            padding: "12px 22px",
            borderRadius: 10,
            background: "rgba(4,9,18,0.72)",
          }}
        >
          NO VLA. NO WORLD MODEL. REAL-WORLD AUTONOMY.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const FilmOverlay: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(circle at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.56) 100%), linear-gradient(180deg, rgba(0,0,0,0.40), rgba(0,0,0,0.06) 16%, rgba(0,0,0,0.22) 86%, rgba(0,0,0,0.48))",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.03 + Math.abs(Math.sin(frame * 0.31)) * 0.04,
          background: "linear-gradient(transparent 0%, rgba(255,255,255,0.92) 50%, transparent 100%)",
          backgroundSize: "100% 3px",
        }}
      />
      <div style={{ position: "absolute", inset: 16, border: "1px solid rgba(255,255,255,0.16)", pointerEvents: "none" }} />
    </>
  );
};

const narrativeScenes: SceneEntry[] = [
  { key: "thesis", frames: 180, render: (d) => <ThesisScene durationInFrames={d} /> },
  { key: "hero", frames: 225, render: (d) => <HeroScene durationInFrames={d} /> },
  { key: "flow", frames: 240, render: (d) => <MissionFlowScene durationInFrames={d} /> },
  { key: "vision", frames: 225, render: (d) => <VisionScene durationInFrames={d} /> },
  { key: "autonomy", frames: 210, render: (d) => <AutonomyScene durationInFrames={d} /> },
  { key: "metrics", frames: 165, render: (d) => <MetricsScene durationInFrames={d} /> },
  { key: "finale", frames: 150, render: (d) => <FinaleScene durationInFrames={d} /> },
];

export const AGILaunchOneMinute: React.FC = () => {
  const introFrames = introBeats.reduce((acc, beat) => acc + beat.frames, 0);
  const storyFrames = narrativeScenes.reduce((acc, scene) => acc + scene.frames, 0);
  const totalFrames = introFrames + storyFrames;
  if (totalFrames !== 1800) {
    throw new Error(`AGI 1-minute timeline must equal 1800 frames, got ${totalFrames}`);
  }

  let cursor = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: palette.black }}>
      {introBeats.map((beat, index) => {
        const from = cursor;
        cursor += beat.frames;
        return (
          <Sequence key={`intro-${beat.word}-${index}`} from={from} durationInFrames={beat.frames}>
            <WordCard beat={beat} durationInFrames={beat.frames} />
          </Sequence>
        );
      })}
      {narrativeScenes.map((scene) => {
        const from = cursor;
        cursor += scene.frames;
        return (
          <Sequence key={scene.key} from={from} durationInFrames={scene.frames}>
            {scene.render(scene.frames)}
          </Sequence>
        );
      })}
      <FilmOverlay />
    </AbsoluteFill>
  );
};
