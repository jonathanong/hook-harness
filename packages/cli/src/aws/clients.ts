import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export interface Clients {
  cfn: CloudFormationClient;
  lambda: LambdaClient;
  ddb: DynamoDBDocumentClient;
}

export interface ClientOptions {
  region?: string | undefined;
  profile?: string | undefined;
}

/** Default credential chain. `profile` is applied through AWS_PROFILE so the SDK resolves it. */
export function createClients(options: ClientOptions, env: NodeJS.ProcessEnv): Clients {
  if (options.profile) env.AWS_PROFILE = options.profile;
  const config = options.region ? { region: options.region } : {};
  return {
    cfn: new CloudFormationClient(config),
    lambda: new LambdaClient(config),
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient(config)),
  };
}
