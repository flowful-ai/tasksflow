export type OAuthErrorStatus = 400 | 401 | 403 | 404 | 429 | 500;

export class OAuthError extends Error {
  public readonly statusCode: OAuthErrorStatus;
  public readonly oauthError: string;

  constructor(oauthError: string, message: string, statusCode: OAuthErrorStatus = 400) {
    super(message);
    this.name = 'OAuthError';
    this.statusCode = statusCode;
    this.oauthError = oauthError;
  }
}

export function isOAuthError(error: unknown): error is OAuthError {
  return error instanceof OAuthError;
}
