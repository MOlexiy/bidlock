import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuctionScheduler } from './auction.scheduler';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';
import { BiddingService } from './bidding.service';
import { SettlementService } from './settlement.service';

@Module({
  imports: [AuthModule],
  controllers: [AuctionsController],
  providers: [AuctionsService, BiddingService, SettlementService, AuctionScheduler],
})
export class AuctionsModule {}
