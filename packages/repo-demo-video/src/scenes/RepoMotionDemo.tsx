import React from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type DemoMode = "short" | "long";

type RepoMotionDemoProps = {
  mode: DemoMode;
};

const palette = {
  bg0: "#060A14",
  bg1: "#0D1428",
  bg2: "#14223D",
  text: "#E8EEF9",
  muted: "#A4B5D1",
  accent: "#38BDF8",
  accent2: "#22D3EE",
  warm: "#FB923C",
  lime: "#A3E635",
  violet: "#A78BFA",
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const sceneOpacity = (frame: number, durationInFrames: number) => {
  const fadeIn = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return fadeIn * fadeOut;
};

const SceneShell: React.FC<{
  title: string;
  subtitle: string;
  durationInFrames: number;
  kicker?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, durationInFrames, kicker, children }) => {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, durationInFrames);
  const rise = interpolate(frame, [0, 18], [36, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        padding: "90px 110px",
        color: palette.text,
        opacity,
        transform: `translateY(${rise}px)`,
        fontFamily: "Space Grotesk, Segoe UI, sans-serif",
      }}
    >
      <div style={{ marginBottom: 16, fontSize: 18, letterSpacing: 2, color: palette.accent }}>
        {kicker ?? "SIM REPOSITORY DEMO"}
      </div>
      <h1
        style={{
          margin: 0,
          fontSize: 66,
          lineHeight: 1.02,
          maxWidth: 1480,
          textShadow: "0 10px 30px rgba(0,0,0,0.35)",
        }}
      >
        {title}
      </h1>
      <p style={{ marginTop: 16, marginBottom: 0, color: palette.muted, fontSize: 28, maxWidth: 1380 }}>
        {subtitle}
      </p>
      <div style={{ flex: 1 }} />
      {children}
    </AbsoluteFill>
  );
};

const GlobalBackdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const waveX = Math.sin(frame / 55) * 120;
  const waveY = Math.cos(frame / 47) * 90;
  const gridShiftX = (frame * 0.9) % 160;
  const gridShiftY = (frame * 0.6) % 160;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 15% 20%, ${palette.bg2} 0%, ${palette.bg1} 38%, ${palette.bg0} 100%)`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 760,
          height: 760,
          left: -120 + waveX,
          top: -220 + waveY,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(56,189,248,0.35) 0%, rgba(56,189,248,0) 70%)",
          filter: "blur(6px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 680,
          height: 680,
          right: -160 - waveX * 0.5,
          bottom: -260 - waveY * 0.35,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(167,139,250,0.30) 0%, rgba(167,139,250,0) 70%)",
          filter: "blur(8px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "160px 160px",
          backgroundPosition: `${gridShiftX}px ${gridShiftY}px`,
          opacity: 0.24,
        }}
      />
    </AbsoluteFill>
  );
};

const ProgressChrome: React.FC = () => {
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
          background: `linear-gradient(90deg, ${palette.accent}, ${palette.violet})`,
        }}
      />
    </div>
  );
};

const IntroScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({
    fps,
    frame,
    config: { damping: 14, mass: 0.8 },
  });
  const ringRotate = frame * 1.1;

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      title="Cesium + MuJoCo + AI Navigation"
      subtitle="A motion-graphics walkthrough of the h:/sim repository architecture and capabilities."
      kicker="REPO OVERVIEW"
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 40 }}>
        <div style={{ maxWidth: 980 }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {["Realtime 3D Terrain", "Autonomous G1 Robot", "Web + Python Stack", "Route + Vision + Diagnostics"].map(
              (chip, i) => {
                const appear = spring({
                  fps,
                  frame: frame - i * 5,
                  config: { damping: 18 },
                });
                return (
                  <div
                    key={chip}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 999,
                      fontSize: 21,
                      border: "1px solid rgba(255,255,255,0.28)",
                      background: "rgba(6,10,20,0.52)",
                      opacity: appear,
                      transform: `translateY(${(1 - appear) * 24}px)`,
                    }}
                  >
                    {chip}
                  </div>
                );
              }
            )}
          </div>
        </div>
        <div
          style={{
            width: 420,
            height: 420,
            borderRadius: "50%",
            position: "relative",
            transform: `scale(${0.75 + scale * 0.25})`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: "2px solid rgba(56,189,248,0.65)",
              transform: `rotate(${ringRotate}deg)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 40,
              borderRadius: "50%",
              border: "2px solid rgba(167,139,250,0.6)",
              transform: `rotate(${-ringRotate * 0.7}deg)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 120,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(34,211,238,0.85), rgba(34,211,238,0.05))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#052030",
              fontWeight: 700,
              fontSize: 26,
            }}
          >
            h:/sim
          </div>
        </div>
      </div>
    </SceneShell>
  );
};

const RepoSnapshotScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cards = [
    { title: "packages/web", desc: "React + Cesium client with HUD, planner, mini-map, and runtime overlays.", tone: palette.accent },
    { title: "scripts/run_web_stack.py", desc: "Orchestrates MuJoCo sim loop, websocket hubs, route state, and web server.", tone: palette.violet },
    { title: "autonav/*", desc: "Planning, obstacle avoidance, optional Gemini + Google Maps integrations.", tone: palette.lime },
    { title: "tests + output", desc: "Validation artifacts and export targets for simulation and demo deliverables.", tone: palette.warm },
  ];

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      title="Repository Snapshot"
      subtitle="Monorepo layout centered on a high-frequency robot navigation loop with a modern browser control surface."
      kicker="STRUCTURE"
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {cards.map((card, i) => {
          const appear = spring({ fps, frame: frame - i * 6, config: { damping: 17 } });
          return (
            <div
              key={card.title}
              style={{
                borderRadius: 22,
                border: `1px solid ${card.tone}66`,
                background: "rgba(4,8,18,0.62)",
                padding: "26px 28px",
                opacity: appear,
                transform: `translateY(${(1 - appear) * 34}px)`,
              }}
            >
              <div style={{ fontSize: 29, fontWeight: 700, color: card.tone }}>{card.title}</div>
              <div style={{ fontSize: 23, marginTop: 12, color: palette.text, lineHeight: 1.3 }}>{card.desc}</div>
            </div>
          );
        })}
      </div>
    </SceneShell>
  );
};

const StackScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const columns = [
    {
      name: "3D Frontend",
      color: palette.accent,
      points: ["React 18 + TypeScript", "Cesium terrain + camera control", "Tailwind-powered HUD"],
    },
    {
      name: "Navigation UI",
      color: palette.violet,
      points: ["Settings + planner tabs", "Route source diagnostics", "Realtime status events"],
    },
    {
      name: "Simulation Core",
      color: palette.lime,
      points: ["MuJoCo G1 runner", "Pose + perception hubs", "Broadcast and telemetry timing"],
    },
    {
      name: "AI + Routing",
      color: palette.warm,
      points: ["Gemini vision optional", "Google Maps optional", "Local fallback planner"],
    },
  ];

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      title="Technical Stack Layers"
      subtitle="Each layer isolates responsibility while sharing a common route-state contract."
      kicker="TECHNOLOGY"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
        {columns.map((col, i) => {
          const appear = spring({
            fps,
            frame: frame - i * 7,
            config: { damping: 18, mass: 0.9 },
          });
          return (
            <div
              key={col.name}
              style={{
                minHeight: 350,
                borderRadius: 20,
                border: `1px solid ${col.color}7A`,
                background: "rgba(8,12,22,0.65)",
                padding: 20,
                opacity: appear,
                transform: `translateY(${(1 - appear) * 40}px)`,
              }}
            >
              <div style={{ fontSize: 26, fontWeight: 700, color: col.color }}>{col.name}</div>
              <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                {col.points.map((p) => (
                  <div key={p} style={{ fontSize: 21, lineHeight: 1.3, color: palette.text }}>
                    {p}
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

const PipelineScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const nodes = [
    { label: "React HUD", x: 140, color: palette.accent },
    { label: "GameBridge", x: 430, color: palette.accent2 },
    { label: "RouteState", x: 720, color: palette.violet },
    { label: "MuJoCo Runner", x: 1010, color: palette.lime },
    { label: "Perception Hub", x: 1300, color: palette.warm },
    { label: "Vision + Planner", x: 1590, color: palette.accent },
  ];

  const pulse = (frame % 240) / 240;
  const signalX = nodes[0].x + pulse * (nodes[nodes.length - 1].x - nodes[0].x);

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      title="Realtime Data Pipeline"
      subtitle="Input, planning, simulation, and visualization stay synchronized through continuous event streams."
      kicker="FLOW"
    >
      <div style={{ position: "relative", height: 360 }}>
        {nodes.map((n, i) => (
          <React.Fragment key={n.label}>
            {i < nodes.length - 1 ? (
              <div
                style={{
                  position: "absolute",
                  left: n.x + 90,
                  top: 150,
                  width: nodes[i + 1].x - n.x - 100,
                  height: 2,
                  background: "rgba(255,255,255,0.28)",
                }}
              />
            ) : null}
            <div
              style={{
                position: "absolute",
                left: n.x,
                top: 110 + Math.sin((frame + i * 20) / 30) * 8,
                width: 180,
                height: 90,
                borderRadius: 14,
                border: `1px solid ${n.color}AA`,
                background: "rgba(8,12,22,0.82)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 23,
                fontWeight: 600,
                color: n.color,
              }}
            >
              {n.label}
            </div>
          </React.Fragment>
        ))}
        <div
          style={{
            position: "absolute",
            left: signalX,
            top: 143,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: palette.text,
            boxShadow: `0 0 20px ${palette.accent}`,
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 26 }}>
        {[
          "WebSocket pose/perception updates",
          "Route-follow metrics and off-route detection",
          "Planner toggles: Gemini, Google Maps, fallback",
        ].map((line) => (
          <div
            key={line}
            style={{
              flex: 1,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.24)",
              padding: "16px 18px",
              fontSize: 21,
              color: palette.text,
              background: "rgba(5,9,18,0.6)",
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </SceneShell>
  );
};

const FeatureScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const features = [
    "Vehicle switch and camera modes",
    "Mini-map with route progression",
    "Runtime diagnostics and stream health",
    "Quality presets + advanced toggles",
    "Traffic overlays and simulation speed",
    "Vision viewer state telemetry",
    "Start / goal planner interactions",
    "Input + keyboard control overlays",
  ];

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      title="Core Product Features"
      subtitle="Designed for both immersive control and debuggable autonomy behavior."
      kicker="FEATURES"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        {features.map((feature, i) => {
          const appear = spring({
            fps,
            frame: frame - i * 4,
            config: { damping: 17, stiffness: 140 },
          });
          return (
            <div
              key={feature}
              style={{
                minHeight: 145,
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.28)",
                background: "rgba(8,13,24,0.70)",
                padding: "14px 16px",
                opacity: appear,
                transform: `translateY(${(1 - appear) * 24}px) scale(${0.92 + appear * 0.08})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                fontSize: 22,
                lineHeight: 1.28,
              }}
            >
              {feature}
            </div>
          );
        })}
      </div>
    </SceneShell>
  );
};

const AutonomyScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [12, durationInFrames - 24], [0, 6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const steps = ["Boot", "Load Config", "Plan Route", "Start Nav", "Avoid Obstacles", "Track Progress", "Arrive"];

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      title="Autonomy Execution Loop"
      subtitle="Deterministic loop timing with optional AI assist and robust fallback route behavior."
      kicker="NAVIGATION"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {steps.map((step, i) => {
          const active = clamp01(progress - i + 1);
          return (
            <div key={step} style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.35)",
                  background: `rgba(56,189,248,${0.2 + active * 0.8})`,
                  boxShadow: active > 0 ? "0 0 16px rgba(56,189,248,0.65)" : "none",
                }}
              />
              <div style={{ width: 210, fontSize: 24, color: palette.text }}>{step}</div>
              <div
                style={{
                  flex: 1,
                  height: 12,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.12)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${active * 100}%`,
                    height: "100%",
                    background: `linear-gradient(90deg, ${palette.accent}, ${palette.violet})`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 26,
          padding: "16px 20px",
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.24)",
          background: "rgba(8,12,22,0.58)",
          fontSize: 22,
          color: palette.muted,
        }}
      >
        Default demo route in `scripts/run_web_stack.py`: near Sydney Opera House to Circular Quay with road-safe
        coordinates and off-route detection telemetry.
      </div>
    </SceneShell>
  );
};

const RuntimeOpsScene: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const poseHz = 18 + Math.sin(frame / 18) * 3.2;
  const visionHz = 7.8 + Math.cos(frame / 22) * 1.8;
  const crossTrack = Math.abs(Math.sin(frame / 26)) * 1.7;

  const graphPoints = new Array(28).fill(0).map((_, i) => {
    const x = (i / 27) * 1080;
    const y = 180 - (Math.sin((frame + i * 9) / 18) * 0.45 + 0.5) * 150;
    return `${x},${y}`;
  });

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      title="Runtime Diagnostics and Stability"
      subtitle="Streaming health, metric visibility, and control over simulation speed are built into the UI."
      kicker="OPERATIONS"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {[
          { label: "Pose Broadcast", value: `${poseHz.toFixed(1)} Hz`, color: palette.accent },
          { label: "Vision Capture", value: `${visionHz.toFixed(1)} fps`, color: palette.violet },
          { label: "Cross-track Error", value: `${crossTrack.toFixed(2)} m`, color: palette.warm },
        ].map((metric) => (
          <div
            key={metric.label}
            style={{
              borderRadius: 16,
              border: `1px solid ${metric.color}7A`,
              background: "rgba(8,12,22,0.72)",
              padding: "18px 20px",
            }}
          >
            <div style={{ fontSize: 20, color: palette.muted }}>{metric.label}</div>
            <div style={{ marginTop: 8, fontSize: 46, fontWeight: 700, color: metric.color }}>{metric.value}</div>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 24,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.24)",
          background: "rgba(6,10,20,0.64)",
          padding: "16px 22px",
        }}
      >
        <div style={{ fontSize: 20, color: palette.muted, marginBottom: 12 }}>Telemetry Trend (illustrative)</div>
        <svg width={1080} height={190}>
          <polyline
            fill="none"
            stroke={palette.accent}
            strokeWidth={4}
            points={graphPoints.join(" ")}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </SceneShell>
  );
};

const OutroScene: React.FC<{ durationInFrames: number; mode: DemoMode }> = ({ durationInFrames, mode }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ fps, frame, config: { damping: 13, mass: 0.75 } });

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      title={mode === "short" ? "1-Minute Executive Cut" : "3-Minute Deep-Dive Cut"}
      subtitle="Remotion-generated motion graphics summarizing architecture, features, and runtime behavior of the sim repo."
      kicker="DELIVERABLE"
    >
      <div
        style={{
          width: 1160,
          borderRadius: 24,
          border: "1px solid rgba(255,255,255,0.28)",
          background: "rgba(8,12,22,0.72)",
          padding: "26px 30px",
          transform: `scale(${0.92 + pop * 0.08})`,
          transformOrigin: "left center",
        }}
      >
        <div style={{ fontSize: 27, color: palette.accent, marginBottom: 10 }}>Exports</div>
        <div style={{ fontSize: 24, color: palette.text, lineHeight: 1.45 }}>h:/video/repo-demo-1min.mp4</div>
        <div style={{ fontSize: 24, color: palette.text, lineHeight: 1.45 }}>h:/video/repo-demo-3min.mp4</div>
      </div>
    </SceneShell>
  );
};

export const RepoMotionDemo: React.FC<RepoMotionDemoProps> = ({ mode }) => {
  const { fps } = useVideoConfig();

  const scenes =
    mode === "short"
      ? [
          { key: "intro", seconds: 8, render: (d: number) => <IntroScene durationInFrames={d} /> },
          { key: "snapshot", seconds: 8, render: (d: number) => <RepoSnapshotScene durationInFrames={d} /> },
          { key: "stack", seconds: 9, render: (d: number) => <StackScene durationInFrames={d} /> },
          { key: "pipeline", seconds: 11, render: (d: number) => <PipelineScene durationInFrames={d} /> },
          { key: "features", seconds: 10, render: (d: number) => <FeatureScene durationInFrames={d} /> },
          { key: "autonomy", seconds: 9, render: (d: number) => <AutonomyScene durationInFrames={d} /> },
          { key: "outro", seconds: 5, render: (d: number) => <OutroScene durationInFrames={d} mode={mode} /> },
        ]
      : [
          { key: "intro", seconds: 14, render: (d: number) => <IntroScene durationInFrames={d} /> },
          { key: "snapshot", seconds: 20, render: (d: number) => <RepoSnapshotScene durationInFrames={d} /> },
          { key: "stack", seconds: 24, render: (d: number) => <StackScene durationInFrames={d} /> },
          { key: "pipeline", seconds: 28, render: (d: number) => <PipelineScene durationInFrames={d} /> },
          { key: "features", seconds: 28, render: (d: number) => <FeatureScene durationInFrames={d} /> },
          { key: "autonomy", seconds: 24, render: (d: number) => <AutonomyScene durationInFrames={d} /> },
          { key: "ops", seconds: 22, render: (d: number) => <RuntimeOpsScene durationInFrames={d} /> },
          { key: "outro", seconds: 20, render: (d: number) => <OutroScene durationInFrames={d} mode={mode} /> },
        ];

  let cursor = 0;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: palette.bg0,
        fontFamily: "Space Grotesk, Segoe UI, sans-serif",
      }}
    >
      <GlobalBackdrop />
      {scenes.map((scene) => {
        const durationInFrames = Math.round(scene.seconds * fps);
        const from = cursor;
        cursor += durationInFrames;
        return (
          <Sequence key={scene.key} from={from} durationInFrames={durationInFrames}>
            {scene.render(durationInFrames)}
          </Sequence>
        );
      })}
      <ProgressChrome />
    </AbsoluteFill>
  );
};

