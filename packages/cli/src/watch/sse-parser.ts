/** One dispatched SSE message, or a comment line (heartbeats arrive as `: ping`). */
export type SseItem =
  | { type: "comment"; text: string }
  | { type: "message"; event: string; data: string; id: string | undefined };

export interface SseParser {
  /** Feed decoded text in any chunking; returns the items completed by it. */
  push(text: string): SseItem[];
}

/** A small spec-following parser: CR, LF and CRLF line ends; multi-line data; comments. */
export function createSseParser(): SseParser {
  let buffer = "";
  let event = "";
  let id: string | undefined;
  let data: string[] = [];

  const line = (text: string, items: SseItem[]): void => {
    if (text === "") {
      if (data.length > 0) {
        items.push({ type: "message", event: event || "message", data: data.join("\n"), id });
      }
      event = "";
      data = [];
      return;
    }
    if (text.startsWith(":")) {
      items.push({ type: "comment", text: text.slice(1).trimStart() });
      return;
    }
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  };

  return {
    push(text) {
      buffer += text;
      const items: SseItem[] = [];
      // A trailing CR may be half of a CRLF split across chunks: hold it back.
      const held = buffer.endsWith("\r") ? "\r" : "";
      const parts = buffer.slice(0, buffer.length - held.length).split(/\r\n|\n|\r/);
      buffer = (parts.pop() as string) + held;
      for (const part of parts) line(part, items);
      return items;
    },
  };
}
