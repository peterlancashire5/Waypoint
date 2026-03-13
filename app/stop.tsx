import { View } from 'react-native';

// Superseded by app/stop-detail.tsx — kept to avoid Expo Router file-not-found
// warnings. Navigation uses pathname: '/stop-detail', not '/stop'.
export default function StopNoop() {
  return <View />;
}
