/** The relay (or `serve`) refused the token: retrying with the same token cannot help. */
export class AuthError extends Error {
  override name = "AuthError";
}

/** HTTP 401: the token is missing, unknown, revoked or expired. */
export class UnauthorizedError extends AuthError {
  override name = "UnauthorizedError";
  readonly status = 401;
}

/** HTTP 403: a valid token whose repo scope lists nothing under `owner`. */
export class OutOfScopeError extends AuthError {
  override name = "OutOfScopeError";
  readonly status = 403;
  readonly owner: string;
  /** The token's repo scopes, when the relay names them (older relays do not). */
  readonly scopes: string[] | undefined;
  constructor(message: string, owner: string, scopes: string[] | undefined) {
    super(message);
    this.owner = owner;
    this.scopes = scopes;
  }
}

/** Any other non-2xx response from the relay: transient, so the pollers retry it. */
export class RelayError extends Error {
  override name = "RelayError";
  readonly status: number;
  constructor(status: number, message = `relay returned HTTP ${status}`) {
    super(message);
    this.status = status;
  }
}

/** HTTP 400: a missing `owner`, or a bad `after` or `filters`. Retrying cannot help, so the pollers throw it. */
export class BadRequestError extends RelayError {
  override name = "BadRequestError";
}

/** An `after` cursor that is not one `pollEvents` or `hook-harness wait`/`tail` produced. */
export class InvalidCursorError extends Error {
  override name = "InvalidCursorError";
}

/** No relay URL and token in the environment or the saved `hook-harness login`. */
export class NotLoggedInError extends Error {
  override name = "NotLoggedInError";
}
