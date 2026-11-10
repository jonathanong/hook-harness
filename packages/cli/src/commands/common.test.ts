import { readFile } from "node:fs/promises";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

import { clientPath } from "../client.ts";
import { cfnMock, ddbMock, harness, stubStack } from "../test-helpers/ctx.ts";
import { withSlash } from "./common.ts";
import { parseRepos, token } from "./token.ts";

beforeEach(() => {
  cfnMock.reset();
  ddbMock.reset();
  stubStack({ exists: true });
});

describe("withSlash", () => {
  it("adds a trailing slash only when missing", () => {
    expect(withSlash("https://x")).toBe("https://x/");
    expect(withSlash("https://x/")).toBe("https://x/");
  });
});

describe("token scopes and login", () => {
  it("accepts owner/* scopes", () => {
    expect(parseRepos("acme/*,acme/web")).toEqual(["acme/*", "acme/web"]);
    expect(() => parseRepos("*/web")).toThrow("owner/*");
  });

  it("--login saves the function URL and token as the client login", async () => {
    ddbMock.on(PutCommand).resolves({});
    const h = await harness();
    await token(["create", "--repos", "acme/*", "--login"], h.ctx);
    const saved = JSON.parse(await readFile(clientPath(h.ctx.env), "utf8"));
    expect(saved).toEqual({
      url: "https://abc.lambda-url.us-east-1.on.aws/",
      token: `hh_${Buffer.alloc(32, 1).toString("base64url")}`,
    });
    expect(h.out.at(-1)).toContain("Saved login to");
  });
});
