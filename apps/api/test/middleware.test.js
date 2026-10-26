import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../src/lib/errors.js';
import { toErrorResponse } from '../src/middleware/errorHandler.js';
import { stripMongoOperators } from '../src/middleware/sanitize.js';
import { validate } from '../src/middleware/validate.js';

describe('stripMongoOperators', () => {
  it('removes $-prefixed and dotted keys at any depth', () => {
    const input = {
      email: { $ne: null },
      name: 'ok',
      nested: { 'a.b': 1, keep: [{ $where: 'x', fine: true }] },
    };
    expect(stripMongoOperators(input)).toEqual({
      email: {},
      name: 'ok',
      nested: { keep: [{ fine: true }] },
    });
  });

  it('leaves primitives untouched', () => {
    expect(stripMongoOperators('x')).toBe('x');
    expect(stripMongoOperators(null)).toBe(null);
  });
});

describe('toErrorResponse', () => {
  it('passes AppError through', () => {
    expect(toErrorResponse(new AppError(403, 'FORBIDDEN', 'nope'))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'nope',
    });
  });

  it('maps duplicate-key errors to 409', () => {
    const err = Object.assign(new Error('dup'), { code: 11000, keyValue: { email: 'a' } });
    expect(toErrorResponse(err)).toMatchObject({ status: 409, details: { fields: ['email'] } });
  });

  it('hides the message of unexpected errors', () => {
    expect(toErrorResponse(new Error('db password is hunter2'))).toEqual({
      status: 500,
      code: 'INTERNAL',
      message: 'Something went wrong',
    });
  });
});

describe('validate', () => {
  it('puts parsed values on req.valid and reports Zod errors as VALIDATION_ERROR', () => {
    const middleware = validate({ query: z.object({ page: z.coerce.number().default(1) }) });
    const req = { query: { page: '3' } };
    middleware(req, {}, () => {});
    expect(req.valid.query).toEqual({ page: 3 });

    let thrown;
    try {
      middleware({ query: { page: 'abc' } }, {}, () => {});
    } catch (err) {
      thrown = err;
    }
    expect(toErrorResponse(thrown)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });
});
