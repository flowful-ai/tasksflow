import { describe, expect, it } from 'bun:test';
import {
  OAuthError,
  buildS256CodeChallenge,
  isAuthorizingRole,
  validateRequestedMcpScopes,
} from './mcp-oauth-service.js';

describe('mcp-oauth scope validation', () => {
  it('accepts one workspace scope + one or more valid tool scopes', () => {
    const parsed = validateRequestedMcpScopes('mcp:workspace:workspace-1 mcp:tool:create_task mcp:tool:add_comment');

    expect(parsed.workspaceId).toBe('workspace-1');
    expect(parsed.toolScopes).toEqual(['create_task', 'add_comment']);
  });

  it('rejects missing workspace scope', () => {
    expect(() => validateRequestedMcpScopes('mcp:tool:create_task')).toThrow(OAuthError);
  });

  it('rejects multiple workspace scopes', () => {
    expect(() => validateRequestedMcpScopes('mcp:workspace:w1 mcp:workspace:w2 mcp:tool:create_task')).toThrow(OAuthError);
  });

  it('rejects unknown tool scope', () => {
    expect(() => validateRequestedMcpScopes('mcp:workspace:w1 mcp:tool:drop_database')).toThrow(OAuthError);
  });
});

describe('pkce challenge', () => {
  it('generates RFC7636 S256 challenge deterministically', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(buildS256CodeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('authorization role gate', () => {
  it('allows owner and admin', () => {
    expect(isAuthorizingRole('owner')).toBe(true);
    expect(isAuthorizingRole('admin')).toBe(true);
  });

  it('denies member and missing roles', () => {
    expect(isAuthorizingRole('member')).toBe(false);
    expect(isAuthorizingRole(null)).toBe(false);
  });
});
