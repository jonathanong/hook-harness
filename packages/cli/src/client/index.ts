// The public `hook-harness/client` entry: a stable API over the relay's `GET /events`.
// Everything exported here is documented in the README's "Client API" section.
export type { Envelope, EventFilter, EventsPage } from "@hook-harness/protocol";
export { resolveClient, type ClientConfig } from "./config.ts";
export {
  AuthError,
  BadRequestError,
  InvalidCursorError,
  NotLoggedInError,
  OutOfScopeError,
  RelayError,
  UnauthorizedError,
} from "./errors.ts";
export {
  fetchEventsPage,
  type Connection,
  type EventsQuery,
  type FetchEventsPageOptions,
} from "./events.ts";
export {
  pollEvents,
  pollPages,
  type EventsBatch,
  type PageResult,
  type PollEventsOptions,
  type PollPagesOptions,
} from "./poll.ts";
