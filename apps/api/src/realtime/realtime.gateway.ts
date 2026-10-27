import { Inject, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import Redis from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { REDIS } from '../db/db.module';
import { EVENTS_CHANNEL, OutboxEvent } from '../common/events';

const room = {
  lobby: 'lobby',
  auction: (id: number) => `auction:${id}`,
  user: (id: number) => `user:${id}`,
};

/**
 * Every API instance subscribes to the same Redis channel and pushes to its own sockets,
 * so the app scales horizontally without sticky routing of events.
 * WebSocket is push-only here: bids go through REST (idempotency key, proper status codes).
 */
@WebSocketGateway({ cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection, OnApplicationBootstrap, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly log = new Logger(RealtimeGateway.name);
  private sub?: Redis;

  constructor(
    private readonly jwt: JwtService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  handleConnection(socket: Socket) {
    void socket.join(room.lobby);
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return; // anonymous viewers can still watch auctions
    try {
      const userId = Number(this.jwt.verify<{ sub: string }>(token).sub);
      socket.data.userId = userId;
      void socket.join(room.user(userId));
    } catch {
      socket.emit('auth_error');
    }
  }

  @SubscribeMessage('auction:join')
  join(@ConnectedSocket() socket: Socket, @MessageBody() auctionId: number) {
    if (Number.isInteger(auctionId)) void socket.join(room.auction(auctionId));
  }

  @SubscribeMessage('auction:leave')
  leave(@ConnectedSocket() socket: Socket, @MessageBody() auctionId: number) {
    void socket.leave(room.auction(auctionId));
  }

  async onApplicationBootstrap() {
    this.sub = this.redis.duplicate();
    this.sub.on('message', (_channel, raw) => this.route(raw));
    await this.sub.subscribe(EVENTS_CHANNEL);
  }

  private route(raw: string) {
    let e: OutboxEvent<any>;
    try {
      e = JSON.parse(raw);
    } catch {
      return;
    }
    const p = e.payload;
    switch (e.topic) {
      case 'auction.created':
        this.server.to(room.lobby).emit(e.topic, p);
        break;
      case 'auction.bid':
      case 'auction.finished':
        // list view (lobby) and the auction page; socket.io dedupes sockets that are in both rooms
        this.server.to([room.lobby, room.auction(p.auction.id)]).emit(e.topic, p);
        break;
      case 'wallet.updated':
      case 'user.outbid':
        this.server.to(room.user(p.userId)).emit(e.topic, p);
        break;
      default:
        this.log.warn(`unknown topic ${e.topic}`);
    }
  }

  async onModuleDestroy() {
    this.sub?.disconnect();
  }
}
