import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from './errors';

@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(err: DomainError, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(err.status)
      .json({ error: err.code, message: err.message, ...err.details });
  }
}
