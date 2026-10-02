import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

// Postgres constraint violations are the validation layer here — the schema
// already enforces the username pattern, the note length, the one-drink-source
// rule, and the friendship pair uniqueness. The web app switches on `code`
// (23505 → "username taken" / "already friends"), so it is passed through.
const STATUS: Record<string, number> = {
  '23505': 409, // unique_violation
  '23514': 400, // check_violation
  '23503': 400, // foreign_key_violation
  '23502': 400, // not_null_violation
  '22P02': 400, // invalid_text_representation (bad uuid)
};

/**
 * Drizzle wraps driver errors in DrizzleQueryError, so the code is on .cause.
 * The wrapper's message is `Failed query: <SQL>\nparams: <values>` — never
 * surface that; the driver error at the code-carrying level has the safe short
 * message ("duplicate key value violates ...") with no SQL or bound params.
 */
export function pgError(
  error: unknown,
): { code: string; message: string } | undefined {
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && code in STATUS) {
      const message = (e as { message?: unknown }).message;
      return {
        code,
        message: typeof message === 'string' ? message : 'Request failed',
      };
    }
  }
  return undefined;
}

export const pgCode = (error: unknown) => pgError(error)?.code;

@Catch()
export class PgErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(PgErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res
        .status(exception.getStatus())
        .json(typeof body === 'string' ? { message: body } : body);
      return;
    }

    const pg = pgError(exception);
    if (pg) {
      res.status(STATUS[pg.code]).json({
        statusCode: STATUS[pg.code],
        code: pg.code,
        message: pg.message,
      });
      return;
    }

    this.logger.error(exception);
    res.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}
