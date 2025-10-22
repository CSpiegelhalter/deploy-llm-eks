import { Stack, StackProps, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";

export class EcrStack extends Stack {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.repository = new ecr.Repository(this, "ApiRepo", {
      repositoryName: "fastapi-model",
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    new CfnOutput(this, "ApiRepoUri", { value: this.repository.repositoryUri });
  }
}
