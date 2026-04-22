import { describe, expect, it } from 'bun:test';
import { AgentToolSchema } from '@flowtask/shared';
import { AGENT_TOOLS } from './types.js';

describe('AGENT_TOOLS parity with AgentToolSchema', () => {
  it('has exactly one definition per tool in the schema', () => {
    const schemaTools = [...AgentToolSchema.options].sort();
    const definitionTools = AGENT_TOOLS.map((tool) => tool.name).sort();

    expect(definitionTools).toEqual(schemaTools);
  });

  it('gives every tool a non-empty description', () => {
    const missing = AGENT_TOOLS.filter((tool) => !tool.description).map((tool) => tool.name);
    expect(missing).toEqual([]);
  });

  it('lists only declared properties in required[]', () => {
    const offenders = AGENT_TOOLS.flatMap((tool) => {
      const declared = new Set(Object.keys(tool.parameters.properties));
      return tool.parameters.required
        .filter((name) => !declared.has(name))
        .map((name) => `${tool.name}.${name}`);
    });
    expect(offenders).toEqual([]);
  });
});
