import {
  Stack,
  StackProps,
  RemovalPolicy,
  SecretValue,
  CfnOutput,
} from "aws-cdk-lib";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

interface Props extends StackProps {
  hfToken: string;
}

export class SecretsStack extends Stack {
  public readonly hfSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    // In prod: prefer Secret.fromSecretNameV2 and populate value out-of-band
    this.hfSecret = new secretsmanager.Secret(this, "HfSecret", {
      secretName: "hf/creds",
      description: "HuggingFace access token",
      secretStringValue: SecretValue.unsafePlainText(props.hfToken),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new CfnOutput(this, "HfSecretArn", { value: this.hfSecret.secretArn });
  }
}
