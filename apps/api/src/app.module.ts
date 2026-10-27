import { Controller, Get, Module } from '@nestjs/common';
import { AuctionsModule } from './auctions/auctions.module';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { RealtimeModule } from './realtime/realtime.module';
import { UsersModule } from './users/users.module';

@Controller('health')
class HealthController {
  @Get()
  ok() {
    return { ok: true };
  }
}

@Module({
  imports: [DbModule, AuthModule, UsersModule, AuctionsModule, RealtimeModule],
  controllers: [HealthController],
})
export class AppModule {}
