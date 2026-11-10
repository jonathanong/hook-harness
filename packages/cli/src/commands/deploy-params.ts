import type { Parameter, Stack } from "@aws-sdk/client-cloudformation";

import { str, UsageError, type Values } from "../args.ts";

/** CLI flag -> template parameter. */
export const PARAM_FLAGS: Record<string, string> = {
  "webhook-secret": "WebhookSecret",
  "billing-mode": "BillingMode",
  "read-capacity": "ReadCapacity",
  "write-capacity": "WriteCapacity",
  commands: "Commands",
};

export interface BuiltParameters {
  parameters: Parameter[];
  /** The secret value when this run chose it (given or generated); undefined when kept. */
  secret: string | undefined;
  generated: boolean;
}

/**
 * Explicit flags win. On an existing stack every other parameter the stack already has keeps its
 * previous value; parameters the old template lacked are omitted so the new default applies.
 * A missing WebhookSecret is generated.
 */
export function buildParameters(
  values: Values,
  existing: Stack | undefined,
  generateSecret: () => string,
): BuiltParameters {
  const billing = str(values, "billing-mode");
  if (billing !== undefined && billing !== "PROVISIONED" && billing !== "PAY_PER_REQUEST") {
    throw new UsageError("--billing-mode must be PROVISIONED or PAY_PER_REQUEST");
  }
  const previous = new Set((existing?.Parameters ?? []).map((p) => p.ParameterKey));
  const parameters: Parameter[] = [];
  let secret: string | undefined;
  let generated = false;
  for (const [flag, key] of Object.entries(PARAM_FLAGS)) {
    const given = str(values, flag);
    if (given !== undefined) {
      parameters.push({ ParameterKey: key, ParameterValue: given });
      if (key === "WebhookSecret") secret = given;
    } else if (previous.has(key)) {
      parameters.push({ ParameterKey: key, UsePreviousValue: true });
    } else if (key === "WebhookSecret") {
      secret = generateSecret();
      generated = true;
      parameters.push({ ParameterKey: key, ParameterValue: secret });
    }
  }
  return { parameters, secret, generated };
}
