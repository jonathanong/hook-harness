import type { EventFilter } from "@hook-harness/protocol";

import { matchesAny } from "../watch/session.ts";
import type { Entry } from "./buffer.ts";
import { envelopeFrame, gapFrame, PING } from "./frames.ts";

/** The slice of `http.ServerResponse` the hub needs; fakes implement it in tests. */
export interface Sink {
  write(chunk: string): boolean;
  readonly writableLength: number;
  end(): void;
  destroy(): void;
}

export interface Client {
  sink: Sink;
  filters: EventFilter[];
}

/** Fans frames out to connected clients, dropping any whose unsent bytes exceed the cap. */
export class Hub {
  readonly clients = new Set<Client>();

  readonly #maxClientBytes: number;

  constructor(maxClientBytes: number) {
    this.#maxClientBytes = maxClientBytes;
  }

  get size(): number {
    return this.clients.size;
  }

  add(sink: Sink, filters: EventFilter[]): Client {
    const client = { sink, filters };
    this.clients.add(client);
    return client;
  }

  remove(client: Client): void {
    this.clients.delete(client);
  }

  /** Writes unless the client is too far behind, in which case it is destroyed and removed. */
  send(client: Client, frame: string): void {
    if (client.sink.writableLength > this.#maxClientBytes) {
      this.remove(client);
      client.sink.destroy();
      return;
    }
    client.sink.write(frame);
  }

  publish(entry: Entry): void {
    const frame = envelopeFrame(entry);
    for (const client of this.clients) {
      if (matchesAny(client.filters, entry.event)) this.send(client, frame);
    }
  }

  gap(cursor: string): void {
    const frame = gapFrame(cursor);
    for (const client of this.clients) this.send(client, frame);
  }

  ping(): void {
    for (const client of this.clients) this.send(client, PING);
  }

  closeAll(): void {
    for (const client of this.clients) client.sink.end();
    this.clients.clear();
  }
}
