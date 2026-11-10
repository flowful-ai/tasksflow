import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { isNonRetryableBackgroundError } from '../background.js';
import { SlackClient } from './client.js';
import { SlackOAuthError, exchangeSlackOAuthCode } from './oauth.js';
import {
  SlackApiError,
  SlackHttpError,
  SlackRateLimitedError,
  SlackWebApi,
  type FetchLike,
} from './web-api.js';

interface Recorded {
  url: string;
  headers: Headers;
  form: URLSearchParams;
}

function json(body: object, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Fake Slack answering from a queue of responses, recording each request. */
function fakeSlack(responses: Response[]): { fetchImpl: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      headers: new Headers(init.headers),
      form: new URLSearchParams(typeof init.body === 'string' ? init.body : ''),
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected Slack call to ${url}`);
    return next;
  };
  return { fetchImpl, calls };
}

function recordingSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms) => {
      waits.push(ms);
    },
  };
}

/** The error a promise rejects with (fails the test if it resolves). */
async function caught(promise: Promise<object | string | null | void>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('rejected with a non-Error');
  }
  throw new Error('expected a rejection');
}

function callAt(calls: Recorded[], index: number): Recorded {
  const call = calls[index];
  if (!call) throw new Error(`no Slack call #${index}`);
  return call;
}

const TsSchema = z.object({ ts: z.string() });

describe('SlackWebApi', () => {
  test('posts a form-encoded call with the bearer token and returns the parsed body', async () => {
    const { fetchImpl, calls } = fakeSlack([json({ ok: true, ts: '1700000000.000100' })]);
    const api = new SlackWebApi({ token: 'xoxb-test', fetchImpl });

    const result = await api.call(
      'chat.postMessage',
      {
        channel: 'C1',
        text: 'hi',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*hi*' } }],
        unfurl_links: false,
        cursor: undefined,
      },
      TsSchema
    );

    expect(result).toEqual({ ts: '1700000000.000100' });
    expect(calls).toHaveLength(1);
    const call = callAt(calls, 0);
    expect(call.url).toBe('https://slack.com/api/chat.postMessage');
    expect(call.headers.get('authorization')).toBe('Bearer xoxb-test');
    expect(call.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(call.form.get('channel')).toBe('C1');
    expect(call.form.get('unfurl_links')).toBe('false');
    expect(call.form.has('cursor')).toBe(false);
    expect(JSON.parse(call.form.get('blocks') ?? '')).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: '*hi*' } },
    ]);
  });

  test('throws SlackApiError with the Slack error code on ok: false, and it is not retried', async () => {
    const { fetchImpl } = fakeSlack([json({ ok: false, error: 'channel_not_found' })]);
    const api = new SlackWebApi({ token: 'xoxb-test', fetchImpl });

    const error = await caught(api.call('chat.postMessage', { channel: 'C1' }, TsSchema));
    expect(error).toBeInstanceOf(SlackApiError);
    expect(error).toMatchObject({ code: 'channel_not_found', method: 'chat.postMessage' });
  });

  test('waits out a short 429 Retry-After, then succeeds', async () => {
    const { fetchImpl, calls } = fakeSlack([
      json({ ok: false, error: 'ratelimited' }, 429, { 'Retry-After': '3' }),
      json({ ok: true, ts: '1.2' }),
    ]);
    const { sleep, waits } = recordingSleep();
    const api = new SlackWebApi({ token: 'xoxb-test', fetchImpl, sleep });

    expect(await api.call('chat.postMessage', { channel: 'C1' }, TsSchema)).toEqual({ ts: '1.2' });
    expect(waits).toEqual([3000]);
    expect(calls).toHaveLength(2);
  });

  test('throws a retryable SlackRateLimitedError when Retry-After is too long', async () => {
    const { fetchImpl, calls } = fakeSlack([json({}, 429, { 'Retry-After': '120' })]);
    const { sleep, waits } = recordingSleep();
    const api = new SlackWebApi({ token: 'xoxb-test', fetchImpl, sleep });

    const error = await caught(api.call('chat.postMessage', { channel: 'C1' }, TsSchema));
    expect(error).toBeInstanceOf(SlackRateLimitedError);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 120 });
    expect(waits).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(isNonRetryableBackgroundError(error)).toBe(false);
  });

  test('gives up after repeated 429s', async () => {
    const limited = (): Response => json({}, 429, { 'Retry-After': '1' });
    const { fetchImpl, calls } = fakeSlack([limited(), limited(), limited()]);
    const { sleep, waits } = recordingSleep();
    const api = new SlackWebApi({ token: 'xoxb-test', fetchImpl, sleep });

    const error = await caught(api.call('chat.postMessage', { channel: 'C1' }, TsSchema));
    expect(error).toBeInstanceOf(SlackRateLimitedError);
    expect(waits).toEqual([1000, 1000]);
    expect(calls).toHaveLength(3);
  });

  test('throws SlackHttpError on a 5xx without a Slack body, and it stays retryable', async () => {
    const { fetchImpl } = fakeSlack([new Response('upstream error', { status: 503 })]);
    const api = new SlackWebApi({ token: 'xoxb-test', fetchImpl });

    const error = await caught(api.call('chat.postMessage', { channel: 'C1' }, TsSchema));
    expect(error).toBeInstanceOf(SlackHttpError);
    expect(error).toMatchObject({ status: 503 });
    expect(isNonRetryableBackgroundError(error)).toBe(false);
  });

  test('rejects an ok response that does not match the schema', async () => {
    const { fetchImpl } = fakeSlack([json({ ok: true })]);
    const api = new SlackWebApi({ token: 'xoxb-test', fetchImpl });

    const error = await caught(api.call('chat.postMessage', { channel: 'C1' }, TsSchema));
    expect(error).toBeInstanceOf(SlackHttpError);
  });
});

