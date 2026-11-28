import { describe, expect, it } from "vitest";

import { ctx, fixture } from "../test-helpers/fixture.ts";
import { deployment, deploymentStatus, release } from "./delivery.ts";

describe("deployments", () => {
  it("normalizes a created deployment", () => {
    const envelope = deployment(fixture("deployment.created"), ctx);
    expect(envelope).toMatchObject({
      event: "deployment",
      action: "created",
      headSha: "abc123",
      headRef: "main",
      environment: "production",
      sender: { login: "vercel[bot]", type: "Bot" },
    });
    expect(JSON.stringify(envelope)).not.toContain("SECRET");
  });

  it("maps a deployment status's state to conclusion and keeps its environment", () => {
    const envelope = deploymentStatus(fixture("deployment_status.created"), ctx);
    expect(envelope).toMatchObject({
      event: "deployment_status",
      headSha: "abc123",
      headRef: "main",
      environment: "production",
      conclusion: "success",
      url: "https://app-abc.vercel.app",
    });
    expect(JSON.stringify(envelope)).not.toContain("SECRET");
  });

  it("falls back to the deployment's environment and the environment URL", () => {
    const payload = fixture("deployment_status.created");
    payload.deployment_status = { state: "failure", target_url: "", environment_url: "https://e" };
    expect(deploymentStatus(payload, ctx)).toMatchObject({
      environment: "production",
      conclusion: "failure",
      url: "https://e",
    });
    payload.deployment_status = { state: "error" };
    expect(deploymentStatus(payload, ctx).url).toBeNull();
  });
});

describe("release", () => {
  it("normalizes a published release", () => {
    const envelope = release(fixture("release.published"), ctx);
    expect(envelope).toMatchObject({
      event: "release",
      action: "published",
      tag: "v1.2.0",
      headRef: "main",
      url: "https://github.com/o/r/releases/tag/v1.2.0",
    });
    expect(JSON.stringify(envelope)).not.toContain("SECRET");
  });
});
