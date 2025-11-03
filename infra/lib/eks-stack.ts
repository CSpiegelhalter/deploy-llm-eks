import { CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as eks from "aws-cdk-lib/aws-eks";
import { KubectlV33Layer } from "@aws-cdk/lambda-layer-kubectl-v33";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";

interface Props extends StackProps {
  vpc: ec2.IVpc;
  clusterName: string; // <--
}

export class EksClusterStack extends Stack {
  public readonly cluster: eks.Cluster;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    this.cluster = new eks.Cluster(this, "Eks", {
      version: eks.KubernetesVersion.V1_32,
      vpc: props.vpc,
      clusterName: props.clusterName,
      defaultCapacity: 0,
      endpointAccess:
        eks.EndpointAccess.PUBLIC_AND_PRIVATE.onlyFrom("104.60.52.105/32"), // my home IP (change to use a VPN instead)
      kubectlLayer: new KubectlV33Layer(this, "KubectlLayer"),
    });


    const roleArn = `arn:aws:iam::${this.account}:role/KubeAdmin`;

    const kubeAdminRole = iam.Role.fromRoleArn(this, "KubeAdminRef", roleArn, {
      mutable: false,
    });

    this.cluster.awsAuth.addRoleMapping(kubeAdminRole, {
      username: "admin:{{SessionName}}",
      groups: ["system:masters"],
    });


    const karpenterNodeRole = new iam.Role(this, "KarpenterNodeRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSWorkerNodePolicy"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKS_CNI_Policy"),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonEC2ContainerRegistryReadOnly"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
      ],
    });
    new CfnOutput(this, "KarpenterNodeRoleArn", {
      value: karpenterNodeRole.roleArn,
    });
  }
}