describe('SlackClient', () => {
  test('listChannels follows the pagination cursor', async () => {
    const { fetchImpl, calls } = fakeSlack([
      json({
        ok: true,
        channels: [{ id: 'C1', name: 'general', is_private: false, is_member: true }],
        response_metadata: { next_cursor: 'page2' },
      }),
      json({
        ok: true,
        channels: [{ id: 'G1', name: 'secret', is_private: true }, { id: 'C2' }],
        response_metadata: { next_cursor: '' },
      }),
    ]);
    const client = new SlackClient(new SlackWebApi({ token: 'xoxb-test', fetchImpl }));

    expect(await client.listChannels()).toEqual([
      { id: 'C1', name: 'general', isPrivate: false, isMember: true },
      { id: 'G1', name: 'secret', isPrivate: true, isMember: false },
    ]);
    expect(calls.map((c) => c.form.get('cursor'))).toEqual([null, 'page2']);
    expect(callAt(calls, 0).form.get('types')).toBe('public_channel,private_channel');
    expect(callAt(calls, 0).form.get('exclude_archived')).toBe('true');
  });

  test('postMessage returns the message ts; getChannelName falls back to the id', async () => {
    const { fetchImpl, calls } = fakeSlack([
      json({ ok: true, ts: '42.1' }),
      json({ ok: true, channel: { id: 'C9' } }),
      json({ ok: true, channel: { id: 'C1' } }),
    ]);
    const client = new SlackClient(new SlackWebApi({ token: 'xoxb-test', fetchImpl }));

    expect(await client.postMessage('C1', 'hello')).toBe('42.1');
    expect(callAt(calls, 0).form.has('blocks')).toBe(false);
    expect(callAt(calls, 0).form.get('unfurl_media')).toBe('false');
    expect(await client.getChannelName('C9')).toBe('C9');
    await client.joinChannel('C1');
    expect(callAt(calls, 2).url).toBe('https://slack.com/api/conversations.join');
  });

  test('a private channel the bot is not in surfaces not_in_channel', async () => {
    const { fetchImpl } = fakeSlack([json({ ok: false, error: 'not_in_channel' })]);
    const client = new SlackClient(new SlackWebApi({ token: 'xoxb-test', fetchImpl }));

    const error = await caught(client.postMessage('G1', 'hello'));
    expect(error).toBeInstanceOf(SlackApiError);
    expect(error).toMatchObject({ code: 'not_in_channel' });
  });
});

describe('exchangeSlackOAuthCode', () => {
  const credentials = { clientId: 'client-id', clientSecret: 'client-secret' };

  test('exchanges the code without a bearer token and maps the installation', async () => {
    const { fetchImpl, calls } = fakeSlack([
      json({
        ok: true,
        access_token: 'xoxb-new',
        token_type: 'bot',
        bot_user_id: 'U1',
        team: { id: 'T1', name: 'Acme' },
        incoming_webhook: { channel: '#eng', channel_id: 'C7' },
      }),
    ]);

    const installation = await exchangeSlackOAuthCode({
      code: 'the-code',
      redirectUri: 'https://flow.example/api/webhooks/slack/oauth',
      credentials,
      client: new SlackWebApi({ fetchImpl }),
    });

    expect(installation).toEqual({
      teamId: 'T1',
      teamName: 'Acme',
      botToken: 'xoxb-new',
      botUserId: 'U1',
      channel: { id: 'C7', name: 'eng' },
    });
    const call = callAt(calls, 0);
    expect(call.url).toBe('https://slack.com/api/oauth.v2.access');
    expect(call.headers.has('authorization')).toBe(false);
    expect(Object.fromEntries(call.form)).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      code: 'the-code',
      redirect_uri: 'https://flow.example/api/webhooks/slack/oauth',
    });
  });

  test('wraps a Slack error in SlackOAuthError with the error code', async () => {
    const { fetchImpl } = fakeSlack([json({ ok: false, error: 'invalid_code' })]);

    const error = await caught(
      exchangeSlackOAuthCode({
        code: 'bad',
        redirectUri: 'https://flow.example/cb',
        credentials,
        client: new SlackWebApi({ fetchImpl }),
      })
    );
    expect(error).toBeInstanceOf(SlackOAuthError);
    expect(error.message).toBe('Slack OAuth exchange failed: invalid_code');
  });

  test('rejects a non-bot token and a missing team', async () => {
    const userToken = fakeSlack([
      json({ ok: true, access_token: 'xoxp-user', token_type: 'user', team: { id: 'T1' } }),
    ]);
    await expect(
      exchangeSlackOAuthCode({
        code: 'c',
        redirectUri: 'https://flow.example/cb',
        credentials,
        client: new SlackWebApi({ fetchImpl: userToken.fetchImpl }),
      })
    ).rejects.toThrow('Slack OAuth did not return a bot token');

    const noTeam = fakeSlack([json({ ok: true, access_token: 'xoxb-new', team: null })]);
    await expect(
      exchangeSlackOAuthCode({
        code: 'c',
        redirectUri: 'https://flow.example/cb',
        credentials,
        client: new SlackWebApi({ fetchImpl: noTeam.fetchImpl }),
      })
    ).rejects.toThrow('missing bot token');
  });
});
