import { describe, expect, it } from 'bun:test';
import { OAuthError } from './errors.js';
import {
  sanitizeClientName,
  validateRedirectUri,
  validateRedirectUris,
  describeRedirectTarget,
} from './redirect-uri.js';
import { resolveRequestedResource, tokenResourceMatches } from './resource.js';
import { openWithSecret, sealWithSecret } from './crypto.js';
import { buildWwwAuthenticateHeader, getProtectedResourceMetadata } from './metadata.js';
import { expandToolPermissions } from './scopes.js';

describe('dynamic client registration redirect policy', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'http://127.0.0.1:33418/callback',
    'http://localhost:6274/oauth/callback',
    'http://[::1]:8080/cb',
    'com.example.app:/oauth2redirect',
    'cursor.app://anysphere.cursor-retrieval/oauth/callback',
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'vscode://vscode.github-authentication/did-authenticate',
    'myapp:/callback',
  ])('accepts %s', (uri) => {
    expect(validateRedirectUri(uri)).toBe(uri);
  });

  it.each([
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'http://evil.example/callback',
    'http://127.0.0.1.evil.example/cb',
    'vbscript:msgbox(1)',
    'https://example.com/cb#fragment',
    'not a url',
  ])('rejects %s', (uri) => {
    expect(() => validateRedirectUri(uri)).toThrow(OAuthError);
  });

  it('caps the number of redirect URIs', () => {
    const uris = Array.from({ length: 11 }, (_, index) => `https://example.com/cb/${index}`);
    expect(() => validateRedirectUris(uris)).toThrow(/At most 10/);
  });

  it('strips control characters and caps the client name', () => {
    expect(sanitizeClientName('Claude‮\u0000 Code')).toBe('Claude Code');
    expect(() => sanitizeClientName('x'.repeat(101))).toThrow(OAuthError);
    expect(() => sanitizeClientName('   ')).toThrow(OAuthError);
  });

  it('describes the redirect destination for the consent page', () => {
    expect(describeRedirectTarget('https://claude.ai/api/mcp/auth_callback?x=1')).toBe('claude.ai');
    expect(describeRedirectTarget('com.example.app:/oauth2redirect')).toBe(
      'com.example.app:/oauth2redirect'
    );
  });
});

describe('RFC 8707 resource binding', () => {
  const base = 'https://tasks.example.com';

  it('defaults to the canonical MCP URL', () => {
    expect(resolveRequestedResource([], base)).toBe('https://tasks.example.com/api/mcp');
  });

  it('accepts both MCP paths and normalizes trailing slashes', () => {
    expect(resolveRequestedResource(['https://tasks.example.com/api/mcp/sse/'], base)).toBe(
      'https://tasks.example.com/api/mcp/sse'
    );
    expect(resolveRequestedResource(['https://TASKS.example.com/api/mcp'], base)).toBe(
      'https://tasks.example.com/api/mcp'
    );
  });

  it('rejects other resources and conflicting values', () => {
    expect(() => resolveRequestedResource(['https://evil.example/api/mcp'], base)).toThrow(
      /identify this MCP server/
    );
    expect(() => resolveRequestedResource(['https://tasks.example.com/api/other'], base)).toThrow(
      OAuthError
    );
    expect(() =>
      resolveRequestedResource(
        ['https://tasks.example.com/api/mcp', 'https://evil.example/api/mcp'],
        base
      )
    ).toThrow(/Only one resource/);
  });

  it('only accepts tokens bound to this server', () => {
    expect(tokenResourceMatches(null, base)).toBe(true);
    expect(tokenResourceMatches('https://tasks.example.com/api/mcp', base)).toBe(true);
    expect(tokenResourceMatches('https://tasks.example.com/api/mcp/sse', base)).toBe(true);
    expect(tokenResourceMatches('https://other.example.com/api/mcp', base)).toBe(false);
  });

  it('publishes metadata whose resource equals the path it was derived from', () => {
    expect(getProtectedResourceMetadata(base, '/api/mcp').resource).toBe(
      'https://tasks.example.com/api/mcp'
    );
    expect(getProtectedResourceMetadata(base, '/api/mcp/sse').resource).toBe(
      'https://tasks.example.com/api/mcp/sse'
    );
    expect(
      buildWwwAuthenticateHeader(base, '/api/mcp', {
        code: 'invalid_token',
        description: 'expired "now"',
      })
    ).toBe(
      'Bearer realm="flowtask-mcp", resource_metadata="https://tasks.example.com/.well-known/oauth-protected-resource/api/mcp", error="invalid_token", error_description="expired now"'
    );
  });
});

describe('refresh grace payload sealing', () => {
  it('can only be opened with the presented refresh token', () => {
    const sealed = sealWithSecret('refresh-token-1', '{"a":1}');
    expect(openWithSecret('refresh-token-1', sealed)).toBe('{"a":1}');
    expect(openWithSecret('refresh-token-2', sealed)).toBeNull();
  });
});

describe('implied tool permissions', () => {
  it('grants batched companions of granted tools only', () => {
    const expanded: string[] = expandToolPermissions(['create_task', 'update_task', 'nope']);
    expect(expanded.sort()).toEqual([
      'bulk_create_tasks',
      'bulk_update_tasks',
      'create_task',
      'update_task',
    ]);
  });
});
