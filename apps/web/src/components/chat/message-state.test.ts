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

  test('finished reasoning with no text is not visible', () => {
    expect(
      hasVisibleOutput(message('assistant', [{ type: 'reasoning', text: '', state: 'done' }]))
    ).toBe(false);
  });

  test('a finished or approved tool call waits on the next step', () => {
    const tool = (state: 'output-available' | 'approval-responded'): UIMessage['parts'][number] =>
      state === 'output-available'
        ? {
            type: 'dynamic-tool',
            toolName: 'update_task',
            toolCallId: 'c1',
            state,
            input: {},
            output: {},
          }
        : {
            type: 'dynamic-tool',
            toolName: 'update_task',
            toolCallId: 'c1',
            state,
            input: {},
            approval: { id: 'a1', approved: true },
          };
    expect(hasVisibleOutput(message('assistant', [tool('output-available')]))).toBe(false);
    expect(hasVisibleOutput(message('assistant', [tool('approval-responded')]))).toBe(false);
    expect(
      hasVisibleOutput(
        message('assistant', [tool('output-available'), { type: 'text', text: 'Done' }])
      )
    ).toBe(true);
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
