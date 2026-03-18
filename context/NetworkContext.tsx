// context/NetworkContext.tsx
//
// NetworkProvider wraps the root layout. Subscribes to @react-native-community/netinfo.
//
// Exposed via useNetworkStatus():
//   isOnline: boolean           — current connectivity state
//   onlineRefreshTrigger: number — incremented on each offline→online transition.
//                                  Include in useFocusEffect useCallback deps to auto-refresh.
//   showOfflineToast(msg?)      — show a top toast with optional custom message.
//
// Also renders the global OfflineBanner and manages the first-offline session toast.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import Toast from '@/components/ui/Toast';
import OfflineBanner from '@/components/ui/OfflineBanner';
import { runCacheCleanup } from '@/lib/offlineCache';

// ─── Context shape ────────────────────────────────────────────────────────────

interface NetworkContextValue {
  isOnline: boolean;
  onlineRefreshTrigger: number;
  showOfflineToast: (message?: string) => void;
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: true,
  onlineRefreshTrigger: 0,
  showOfflineToast: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ToastEntry {
  id: number;
  message: string;
  duration: number;
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [onlineRefreshTrigger, setOnlineRefreshTrigger] = useState(0);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  // In-memory flags — reset on app launch, not persisted
  const hasShownOfflineToast = useRef(false);
  const toastCounter = useRef(0);

  // ── Network subscription ──────────────────────────────────────────────────

  useEffect(() => {
    // Initial fetch
    NetInfo.fetch().then(handleNetworkChange);

    // Subscribe to changes
    const unsubscribe = NetInfo.addEventListener(handleNetworkChange);

    // Run cache cleanup on app launch
    runCacheCleanup().catch(() => {});

    return () => unsubscribe();
  }, []);

  function handleNetworkChange(state: NetInfoState) {
    // Consider online only when connected AND internet is reachable (or unknown/null = assume reachable)
    const online =
      state.isConnected === true && state.isInternetReachable !== false;

    setIsOnline((prev) => {
      if (prev === online) return prev;

      if (!online) {
        // Just went offline — show toast once per session
        if (!hasShownOfflineToast.current) {
          hasShownOfflineToast.current = true;
          enqueueToast("You're offline — showing saved data", 3000);
        }
      } else if (!prev && online) {
        // Just came back online
        enqueueToast('Back online', 2000);
        setOnlineRefreshTrigger((n) => n + 1);
      }

      return online;
    });
  }

  // ── Toast management ──────────────────────────────────────────────────────

  function enqueueToast(message: string, duration: number) {
    const id = ++toastCounter.current;
    setToasts((prev) => [...prev, { id, message, duration }]);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // ── showOfflineToast (callable by screens/components) ─────────────────────

  const showOfflineToast = useCallback((message = "You're offline") => {
    enqueueToast(message, 2000);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <NetworkContext.Provider value={{ isOnline, onlineRefreshTrigger, showOfflineToast }}>
      {children}

      {/* Global offline banner — pointerEvents="none" so it doesn't block taps */}
      <OfflineBanner visible={!isOnline} />

      {/* Global toast stack — render only the most recent toast at a time */}
      {toasts.slice(-1).map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          position="top"
          duration={toast.duration}
          topOffset={!isOnline ? 40 : 0}
          onDismiss={() => dismissToast(toast.id)}
        />
      ))}
    </NetworkContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNetworkStatus(): NetworkContextValue {
  return useContext(NetworkContext);
}
