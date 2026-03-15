import { createContext, useContext } from 'react';

interface InboxCountCtx {
  inboxCount: number;
  setInboxCount: (n: number) => void;
}

export const InboxCountContext = createContext<InboxCountCtx>({
  inboxCount: 0,
  setInboxCount: () => {},
});

export function useInboxCount(): InboxCountCtx {
  return useContext(InboxCountContext);
}
