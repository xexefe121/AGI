import React from "react";
import { Composition } from "remotion";
import { AGILaunchOneMinute } from "./scenes/AGILaunchOneMinute";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="AGILaunch-1min"
      component={AGILaunchOneMinute}
      durationInFrames={60 * 30}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
