import { access, readFile } from "node:fs/promises";

import { COMMON_HELP, parse } from "../args.ts";
import { createStack, describeStack, updateStack } from "../aws/cfn.ts";
import { updateFunctionCode } from "../aws/lambda.ts";
import { readState, writeState } from "../state.ts";
import type { Command, Ctx } from "../types.ts";
import { zipSingleFile } from "../zip.ts";
import { connect, requireOutputs, withSlash } from "./common.ts";
import { buildParameters, PARAM_FLAGS } from "./deploy-params.ts";

const FLAGS = `Flags:
  --webhook-secret <s>        Webhook secret (default: generated on first deploy, kept after)
  --billing-mode <mode>       PROVISIONED (default) or PAY_PER_REQUEST
  --read-capacity <n>         Provisioned read units
  --write-capacity <n>        Provisioned write units
  --commands <list>           Comma-separated comment commands (default /plan,/fix,/shepherd)`;

const DEPLOY_HELP = `hook-harness deploy [flags]

Creates the stack if absent (otherwise updates it), then uploads packages/relay/dist/index.mjs.
Run \`pnpm build\` first.

${FLAGS}

${COMMON_HELP}`;

const UPDATE_HELP = `hook-harness update [flags]

Like deploy, but fails if the stack does not exist. Unspecified parameters keep their values.

${FLAGS}

${COMMON_HELP}`;

const SPEC = Object.fromEntries(
  Object.keys(PARAM_FLAGS).map((flag) => [flag, { type: "string" as const }]),
);

async function run(args: string[], ctx: Ctx, mode: "deploy" | "update"): Promise<number> {
  const { values } = parse(args, SPEC);
  if (values.help) {
    ctx.out(mode === "deploy" ? DEPLOY_HELP : UPDATE_HELP);
    return 0;
  }
  try {
    await access(ctx.paths.bundle);
  } catch {
    throw new Error(`relay bundle not found at ${ctx.paths.bundle}; run \`pnpm build\` first`);
  }
  const conn = connect(values, ctx);
  const existing = await describeStack(conn.clients.cfn, conn.stack);
  if (!existing && mode === "update") {
    throw new Error(`stack "${conn.stack}" does not exist; use \`hook-harness deploy\``);
  }
  const built = buildParameters(values, existing, () => ctx.randomBytes(32).toString("hex"));
  const stackInput = {
    name: conn.stack,
    templateBody: await readFile(ctx.paths.template, "utf8"),
    parameters: built.parameters,
    maxWaitSeconds: ctx.maxWaitSeconds,
  };
  if (existing) {
    const changed = await updateStack(conn.clients.cfn, stackInput);
    ctx.out(changed ? `Updated stack ${conn.stack}` : `Stack ${conn.stack} template is unchanged`);
  } else {
    await createStack(conn.clients.cfn, stackInput);
    ctx.out(`Created stack ${conn.stack}`);
  }

  const outputs = await requireOutputs(conn);
  const zip = zipSingleFile("index.mjs", await readFile(ctx.paths.bundle));
  await updateFunctionCode(conn.clients.lambda, outputs.FunctionName!, zip, ctx.maxWaitSeconds);
  ctx.out(`Uploaded relay code to ${outputs.FunctionName}`);

  const functionUrl = withSlash(outputs.FunctionUrl!);
  const prior = await readState(ctx.env, conn.stack);
  const secret = built.secret ?? prior?.webhookSecret;
  const path = await writeState(ctx.env, {
    stack: conn.stack,
    ...(conn.region ? { region: conn.region } : {}),
    functionUrl,
    webhookUrl: `${functionUrl}webhook`,
    functionName: outputs.FunctionName!,
    tableName: outputs.TableName!,
    ...(secret ? { webhookSecret: secret } : {}),
    updatedAt: ctx.now().toISOString(),
  });
  ctx.out(`Function URL:        ${functionUrl}`);
  ctx.out(`GitHub webhook URL:  ${functionUrl}webhook`);
  if (built.generated)
    ctx.out(`Webhook secret:      ${built.secret} (shown once; also saved to ${path})`);
  else ctx.out(`State saved to ${path}`);
  return 0;
}

export const deploy: Command = (args, ctx) => run(args, ctx, "deploy");
export const update: Command = (args, ctx) => run(args, ctx, "update");
