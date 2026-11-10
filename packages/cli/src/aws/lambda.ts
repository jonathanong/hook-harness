import {
  GetFunctionConfigurationCommand,
  UpdateFunctionCodeCommand,
  waitUntilFunctionUpdatedV2,
  type LambdaClient,
} from "@aws-sdk/client-lambda";

/** Uploads a zip and waits until `LastUpdateStatus` is Successful. */
export async function updateFunctionCode(
  client: LambdaClient,
  functionName: string,
  zip: Buffer,
  maxWaitSeconds: number,
): Promise<void> {
  await client.send(new UpdateFunctionCodeCommand({ FunctionName: functionName, ZipFile: zip }));
  await waitUntilFunctionUpdatedV2(
    { client, maxWaitTime: maxWaitSeconds },
    { FunctionName: functionName },
  );
}

export async function lastModified(
  client: LambdaClient,
  functionName: string,
): Promise<string | undefined> {
  const config = await client.send(
    new GetFunctionConfigurationCommand({ FunctionName: functionName }),
  );
  return config.LastModified;
}
