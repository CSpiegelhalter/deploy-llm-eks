import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export class IamKubeAdminStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const accountId = this.account;
    const baseUserName = "curt"; // change to your IAM user name
    const baseUserArn = `arn:aws:iam::${accountId}:user/${baseUserName}`;

    // Role you'll assume locally
    const kubeAdmin = new iam.Role(this, "KubeAdminRole", {
      roleName: "KubeAdmin",
      assumedBy: new iam.ArnPrincipal(baseUserArn), // trust your IAM user (or your base role)
      // While bootstrapping, give admin; tighten later
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"),
      ],
    });

    // Optional: require MFA to assume (good practice)
    kubeAdmin.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ArnPrincipal(baseUserArn)],
        actions: ["sts:AssumeRole"],
        conditions: { Bool: { "aws:MultiFactorAuthPresent": "true" } },
      })
    );

    new cdk.CfnOutput(this, "KubeAdminArn", { value: kubeAdmin.roleArn });
  }
}
