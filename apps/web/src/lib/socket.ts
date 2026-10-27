import { io, Socket } from 'socket.io-client';

export function connect(token: string | null): Socket {
  return io({ auth: token ? { token } : {}, transports: ['websocket'] });
}
