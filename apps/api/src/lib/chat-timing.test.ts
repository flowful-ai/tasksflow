import { describe, expect, test } from 'bun:test';
import { ChatTiming } from './chat-timing.js';

function clock(...times: number[]): () => number {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)] ?? 0;
}

describe('ChatTiming', () => {
  test('logs one line with prep, first chunk, total, steps and tokens', () => {
    const lines: string[] = [];
    // start 0, stream start 40, first chunk 900, later chunk ignored, finish 2500
    const timing = new ChatTiming(
      { agentId: 'a1', model: 'openai/gpt-5' },
      clock(0, 40, 900, 2500),
      (l) => lines.push(l)
    );
    timing.streamStart();
    timing.firstChunk();
    timing.firstChunk();
    timing.finish({
      steps: 2,
      finishReason: 'stop',
      usage: {
        inputTokens: 1200,
        outputTokens: 80,
        totalTokens: 1280,
        outputTokenDetails: { reasoningTokens: 30 },
      },
    });
    timing.fail('aborted');
    expect(lines).toEqual([
      '[agents] chat agent=a1 model=openai/gpt-5 outcome=finished finish=stop prep_ms=40 first_chunk_ms=900 total_ms=2500 steps=2 input_tokens=1200 output_tokens=80 reasoning_tokens=30 total_tokens=1280',
    ]);
  });

  test('an error before any chunk logs dashes for the missing timings', () => {
    const lines: string[] = [];
    const timing = new ChatTiming({ agentId: 'a1', model: 'm' }, clock(0, 300), (l) =>
      lines.push(l)
    );
    timing.fail('error');
    expect(lines[0]).toBe(
      '[agents] chat agent=a1 model=m outcome=error prep_ms=- first_chunk_ms=- total_ms=300 steps=0 input_tokens=- output_tokens=- reasoning_tokens=- total_tokens=-'
    );
  });
});
