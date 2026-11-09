import { describe, expect, test } from 'bun:test';
import type { UIMessage } from 'ai';
import { hasVisibleOutput } from './message-state';

function message(role: UIMessage['role'], parts: UIMessage['parts']): UIMessage {
  return { id: 'm1', role, parts };
}

describe('hasVisibleOutput', () => {
  test('nothing yet: no message, or the user message just sent', () => {
    expect(hasVisibleOutput(undefined)).toBe(false);
    expect(hasVisibleOutput(message('user', [{ type: 'text', text: 'hi' }]))).toBe(false);
  });

  test('an assistant message with only a step marker or blank text is not visible', () => {
    expect(hasVisibleOutput(message('assistant', [{ type: 'step-start' }]))).toBe(false);
    expect(hasVisibleOutput(message('assistant', [{ type: 'text', text: '  ' }]))).toBe(false);
  });

  test('text, reasoning or a tool call is visible', () => {
    expect(hasVisibleOutput(message('assistant', [{ type: 'text', text: 'Hello' }]))).toBe(true);
    expect(
      hasVisibleOutput(message('assistant', [{ type: 'reasoning', text: '', state: 'streaming' }]))
    ).toBe(true);
    expect(
      hasVisibleOutput(
        message('assistant', [
          {
            type: 'dynamic-tool',
            toolName: 'search_tasks',
            toolCallId: 'c1',
            state: 'input-streaming',
            input: undefined,
          },
        ])
      )
    ).toBe(true);
  });
});
