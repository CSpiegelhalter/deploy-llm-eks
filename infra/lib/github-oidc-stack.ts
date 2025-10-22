// lib/github-oidc-stack.ts
import { Stack, StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface Props extends StackProps {
  repoOwner: string;
  repoName: string;
  branch: string;
}

export class GithubOidcStack extends Stack {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    // 👇 Pin GitHub’s OIDC thumbprints so CDK doesn’t do a network lookup
    const ghOidc = new iam.OpenIdConnectProvider(this, "GithubProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
      thumbprints: [
        "6938fd4d98bab03faadb97b34396831e3780aea1",
        "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
      ],
    });

    const sub = `repo:${props.repoOwner}/${props.repoName}:ref:refs/heads/${props.branch}`;

    this.role = new iam.Role(this, "GithubActionsRole", {
      roleName: "GithubOIDCRole",
      assumedBy: new iam.WebIdentityPrincipal(ghOidc.openIdConnectProviderArn, {
        StringLike: { "token.actions.githubusercontent.com:sub": sub },
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
      }),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"),
      ],
    });
  }
}
