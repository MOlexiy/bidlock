import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

const DevLogin = z.object({ username: z.string().trim().regex(/^[a-zA-Z0-9_]{3,24}$/) });
const TelegramLogin = z.object({ initData: z.string().min(1).max(4096) });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('dev')
  dev(@Body(new ZodPipe(DevLogin)) body: z.infer<typeof DevLogin>) {
    return this.auth.devLogin(body.username);
  }

  @Post('telegram')
  telegram(@Body(new ZodPipe(TelegramLogin)) body: z.infer<typeof TelegramLogin>) {
    return this.auth.telegramLogin(body.initData);
  }
}
