import { Request, Response } from 'express';
import { InputSanitizationMiddleware } from './input-sanitization.middleware';
import { RequestValidationPipe } from '../pipes/request-validation.pipe';

function run(body: unknown) {
  const req = { body, query: {}, params: {} } as unknown as Request;
  const next = jest.fn();
  new InputSanitizationMiddleware().use(req, {} as Response, next);
  expect(next).toHaveBeenCalled();
  return req.body;
}

describe('InputSanitizationMiddleware', () => {
  it('keeps newlines, carriage returns and tabs', () => {
    const body = run({ description: 'line1\nline2\ttab\r\nline3' });
    expect(body.description).toBe('line1\nline2\ttab\r\nline3');
  });

  it('keeps multi-line JSON-in-string and addresses intact', () => {
    const address = '12 Example Street\nSpringfield\n12345';
    expect(run({ address }).address).toBe(address);
  });

  it('still strips script blocks and other control characters', () => {
    const body = run({
      title: 'Hello<script>alert(1)</script> world\u0000\u0007\u007f',
    });
    expect(body.title).toBe('Hello world');
  });

  it('sanitizes nested values and arrays', () => {
    const body = run({ items: [{ note: 'a\nb\u0001' }] });
    expect(body.items[0].note).toBe('a\nb');
  });
});

describe('RequestValidationPipe', () => {
  it('does not strip characters itself: sanitizing happens once, in the middleware', async () => {
    const pipe = new RequestValidationPipe();
    const value = 'a\nb\tc\u0001';

    expect(
      await pipe.transform(value, { type: 'body', metatype: undefined }),
    ).toBe(value);
  });
});
