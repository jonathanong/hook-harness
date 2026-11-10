import { describe, expect, it } from "vitest";

import { createSseParser } from "./sse-parser.ts";

describe("createSseParser", () => {
  it("parses id, event and data into a message", () => {
    const parser = createSseParser();
    expect(parser.push('id: 7\nevent: envelope\ndata: {"a":1}\n\n')).toEqual([
      { type: "message", event: "envelope", data: '{"a":1}', id: "7" },
    ]);
  });

  it("defaults the event name and joins multi-line data", () => {
    const parser = createSseParser();
    expect(parser.push("data: one\ndata:two\ndata\n\n")).toEqual([
      { type: "message", event: "message", data: "one\ntwo\n", id: undefined },
    ]);
  });

  it("reports comments, ignoring unknown fields and empty messages", () => {
    const parser = createSseParser();
    expect(parser.push(": ping\nretry: 10\n\n\n")).toEqual([{ type: "comment", text: "ping" }]);
  });

  it("handles chunks split anywhere, including inside CRLF", () => {
    const parser = createSseParser();
    const text = "id: a\r\ndata: x\r\n\r\n: ping\r\n\r\n";
    const items = [...text].flatMap((char) => parser.push(char));
    expect(items).toEqual([
      { type: "message", event: "message", data: "x", id: "a" },
      { type: "comment", text: "ping" },
    ]);
  });

  it("accepts bare CR line ends, holding a trailing CR until the next chunk", () => {
    const parser = createSseParser();
    expect(parser.push("id: 1\rdata: a\r\rdata: b\r\r")).toEqual([
      { type: "message", event: "message", data: "a", id: "1" },
    ]);
    expect(parser.push("\n")).toEqual([{ type: "message", event: "message", data: "b", id: "1" }]);
  });
});
