// lib/eks-addons-stack.ts
import { Stack, StackProps, Duration } from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import { EKSClient, DescribeClusterCommand } from "@aws-sdk/client-eks";


interface Props extends StackProps {
  cluster: eks.Cluster; // <-- only the cluster
  clusterEndpoint: string;
}

export async function getClusterEndpoint(
  clusterName: string,
  region: string
): Promise<string> {
  const client = new EKSClient({ region });
  const resp = await client.send(
    new DescribeClusterCommand({ name: clusterName })
  );
  if (!resp.cluster?.endpoint)
    throw new Error("EKS cluster endpoint not found");
  return resp.cluster.endpoint;
}


export class EksAddonsStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const { cluster, clusterEndpoint } = props;


    const nsKarpenter = cluster.addManifest("ns-karpenter", {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: "karpenter" },
    });

    // ALB Controller (IRSA + Helm)
    const albSa = cluster.addServiceAccount("alb-sa", {
      name: "aws-load-balancer-controller",
      namespace: "kube-system",
    });
    albSa.addToPrincipalPolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: [
          "acm:DescribeCertificate",
          "acm:ListCertificates",
          "acm:GetCertificate",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:CreateSecurityGroup",
          "ec2:CreateTags",
          "ec2:DeleteTags",
          "ec2:DeleteSecurityGroup",
          "ec2:Describe*",
          "ec2:RevokeSecurityGroupIngress",
          "elasticloadbalancing:*",
          "iam:CreateServiceLinkedRole",
          "waf-regional:*",
          "wafv2:*",
          "shield:*",
          "tag:GetResources",
          "tag:TagResources",
        ],
      })
    );
    const albChart = cluster.addHelmChart("alb-controller", {
      repository: "https://aws.github.io/eks-charts",
      chart: "aws-load-balancer-controller",
      namespace: "kube-system",
      createNamespace: false,
      release: "aws-load-balancer-controller",
      wait: true,
      timeout: Duration.minutes(15),
      atomic: true,
      values: {
        clusterName: cluster.clusterName,
        serviceAccount: { create: false, name: "aws-load-balancer-controller" },
      },
    });

    // Metrics Server
    const metricsChart = cluster.addHelmChart("metrics-server", {
      repository: "https://kubernetes-sigs.github.io/metrics-server/",
      chart: "metrics-server",
      namespace: "kube-system",
      release: "metrics-server",
      wait: true,
      timeout: Duration.minutes(15),
      atomic: true,
      values: { args: ["--kubelet-insecure-tls"] },
    });
    metricsChart.node.addDependency(albChart);

    // Secrets Store CSI Driver
    const csiDriver = cluster.addHelmChart("secrets-store-csi-driver", {
      repository:
        "https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts",
      chart: "secrets-store-csi-driver",
      namespace: "kube-system",
      release: "secrets-store-csi-driver",
      wait: true,
      timeout: Duration.minutes(15),
      atomic: true,
      values: { syncSecret: { enabled: true } },
    });
    csiDriver.node.addDependency(metricsChart);

    // AWS provider (disable subchart; unique SA)
    const csiAws = cluster.addHelmChart("csi-aws-provider", {
      repository: "https://aws.github.io/secrets-store-csi-driver-provider-aws",
      chart: "secrets-store-csi-driver-provider-aws",
      namespace: "kube-system",
      release: "csi-aws-provider",
      wait: true,
      atomic: true,
      values: {
        "secrets-store-csi-driver": { install: false },
        fullnameOverride: "csi-aws-provider",
        nameOverride: "csi-aws-provider",
        serviceAccount: { create: true, name: "csi-aws-provider" },
      },
    });
    csiAws.node.addDependency(csiDriver);
    csiAws.node.addDependency(metricsChart);

    // Karpenter IRSA (minimal; replace with least-priv JSON for prod)
    const karpSa = cluster.addServiceAccount("karpenter-sa", {
      name: "karpenter",
      namespace: "karpenter",
    });
    karpSa.node.addDependency(nsKarpenter);
    karpSa.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );
    karpSa.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "ec2:CreateLaunchTemplate",
          "ec2:DeleteLaunchTemplate",
          "ec2:CreateFleet",
          "ec2:RunInstances",
          "ec2:TerminateInstances",
          "ec2:CreateTags",
          "ec2:Describe*",
          "ssm:GetParameter",
          "iam:PassRole",
          "pricing:GetProducts",
        ],
        resources: ["*"],
      })
    );

    // Karpenter (Helm)
   const karpenterChart = cluster.addHelmChart("karpenter", {
     repository: "oci://public.ecr.aws/karpenter/karpenter",
     chart: "karpenter",
     version: "1.2.3",
     namespace: "karpenter",
     release: "karpenter",
     wait: false,
     atomic: false,
     values: {
       serviceAccount: { create: false, name: "karpenter" },
       controller: {
         env: [
           { name: "CLUSTER_NAME", value: cluster.clusterName },
           { name: "CLUSTER_ENDPOINT", value: clusterEndpoint },
         ],
       },
     },
   });

    karpenterChart.node.addDependency(csiAws);
    karpenterChart.node.addDependency(karpSa);
    karpenterChart.node.addDependency(albChart);

    // NVIDIA plugin (don’t block before GPUs exist)
    const nvidiaChart = cluster.addHelmChart("nvidia-device-plugin", {
      repository: "https://nvidia.github.io/k8s-device-plugin",
      chart: "nvidia-device-plugin",
      namespace: "kube-system",
      release: "nvidia-device-plugin",
      wait: false,
      atomic: true,
    });
    nvidiaChart.node.addDependency(karpenterChart);

    // If you *must* open intra-SG traffic, that mutates the EKS SG (owned by this stack), not the VPC:
    cluster.clusterSecurityGroup.addIngressRule(
      cluster.clusterSecurityGroup,
      ec2.Port.allTraffic(),
      "allow nodes within cluster SG"
    );
  }
}
