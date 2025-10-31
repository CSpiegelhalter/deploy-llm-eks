import { Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

interface Props extends StackProps {
  // Optional: if you want discovery tag, pass a **literal** string (not a Token)
  clusterName?: string;
}

export class NetworkStack extends Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: Props) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "Vpc", { maxAzs: 2, natGateways: 1 });

    this.vpc.privateSubnets.forEach((s) => {
      cdk.Tags.of(s).add("kubernetes.io/role/internal-elb", "1");
    });

    // ✅ REQUIRED for internet-facing ALB
    this.vpc.publicSubnets.forEach((s) => {
      cdk.Tags.of(s).add("kubernetes.io/role/elb", "1");
    });

    // ✅ Cluster discovery tags (controller finds eligible subnets)
    if (props?.clusterName) {
      [...this.vpc.publicSubnets, ...this.vpc.privateSubnets].forEach((s) => {
        cdk.Tags.of(s).add(
          `kubernetes.io/cluster/${props.clusterName!}`,
          "shared"
        );
      });
    }
  }
}
