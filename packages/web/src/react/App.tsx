import { IntroScreen } from './shared/components/IntroScreen';
import { PlayModeUI } from './layouts/PlayModeUI';
import { ThrottleSlider } from './features/controls/components/mobile/ThrottleSlider';
import { isMobileDevice } from './shared/utils/mobileDetect';
import { useGameMethod } from './hooks/useGameMethod';
import { SettingsMenu } from './features/settings/components/SettingsMenu';

export function App() {
  const isMobile = isMobileDevice();
  const { setThrottle } = useGameMethod();

  const handleThrottleChange = (percent: number) => {
    setThrottle(percent / 100);
  };

  return (
    <>
      <IntroScreen />
      <SettingsMenu />
      {!isMobile && <PlayModeUI />}
      {isMobile && <ThrottleSlider onChange={handleThrottleChange} />}
    </>
  );
}
