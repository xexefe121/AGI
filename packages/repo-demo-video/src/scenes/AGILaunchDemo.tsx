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

type DemoMode = "short" | "long";

type AGILaunchDemoProps = {
  mode: DemoMode;
};

type SceneEntry = {
  key: string;
  seconds: number;
  render: (durationInFrames: number) => React.ReactNode;
};

type CameraMode = "hero" | "reveal" | "close";

const palette = {
  bg0: "#02040A",
  bg1: "#080F1E",
  bg2: "#0D1C34",
  text: "#F3F7FF",
  muted: "#A8B7D6",
  cyan: "#4CC9F0",
  blue: "#3B82F6",
  violet: "#A78BFA",
  emerald: "#34D399",
  amber: "#F59E0B",
  rose: "#FB7185",
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const sceneAlpha = (frame: number, durationInFrames: number) => {
  const inFade = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const outFade = interpolate(frame, [durationInFrames - 16, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  return inFade * outFade;
};

const chipStyle: React.CSSProperties = {
  padding: "10px 15px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.35)",
  background: "rgba(5,12,24,0.68)",
  fontSize: 18,
  letterSpacing: 0.4,
};

const SceneShell: React.FC<{
  durationInFrames: number;
  kicker: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  align?: "left" | "center";
}> = ({ durationInFrames, kicker, title, subtitle, children, align = "left" }) => {
  const frame = useCurrentFrame();
  const alpha = sceneAlpha(frame, durationInFrames);
  const rise = interpolate(frame, [0, 16], [30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const textAlign = align;

  return (
    <AbsoluteFill
      style={{
        opacity: alpha,
        color: palette.text,
        fontFamily: "Sora, Space Grotesk, Segoe UI, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: "82px 108px 70px",
          display: "flex",
          flexDirection: "column",
          transform: `translateY(${rise}px)`,
          textAlign,
        }}
      >
        <div
          style={{
            fontSize: 16,
            letterSpacing: 3.2,
            color: palette.cyan,
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          {kicker}
        </div>
        <div style={{ marginTop: 12, fontSize: 72, lineHeight: 1.02, fontWeight: 700, maxWidth: 1560 }}>{title}</div>
        {subtitle ? (
          <div style={{ marginTop: 16, color: palette.muted, fontSize: 28, lineHeight: 1.35, maxWidth: 1500 }}>
            {subtitle}
          </div>
        ) : null}
        <div style={{ flex: 1 }} />
        {children}
      </div>
    </AbsoluteFill>
  );
};

const CinematicBackdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const driftX = Math.sin(frame / 42) * 120;
  const driftY = Math.cos(frame / 37) * 90;
  const gridX = (frame * 1.1) % 180;
  const gridY = (frame * 0.8) % 180;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 18% 22%, ${palette.bg2} 0%, ${palette.bg1} 46%, ${palette.bg0} 100%)`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 980,
          height: 980,
          left: -260 + driftX,
          top: -340 + driftY,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(76,201,240,0.28) 0%, rgba(76,201,240,0) 72%)",
          filter: "blur(10px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 860,
          height: 860,
          right: -250 - driftX * 0.8,
          bottom: -320 - driftY * 0.6,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(167,139,250,0.24) 0%, rgba(167,139,250,0) 72%)",
          filter: "blur(10px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px)",
          backgroundSize: "180px 180px",
          backgroundPosition: `${gridX}px ${gridY}px`,
          opacity: 0.3,
        }}
      />
    </AbsoluteFill>
  );
};

const FilmOverlay: React.FC = () => {
  const frame = useCurrentFrame();
  const flicker = 0.03 + Math.abs(Math.sin(frame * 0.37)) * 0.03;

  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(circle at center, rgba(0,0,0,0) 42%, rgba(0,0,0,0.45) 100%), linear-gradient(180deg, rgba(0,0,0,0.38), rgba(0,0,0,0.08) 14%, rgba(0,0,0,0.16) 85%, rgba(0,0,0,0.42))",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: flicker,
          backgroundImage:
            "linear-gradient(transparent 0%, rgba(255,255,255,0.9) 50%, transparent 100%)",
          backgroundSize: "100% 3px",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 20,
          right: 20,
          top: 20,
          bottom: 20,
          border: "1px solid rgba(255,255,255,0.14)",
          pointerEvents: "none",
        }}
      />
    </>
  );
};

const ProgressLine: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = clamp01(frame / Math.max(1, durationInFrames - 1));

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: 6,
        background: "rgba(255,255,255,0.16)",
      }}
    >
      <div
        style={{
          width: `${progress * 100}%`,
          height: "100%",
          background: `linear-gradient(90deg, ${palette.cyan}, ${palette.violet})`,
        }}
      />
    </div>
  );
};

const CameraRig: React.FC<{ localFrame: number; mode: CameraMode }> = ({ localFrame, mode }) => {
  const { camera } = useThree();
  const { fps } = useVideoConfig();
  const t = localFrame / fps;

  let radius = 4.8;
  let y = 1.4;
  let speed = 0.35;
  let lookY = 0.85;

  if (mode === "reveal") {
    radius = 4.1;
    y = 1.05;
    speed = 0.55;
    lookY = 1.0;
  }

  if (mode === "close") {
    radius = 3.2;
    y = 1.2;
    speed = 0.22;
    lookY = 1.2;
  }

  const x = Math.cos(t * speed) * radius;
  const z = Math.sin(t * speed) * radius;

  camera.position.set(x, y + Math.sin(t * 0.9) * 0.08, z);
  camera.lookAt(0, lookY, 0);
  camera.near = 0.1;
  camera.far = 60;
  camera.updateProjectionMatrix();

  return null;
};

const G1Model: React.FC<{ localFrame: number }> = ({ localFrame }) => {
  const gltf = useLoader(GLTFLoader, staticFile("assets/g1.glb"));
  const { fps } = useVideoConfig();

  const model = useMemo(() => {
    const root = gltf.scene.clone(true) as Object3D;
    root.traverse((obj) => {
      const maybeMesh = obj as Mesh;
      if (!("isMesh" in maybeMesh) || !maybeMesh.material) {
        return;
      }
      const material = maybeMesh.material as MeshStandardMaterial;
      if ("metalness" in material) {
        material.metalness = 0.52;
        material.roughness = 0.32;
      }
    });
    return root;
  }, [gltf.scene]);

  const t = localFrame / fps;
  const yaw = t * 0.42;
  const bob = Math.sin(t * 2.4) * 0.035;

  return (
    <group position={[0, -1.02 + bob, 0]} rotation={[0, yaw, 0]} scale={[1.5, 1.5, 1.5]}>
      <primitive object={model} />
    </group>
  );
};

const G1Stage3D: React.FC<{ mode: CameraMode }> = ({ mode }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const pulse = 1 + Math.sin(frame / 20) * 0.04;

  return (
    <div style={{ position: "absolute", inset: 0, opacity: 0.95 }}>
      <ThreeCanvas width={width} height={height}>
        <color attach="background" args={["#050912"]} />
        <fog attach="fog" args={["#04070f", 6, 18]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[4, 5, 3]} intensity={1.45} color="#b8d8ff" />
        <pointLight position={[-4, 3, -4]} intensity={1.1} color="#4cc9f0" />
        <pointLight position={[4, 2, 4]} intensity={0.9} color="#a78bfa" />
        <CameraRig localFrame={frame} mode={mode} />
        <G1Model localFrame={frame} />
        <mesh position={[0, -1.13, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[4.4, 72]} />
          <meshStandardMaterial color="#0b1629" roughness={0.56} metalness={0.1} />
        </mesh>
        <mesh position={[0, -1.11, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[pulse, pulse, pulse]}>
          <torusGeometry args={[2.3, 0.04, 18, 140]} />
          <meshStandardMaterial emissive="#45d6ff" emissiveIntensity={1.1} color="#2dcdf0" />
        </mesh>
      </ThreeCanvas>
    </div>
  );
};

const SceneNoWorldModel: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ fps, frame, config: { damping: 14, mass: 0.85 } });

  return (
    <>
      <G1Stage3D mode="hero" />
      <SceneShell
        durationInFrames={durationInFrames}
        kicker="AGI LAUNCH"
        title={
          <>
            NO WORLD MODEL.
            <br />
            NO VLA.
            <br />
            NO DELAY.
          </>
        }
        subtitle="Real-world autonomy demands direct perception, decisive planning, and transparent control loops."
      >
        <div style={{ display: "flex", gap: 12, transform: `scale(${0.9 + pop * 0.1})`, transformOrigin: "left center" }}>
          {["Realtime geospatial context", "Unitree G1 mobility", "Production-grade diagnostics"].map((item) => (
            <div key={item} style={chipStyle}>
              {item}
            </div>
          ))}
        </div>
      </SceneShell>
    </>
  );
};

const SceneWhyRealWorld: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const pathShift = (frame * 9) % 1200;
  const alpha = sceneAlpha(frame, durationInFrames);

  return (
    <AbsoluteFill style={{ opacity: alpha }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(120deg, rgba(8,14,26,0.85) 0%, rgba(9,18,35,0.94) 45%, rgba(6,11,22,0.9) 100%)",
        }}
      />
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="road" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.0" />
            <stop offset="45%" stopColor="#38bdf8" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path
          d="M -200 760 C 240 560, 580 760, 1020 520 C 1360 330, 1760 430, 2120 210"
          fill="none"
          stroke="url(#road)"
          strokeWidth="6"
          strokeDasharray="34 22"
          strokeDashoffset={`${-pathShift}`}
        />
        <path
          d="M -260 830 C 180 610, 520 810, 980 590 C 1360 405, 1770 500, 2100 260"
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="2"
        />
      </svg>
      <SceneShell
        durationInFrames={durationInFrames}
        kicker="THESIS"
        title="Why simulate the world when you can navigate the real one?"
        subtitle="AGI uses simulation as acceleration, not as a substitute for deployment reality."
      >
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ ...chipStyle, borderColor: "rgba(76,201,240,0.7)", color: palette.cyan }}>SIM TO REAL</div>
          <div style={{ ...chipStyle, borderColor: "rgba(52,211,153,0.7)", color: palette.emerald }}>
            FIELD-FIRST DESIGN
          </div>
        </div>
      </SceneShell>
    </AbsoluteFill>
  );
};

const SceneAGIReveal: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ fps, frame, config: { damping: 12, mass: 0.85 } });

  return (
    <>
      <G1Stage3D mode="reveal" />
      <SceneShell
        durationInFrames={durationInFrames}
        kicker="PRODUCT NAME"
        title={
          <>
            AGI
            <br />
            <span style={{ color: palette.cyan }}>Autonomous Geospatial Intelligence</span>
          </>
        }
        subtitle="A launch-ready platform that fuses geospatial rendering, robot state, and AI-driven decision support."
      >
        <div
          style={{
            width: 920,
            border: "1px solid rgba(255,255,255,0.35)",
            borderRadius: 16,
            padding: "16px 20px",
            background: "rgba(4,9,20,0.7)",
            transform: `scale(${0.92 + pop * 0.08})`,
            transformOrigin: "left center",
            fontSize: 24,
          }}
        >
          Built for teams shipping autonomy in real terrain, under real constraints, with real observability.
        </div>
      </SceneShell>
    </>
  );
};

const ScenePlanStartNavigate: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cards = [
    {
      title: "1. Set Start + Goal",
      text: "Coordinate entry and planner tabs support rapid mission setup.",
      color: palette.cyan,
    },
    {
      title: "2. Build Route",
      text: "Google Maps or fallback planners produce practical waypoint paths.",
      color: palette.violet,
    },
    {
      title: "3. Start Navigation",
      text: "Route-state control starts autonomous movement with live feedback.",
      color: palette.emerald,
    },
  ];
  const routeProgress = clamp01(frame / Math.max(1, durationInFrames - 40));

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      kicker="MISSION FLOW"
      title="Plan. Start. Navigate."
      subtitle="A control experience designed for speed without sacrificing technical depth."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {cards.map((card, index) => {
          const appear = spring({
            fps,
            frame: frame - index * 7,
            config: { damping: 18, mass: 0.8 },
          });
          return (
            <div
              key={card.title}
              style={{
                minHeight: 210,
                borderRadius: 16,
                border: `1px solid ${card.color}88`,
                background: "rgba(7,13,25,0.72)",
                padding: "18px 18px 16px",
                opacity: appear,
                transform: `translateY(${(1 - appear) * 24}px)`,
              }}
            >
              <div style={{ color: card.color, fontWeight: 700, fontSize: 28, lineHeight: 1.08 }}>{card.title}</div>
              <div style={{ marginTop: 12, color: palette.muted, fontSize: 22, lineHeight: 1.35 }}>{card.text}</div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 22,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.25)",
          background: "rgba(6,11,21,0.72)",
          padding: 18,
        }}
      >
        <div style={{ fontSize: 18, color: palette.muted, marginBottom: 10, letterSpacing: 1 }}>ROUTE EXECUTION</div>
        <div style={{ height: 12, borderRadius: 999, background: "rgba(255,255,255,0.14)", overflow: "hidden" }}>
          <div
            style={{
              width: `${routeProgress * 100}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${palette.cyan}, ${palette.violet}, ${palette.emerald})`,
            }}
          />
        </div>
      </div>
    </SceneShell>
  );
};

const SceneGeminiVision: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const sweep = (frame * 5.5) % 740;
  const scanPulse = 0.4 + Math.sin(frame / 14) * 0.2;

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      kicker="INTELLIGENCE LAYER"
      title={
        <>
          Gemini 3 Vision
          <br />
          <span style={{ color: palette.cyan }}>for real-time scene understanding</span>
        </>
      }
      subtitle="Perception insights feed into navigation context to improve route adherence and behavior decisions."
    >
      <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 16 }}>
        <div
          style={{
            borderRadius: 18,
            border: "1px solid rgba(76,201,240,0.62)",
            background: "rgba(6,11,22,0.78)",
            minHeight: 280,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <svg width="100%" height="100%" viewBox="0 0 920 320" style={{ position: "absolute", inset: 0 }}>
            <rect x="20" y="20" width="880" height="280" rx="16" ry="16" fill="rgba(12,21,39,0.75)" />
            <rect x="100" y="70" width="240" height="160" rx="12" fill="none" stroke="rgba(76,201,240,0.75)" strokeWidth="3" />
            <rect x="390" y="90" width="210" height="110" rx="12" fill="none" stroke="rgba(167,139,250,0.75)" strokeWidth="3" />
            <rect x="640" y="80" width="170" height="145" rx="12" fill="none" stroke="rgba(52,211,153,0.75)" strokeWidth="3" />
            <line x1="40" y1={40 + sweep} x2="880" y2={40 + sweep} stroke={`rgba(76,201,240,${scanPulse})`} strokeWidth="2" />
          </svg>
          <div style={{ position: "absolute", left: 28, top: 24, fontSize: 16, color: palette.cyan, letterSpacing: 1.2 }}>
            LIVE PERCEPTION FEED
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            "Scene semantics + context",
            "Obstacle and route relevance",
            "Status messaging for operators",
            "Optional AI with fallback planning",
          ].map((line, idx) => (
            <div
              key={line}
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(6,11,22,0.74)",
                padding: "14px 16px",
                fontSize: 21,
                color: idx % 2 === 0 ? palette.text : palette.muted,
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </SceneShell>
  );
};

const SceneAdaptiveAutonomy: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, durationInFrames - 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      kicker="CORRECTION LOOP"
      title="Adaptive autonomy under drift and obstacles"
      subtitle="Off-route detection and correction are first-class behaviors, not afterthoughts."
    >
      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.24)",
          background: "rgba(6,10,20,0.74)",
          padding: "20px 24px",
        }}
      >
        <svg width="100%" height="260" viewBox="0 0 1420 260">
          <path d="M 60 182 C 360 86, 560 210, 900 112 C 1080 66, 1260 106, 1360 80" fill="none" stroke="rgba(76,201,240,0.85)" strokeWidth="6" />
          <path
            d="M 60 198 C 340 106, 560 236, 900 146 C 1080 110, 1260 146, 1360 122"
            fill="none"
            stroke="rgba(251,113,133,0.65)"
            strokeWidth="4"
            strokeDasharray="14 10"
          />
          <circle cx={60 + progress * 1300} cy={182 - progress * 102 + Math.sin(frame / 18) * 6} r="11" fill="#34d399" />
        </svg>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 12 }}>
          {[
            "Cross-track monitoring",
            "Obstacle-aware steering",
            "Automatic heading correction",
          ].map((item) => (
            <div
              key={item}
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.2)",
                padding: "12px 14px",
                fontSize: 19,
                color: palette.muted,
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </SceneShell>
  );
};

const SceneTransparency: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const pose = 17.8 + Math.sin(frame / 19) * 2.4;
  const vision = 8.9 + Math.cos(frame / 21) * 1.6;
  const crossTrack = Math.abs(Math.sin(frame / 31)) * 1.35;

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      kicker="OBSERVABILITY"
      title="Full runtime transparency"
      subtitle="AGI exposes the metrics that matter for autonomous performance and operator trust."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {[
          { label: "Pose Broadcast", value: `${pose.toFixed(1)} Hz`, color: palette.cyan },
          { label: "Vision Capture", value: `${vision.toFixed(1)} fps`, color: palette.violet },
          { label: "Cross-track Error", value: `${crossTrack.toFixed(2)} m`, color: palette.emerald },
        ].map((metric) => (
          <div
            key={metric.label}
            style={{
              borderRadius: 14,
              border: `1px solid ${metric.color}88`,
              background: "rgba(8,14,28,0.78)",
              padding: "18px 20px",
            }}
          >
            <div style={{ color: palette.muted, fontSize: 18 }}>{metric.label}</div>
            <div style={{ color: metric.color, marginTop: 10, fontSize: 48, fontWeight: 700 }}>{metric.value}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
        {["Route source visibility", "Planner notes and warnings", "Stream health in one panel"].map((item) => (
          <div
            key={item}
            style={{
              flex: 1,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(7,12,24,0.75)",
              padding: "12px 14px",
              fontSize: 19,
              color: palette.muted,
            }}
          >
            {item}
          </div>
        ))}
      </div>
    </SceneShell>
  );
};

const SceneCuttingEdge: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const columns = [
    { title: "Geospatial", list: ["Cesium terrain", "Global coordinates", "High-fidelity camera"], color: palette.cyan },
    { title: "Simulation", list: ["MuJoCo G1 loop", "Pose/perception hubs", "Timing controls"], color: palette.violet },
    { title: "Intelligence", list: ["Gemini 3 Vision", "Planner fallback", "Context-driven actions"], color: palette.emerald },
    { title: "Interface", list: ["Route planner", "Runtime diagnostics", "Operator visibility"], color: palette.amber },
  ];

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      kicker="CUTTING EDGE"
      title="A stack engineered for deployment velocity"
      subtitle="Every layer is optimized for real-world autonomy, not demo-only perfection."
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {columns.map((col, i) => {
          const appear = spring({
            fps,
            frame: frame - i * 6,
            config: { damping: 16, mass: 0.9 },
          });
          return (
            <div
              key={col.title}
              style={{
                minHeight: 295,
                borderRadius: 14,
                border: `1px solid ${col.color}88`,
                background: "rgba(7,12,23,0.78)",
                padding: "14px 16px",
                opacity: appear,
                transform: `translateY(${(1 - appear) * 28}px)`,
              }}
            >
              <div style={{ color: col.color, fontSize: 26, fontWeight: 700 }}>{col.title}</div>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                {col.list.map((item) => (
                  <div key={item} style={{ fontSize: 19, color: palette.muted, lineHeight: 1.3 }}>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </SceneShell>
  );
};

const SceneSimToReal: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const divider = interpolate(frame, [0, durationInFrames - 20], [0.32, 0.66], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      kicker="TRANSITION"
      title="Simulation is the acceleration lane."
      subtitle="The destination is real-world autonomy at production quality."
    >
      <div
        style={{
          borderRadius: 18,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.24)",
          height: 340,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${divider * 100}%`,
            background:
              "linear-gradient(140deg, rgba(17,35,66,0.96), rgba(13,26,50,0.96)), repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0, rgba(255,255,255,0.08) 1px, transparent 1px, transparent 28px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: `${(1 - divider) * 100}%`,
            background:
              "linear-gradient(130deg, rgba(13,26,40,0.95), rgba(18,36,60,0.95)), radial-gradient(circle at 70% 60%, rgba(76,201,240,0.28), rgba(76,201,240,0))",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `calc(${divider * 100}% - 2px)`,
            top: 0,
            bottom: 0,
            width: 4,
            background: `linear-gradient(180deg, ${palette.cyan}, ${palette.violet})`,
          }}
        />
        <div style={{ position: "absolute", left: 24, top: 20, fontSize: 20, color: palette.cyan }}>SIMULATION</div>
        <div style={{ position: "absolute", right: 24, top: 20, fontSize: 20, color: palette.emerald }}>REAL WORLD</div>
      </div>
    </SceneShell>
  );
};

const SceneOutro: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({
    fps,
    frame,
    config: { damping: 13, mass: 0.8 },
  });

  return (
    <>
      <G1Stage3D mode="close" />
      <SceneShell
        durationInFrames={durationInFrames}
        kicker="END CARD"
        title={
          <>
            AGI
            <br />
            <span style={{ color: palette.cyan }}>Autonomous Geospatial Intelligence</span>
          </>
        }
        subtitle="Real-world autonomy. Right now."
        align="center"
      >
        <div
          style={{
            margin: "0 auto",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.35)",
            padding: "14px 24px",
            fontSize: 24,
            letterSpacing: 0.8,
            background: "rgba(7,12,24,0.75)",
            transform: `scale(${0.92 + pop * 0.08})`,
            width: 760,
          }}
        >
          NO WORLD MODEL. NO VLA. REAL-WORLD INTELLIGENCE.
        </div>
      </SceneShell>
    </>
  );
};

