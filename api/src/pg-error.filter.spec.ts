import { ForbiddenException, Logger } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { PgErrorFilter, pgCode } from './pg-error.filter';

/** Minimal ArgumentsHost exposing a res double. */
function hostWithResponse() {
  const res = { statusCode: 0, body: undefined as unknown };
  const chain = {
    status: (code: number) => {
      res.statusCode = code;
      return chain;
    },
    json: (payload: unknown) => {
      res.body = payload;
      return chain;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => chain }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('pgCode', () => {
  it('reads the code off a bare driver error', () => {
    expect(pgCode({ code: '23505' })).toBe('23505');
  });

  // The reason this helper exists: drizzle-orm wraps driver errors in a
  // DrizzleQueryError, so the SQLSTATE is one (or more) levels down.
  it('unwraps a drizzle-wrapped driver error', () => {
    const wrapped = Object.assign(new Error('Failed query'), {
      cause: Object.assign(new Error('duplicate key'), { code: '23505' }),
    });
    expect(pgCode(wrapped)).toBe('23505');
  });

  it('walks more than one level of cause', () => {
    const outer = Object.assign(new Error('outer'), {
      cause: Object.assign(new Error('middle'), {
        cause: Object.assign(new Error('inner'), { code: '23514' }),
      }),
    });
    expect(pgCode(outer)).toBe('23514');
  });

  it('ignores codes it does not map', () => {
    expect(pgCode({ code: 'ECONNRESET' })).toBeUndefined();
    expect(pgCode(new Error('nothing to see'))).toBeUndefined();
  });
});

describe('PgErrorFilter', () => {
  const filter = new PgErrorFilter();

  afterEach(() => jest.restoreAllMocks());

  // The web app switches on `code` ("that username is taken"), so a wrapped
  // unique violation has to arrive as 409 with the SQLSTATE intact.
  it('maps a wrapped unique violation to 409 and passes the code through', () => {
    const { host, res } = hostWithResponse();
    filter.catch(
      Object.assign(new Error('Failed query'), {
        cause: Object.assign(new Error('duplicate key'), { code: '23505' }),
      }),
      host,
    );
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ statusCode: 409, code: '23505' });
  });

  // Regression: the DrizzleQueryError wrapper's message embeds the full SQL and
  // bound params; the response must carry the driver error's short message only.
  it('never echoes the wrapped query text or params', () => {
    const { host, res } = hostWithResponse();
    filter.catch(
      Object.assign(
        new Error('Failed query: insert into "profiles" ...\nparams: alice'),
        {
          cause: Object.assign(new Error('duplicate key value'), {
            code: '23505',
          }),
        },
      ),
      host,
    );
    expect(res.body).toMatchObject({
      code: '23505',
      message: 'duplicate key value',
    });
    expect(JSON.stringify(res.body)).not.toContain('Failed query');
    expect(JSON.stringify(res.body)).not.toContain('params');
  });

  it('maps a check violation to 400', () => {
    const { host, res } = hostWithResponse();
    filter.catch({ code: '23514', message: 'bad row' }, host);
    expect(res.statusCode).toBe(400);
  });

  it('leaves HttpExceptions alone', () => {
    const { host, res } = hostWithResponse();
    filter.catch(new ForbiddenException('Friends only'), host);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ message: 'Friends only' });
  });

  it('hides unexpected errors behind a 500', () => {
    const { host, res } = hostWithResponse();
    // the filter logs unexpected errors; keep that out of the test output
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    filter.catch(new Error('kaboom: secret connection string'), host);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
  });
});
