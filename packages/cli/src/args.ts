import { parseArgs } from "node:util";

/** Thrown for bad invocations; printed without a stack trace. */
export class UsageError extends Error {}

export type Values = Record<string, string | boolean | undefined>;
type Spec = Record<string, { type: "string" | "boolean"; short?: string }>;

const COMMON: Spec = {
  region: { type: "string" },
  profile: { type: "string" },
  stack: { type: "string" },
  help: { type: "boolean", short: "h" },
};

export function parse(args: string[], spec: Spec = {}): { values: Values; positionals: string[] } {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { ...COMMON, ...spec },
      allowPositionals: true,
      strict: true,
    });
    return { values: values as Values, positionals };
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

export function str(values: Values, key: string): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

export const COMMON_HELP = `Common flags:
  --stack <name>     CloudFormation stack name (default hook-harness)
  --region <region>  AWS region (default: AWS_REGION / profile config)
  --profile <name>   AWS profile (default: AWS_PROFILE)
  -h, --help         Show help`;
