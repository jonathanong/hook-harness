import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { matches, preset } from "@hook-harness/protocol";
import { beforeEach, describe, expect, it } from "vitest";

import { route } from "./handler.ts";
import { ddb, deps, NOW, request, webhookEvent } from "./test-helpers/deps.ts";
import { fixture } from "./test-helpers/fixture.ts";

// Webhook in, GET /events out: the new fields survive storage and the relay filters on them.
const stored: Record<string, unknown>[] = [];

beforeEach(() => {
  stored.length = 0;
  ddb.reset();
  ddb.on(PutCommand).callsFake((input) => {
    stored.push(input.Item);
    return {};
  });
  ddb.on(GetCommand).resolves({ Item: { repos: ["o/*"], expiresAt: NOW / 1000 + 100 } });
  ddb.on(QueryCommand).callsFake(() => ({ Items: stored }));
});

async function events(filters: unknown) {
  const result = await route(
    request("GET", "/events", {
      headers: { authorization: "Bearer t" },
      queryStringParameters: { owner: "o", payload: "0", filters: JSON.stringify(filters) },
    }),
    deps,
  );
  return (JSON.parse(result.body!) as { events: Record<string, unknown>[] }).events;
}

describe("deployment, release and status events end to end", () => {
  it("stores and filters on environment, tag and context", async () => {
    const deliveries = [
      ["deployment_status", "deployment_status.created"],
      ["release", "release.published"],
      ["status", "status"],
    ] as const;
    for (const [i, [name, file]] of deliveries.entries()) {
      const event = webhookEvent(name, fixture(file));
      event.headers["x-github-delivery"] = `d-${i}`;
      expect(await route(event, deps)).toEqual({ statusCode: 202 });
    }

    const deploys = await events([preset("deployment:production@main")]);
    expect(deploys).toMatchObject([{ event: "deployment_status", environment: "production" }]);
    expect(await events([preset("deployment:staging")])).toEqual([]);

    expect(await events([preset("release:v1.2.0")])).toMatchObject([{ tag: "v1.2.0" }]);
    expect(await events([preset("release:v9")])).toEqual([]);

    const statuses = await events([preset("status:ci/circleci: build")]);
    expect(statuses).toMatchObject([{ event: "status", context: "ci/circleci: build" }]);
    expect(matches(statuses[0] as never, preset("status:other")!)).toBe(false);
  });
});
