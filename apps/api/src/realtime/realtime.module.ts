import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OutboxRelay } from './outbox.relay';
import { RealtimeGateway } from './realtime.gateway';

@Module({ imports: [AuthModule], providers: [OutboxRelay, RealtimeGateway] })
export class RealtimeModule {}
