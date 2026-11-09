import { describe, expect, it } from 'bun:test';
import { MoveTaskSchema } from './task.js';

const STATE_ID = '123e4567-e89b-12d3-a456-426614174000';

describe('MoveTaskSchema', () => {
  it('accepts a state with optional neighbours', () => {
    expect(MoveTaskSchema.safeParse({ stateId: STATE_ID }).success).toBe(true);
    expect(
      MoveTaskSchema.safeParse({ stateId: STATE_ID, afterTaskId: STATE_ID, beforeTaskId: null })
        .success
    ).toBe(true);
  });

  it('rejects the removed position key with a pointer to afterTaskId/beforeTaskId', () => {
    for (const position of ['a1', null, 3]) {
      const result = MoveTaskSchema.safeParse({ stateId: STATE_ID, position });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['position']);
      expect(result.error?.issues[0]?.message).toContain('afterTaskId');
    }
  });
});
