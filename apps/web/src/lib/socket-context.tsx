import { createContext, useContext, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';

export const SocketContext = createContext<Socket | null>(null);

export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const socket = useContext(SocketContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const fn = (p: T) => ref.current(p);
    socket.on(event, fn);
    return () => {
      socket.off(event, fn);
    };
  }, [socket, event]);
}

export const useSocket = () => useContext(SocketContext);
