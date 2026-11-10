import {
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackDeleteComplete,
  waitUntilStackUpdateComplete,
  type CloudFormationClient,
  type Parameter,
  type Stack,
} from "@aws-sdk/client-cloudformation";

export type Outputs = Record<string, string>;

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "ValidationError" &&
    /does not exist/.test(error.message)
  );
}

export async function describeStack(
  client: CloudFormationClient,
  name: string,
): Promise<Stack | undefined> {
  try {
    const result = await client.send(new DescribeStacksCommand({ StackName: name }));
    return result.Stacks?.[0];
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export function outputsOf(stack: Stack): Outputs {
  const outputs: Outputs = {};
  for (const output of stack.Outputs ?? []) {
    if (output.OutputKey && output.OutputValue) outputs[output.OutputKey] = output.OutputValue;
  }
  return outputs;
}

interface StackInput {
  name: string;
  templateBody: string;
  parameters: Parameter[];
  maxWaitSeconds: number;
}

export async function createStack(client: CloudFormationClient, input: StackInput): Promise<void> {
  await client.send(
    new CreateStackCommand({
      StackName: input.name,
      TemplateBody: input.templateBody,
      Parameters: input.parameters,
      Capabilities: ["CAPABILITY_IAM"],
    }),
  );
  await waitUntilStackCreateComplete(
    { client, maxWaitTime: input.maxWaitSeconds },
    { StackName: input.name },
  );
}

/** Returns false when CloudFormation reports nothing to change. */
export async function updateStack(
  client: CloudFormationClient,
  input: StackInput,
): Promise<boolean> {
  try {
    await client.send(
      new UpdateStackCommand({
        StackName: input.name,
        TemplateBody: input.templateBody,
        Parameters: input.parameters,
        Capabilities: ["CAPABILITY_IAM"],
      }),
    );
  } catch (error) {
    if (error instanceof Error && /No updates are to be performed/.test(error.message))
      return false;
    throw error;
  }
  await waitUntilStackUpdateComplete(
    { client, maxWaitTime: input.maxWaitSeconds },
    { StackName: input.name },
  );
  return true;
}

export async function deleteStack(
  client: CloudFormationClient,
  name: string,
  maxWaitSeconds: number,
): Promise<void> {
  await client.send(new DeleteStackCommand({ StackName: name }));
  await waitUntilStackDeleteComplete({ client, maxWaitTime: maxWaitSeconds }, { StackName: name });
}