const shortScenes = (): SceneEntry[] => [
  { key: "no-world", seconds: 8, render: (d) => <SceneNoWorldModel durationInFrames={d} /> },
  { key: "why-real", seconds: 8, render: (d) => <SceneWhyRealWorld durationInFrames={d} /> },
  { key: "agi-reveal", seconds: 8, render: (d) => <SceneAGIReveal durationInFrames={d} /> },
  { key: "plan-flow", seconds: 10, render: (d) => <ScenePlanStartNavigate durationInFrames={d} /> },
  { key: "gemini", seconds: 10, render: (d) => <SceneGeminiVision durationInFrames={d} /> },
  { key: "adaptive", seconds: 8, render: (d) => <SceneAdaptiveAutonomy durationInFrames={d} /> },
  { key: "transparent", seconds: 8, render: (d) => <SceneTransparency durationInFrames={d} /> },
  { key: "outro", seconds: 10, render: (d) => <SceneOutro durationInFrames={d} /> },
];

const longScenes = (): SceneEntry[] => [
  { key: "no-world", seconds: 12, render: (d) => <SceneNoWorldModel durationInFrames={d} /> },
  { key: "why-real", seconds: 16, render: (d) => <SceneWhyRealWorld durationInFrames={d} /> },
  { key: "agi-reveal", seconds: 17, render: (d) => <SceneAGIReveal durationInFrames={d} /> },
  { key: "plan-flow", seconds: 25, render: (d) => <ScenePlanStartNavigate durationInFrames={d} /> },
  { key: "gemini", seconds: 20, render: (d) => <SceneGeminiVision durationInFrames={d} /> },
  { key: "adaptive", seconds: 18, render: (d) => <SceneAdaptiveAutonomy durationInFrames={d} /> },
  { key: "transparent", seconds: 18, render: (d) => <SceneTransparency durationInFrames={d} /> },
  { key: "stack", seconds: 16, render: (d) => <SceneCuttingEdge durationInFrames={d} /> },
  { key: "sim-to-real", seconds: 18, render: (d) => <SceneSimToReal durationInFrames={d} /> },
  { key: "outro", seconds: 20, render: (d) => <SceneOutro durationInFrames={d} /> },
];

export const AGILaunchDemo: React.FC<AGILaunchDemoProps> = ({ mode }) => {
  const { fps } = useVideoConfig();
  const timeline = mode === "short" ? shortScenes() : longScenes();
  let cursor = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg0 }}>
      <CinematicBackdrop />
      {timeline.map((scene) => {
        const durationInFrames = Math.round(scene.seconds * fps);
        const from = cursor;
        cursor += durationInFrames;

        return (
          <Sequence key={scene.key} from={from} durationInFrames={durationInFrames}>
            {scene.render(durationInFrames)}
          </Sequence>
        );
      })}
      <FilmOverlay />
      <ProgressLine />
    </AbsoluteFill>
  );
};
