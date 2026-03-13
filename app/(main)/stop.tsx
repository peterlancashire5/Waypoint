import { View } from 'react-native';

// The stop detail screen lives at the root stack level (app/stop.tsx).
// This file must exist because Expo Router picks up all files in the directory,
// but it should never be navigated to — navigation uses pathname: '/stop'.
export default function StopPlaceholder() {
  return <View />;
}
