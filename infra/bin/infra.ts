#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/network-stack";
import { GithubOidcStack } from "../lib/github-oidc-stack";
import { EcrStack } from "../lib/ecr-stack";
import { SecretsStack } from "../lib/secrets-stack";
import { EksClusterStack } from "../lib/eks-stack";
import { EksAddonsStack } from "../lib/eks-addons-stack";
import { ArgoStack } from "../lib/argo-stack";
import { IamKubeAdminStack } from "../lib/iam-prereqs-stack";

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};
const clusterName = app.node.tryGetContext("clusterName") ?? "llm-eks";

new GithubOidcStack(app, "GithubOidcStack", {
  env,
  repoOwner: "CSpiegelhalter",
  repoName: "deploy-llm-eks",
  branch: "main",
});

const network = new NetworkStack(app, "NetworkStack", { env, clusterName });

new EcrStack(app, "EcrStack", { env });
new SecretsStack(app, "SecretsStack", {
  env,
  hfToken: app.node.tryGetContext("hfToken") ?? "CHANGE_ME_BEFORE_PROD",
});

const iamStack = new IamKubeAdminStack(app, "IamStack", { env });

const eks = new EksClusterStack(app, "EksClusterStack", {
  env,
  vpc: network.vpc,
  clusterName,
});
eks.addDependency(iamStack);

const addons = new EksAddonsStack(app, "EksAddonsStack", {
  env,
  cluster: eks.cluster,
  clusterEndpoint: eks.clusterEndpoint,
});
addons.addDependency(eks);

const argo = new ArgoStack(app, "ArgoStack", {
  env,
  cluster: eks.cluster,
  repoUrl: "https://github.com/CSpiegelhalter/deploy-llm-eks.git",
  targetRevision: "main",
  appsPath: "k8s/apps",
});
argo.addDependency(addons);
