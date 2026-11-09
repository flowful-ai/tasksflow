import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { NonRetryableError, runInBackground } from './background.js';
import { normalizeSecret } from './env.js';

describe('runInBackground', () => {
  let errorSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('retries transient failures up to 3 attempts', async () => {
    let calls = 0;
    const result = await runInBackground(
      'test.flaky',
      async () => {
        calls++;
        if (calls < 3) throw new Error('boom');
      },
      { baseDelayMs: 1 }
    );
    expect(result).toEqual({ ok: true, attempts: 3 });
  });

  test('gives up after the last attempt and never rejects', async () => {
    let calls = 0;
    const result = await runInBackground('test.always_fails', async () => {
      calls++;
      throw new Error('down');
    }, { baseDelayMs: 1 });
    expect(result).toEqual({ ok: false, attempts: 3 });
    expect(calls).toBe(3);
  });

  test('does not retry non-retryable errors or 4xx responses', async () => {
    let calls = 0;
    await runInBackground('test.non_retryable', async () => {
      calls++;
      throw new NonRetryableError('bad config');
    }, { baseDelayMs: 1 });
    expect(calls).toBe(1);

    const notFound = Object.assign(new Error('Not Found'), { status: 404 });
    calls = 0;
    await runInBackground('test.not_found', async () => {
      calls++;
      throw notFound;
    }, { baseDelayMs: 1 });
    expect(calls).toBe(1);
  });

  test('logs structured JSON with the task name', async () => {
    await runInBackground('test.logged', async () => {
      throw new Error('nope');
    }, { attempts: 1, context: { taskId: 't1' } });
    const line = String(errorSpy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ msg: 'background_task_failed', task: 'test.logged', taskId: 't1', error: 'nope' });
  });
});

describe('normalizeSecret', () => {
  test('trims whitespace and stray backticks/quotes from env values', () => {
    expect(normalizeSecret('xapp-123`')).toBe('xapp-123');
    expect(normalizeSecret('  xoxb-1  \n')).toBe('xoxb-1');
    expect(normalizeSecret('"quoted"')).toBe('quoted');
    expect(normalizeSecret('`')).toBeUndefined();
    expect(normalizeSecret(undefined)).toBeUndefined();
  });
});
