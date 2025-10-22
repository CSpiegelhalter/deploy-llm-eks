// lib/eks-addons-stack.ts
import { Stack, StackProps, Duration } from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

interface Props extends StackProps {
  cluster: eks.Cluster; // <-- only the cluster
}

export class EksAddonsStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const { cluster } = props;

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
    cluster.addHelmChart("alb-controller", {
      repository: "https://aws.github.io/eks-charts",
      chart: "aws-load-balancer-controller",
      namespace: "kube-system",
      release: "aws-load-balancer-controller",
      wait: true,
      atomic: true,
      values: {
        clusterName: cluster.clusterName,
        serviceAccount: { create: false, name: "aws-load-balancer-controller" },
      },
    });

    // Metrics Server
    cluster.addHelmChart("metrics-server", {
      repository: "https://kubernetes-sigs.github.io/metrics-server/",
      chart: "metrics-server",
      namespace: "kube-system",
      release: "metrics-server",
      wait: true,
      atomic: true,
      timeout: Duration.minutes(15),
      values: { args: ["--kubelet-insecure-tls"] },
    });

    // Secrets Store CSI Driver
    const csiDriver = cluster.addHelmChart("secrets-store-csi", {
      repository:
        "https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts",
      chart: "secrets-store-csi-driver",
      namespace: "kube-system",
      release: "secrets-store-csi-driver",
      wait: true,
      atomic: true,
      values: { syncSecret: { enabled: true } },
    });

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
      repository: "https://charts.karpenter.sh",
      chart: "karpenter",
      namespace: "karpenter",
      release: "karpenter",
      createNamespace: false, // you created the ns already
      wait: false, // 👈 don’t wait for pods/webhook to be ready
      atomic: false, // keep rollback semantics within Helm
      // Pin a known-good version to reduce surprises:
      // version: "0.37.0",
      values: {
        serviceAccount: { create: false, name: "karpenter" },
        settings: { clusterName: cluster.clusterName },
      },
    });
    karpenterChart.node.addDependency(karpSa);


    // NVIDIA plugin (don’t block before GPUs exist)
    cluster.addHelmChart("nvidia-device-plugin", {
      repository: "https://nvidia.github.io/k8s-device-plugin",
      chart: "nvidia-device-plugin",
      namespace: "kube-system",
      release: "nvidia-device-plugin",
      wait: false,
      atomic: true,
    });

    // If you *must* open intra-SG traffic, that mutates the EKS SG (owned by this stack), not the VPC:
    cluster.clusterSecurityGroup.addIngressRule(
      cluster.clusterSecurityGroup,
      ec2.Port.allTraffic(),
      "allow nodes within cluster SG"
    );
  }
}
