// ArgoStack.ts
import { Stack, StackProps, Duration } from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import { Construct } from "constructs";

interface Props extends StackProps {
  cluster: eks.Cluster;
  repoUrl: string; // e.g. "https://github.com/CSpiegelhalter/deploy-llm-eks.git"
  targetRevision?: string; // default "main"
  appsPath?: string; // default "k8s/apps"
  argocdPath?: string; // default "k8s/argocd"
}

export class ArgoStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);
    const {
      cluster,
      repoUrl,
      targetRevision = "main",
      appsPath = "k8s/apps",
      argocdPath = "k8s/argocd",
    } = props;

    // 1) Install Argo CD via Helm (ingress disabled; GitOps will create it)
    const argo = cluster.addHelmChart("argo-cd", {
      repository: "https://argoproj.github.io/argo-helm",
      chart: "argo-cd",
      namespace: "argocd",
      release: "argo-cd",
      wait: true,
      atomic: true,
      timeout: Duration.minutes(15),
      values: {
        server: {
          extraArgs: ["--insecure"],
          ingress: { enabled: false },
          service: { servicePort: 80 },
        },
      },
    });

   const rootApp = cluster.addManifest("argocd-root-app", {
     apiVersion: "argoproj.io/v1alpha1",
     kind: "Application",
     metadata: { name: "platform-root", namespace: "argocd" },
     spec: {
       project: "default",
       source: {
         repoURL: props.repoUrl,
         targetRevision: props.targetRevision ?? "main",
         path: "k8s/argocd",
       },
       destination: {
         server: "https://kubernetes.default.svc",
         namespace: "argocd",
       },
       syncPolicy: {
         automated: { prune: true, selfHeal: true },
         syncOptions: ["CreateNamespace=true"],
       },
     },
   });
   rootApp.node.addDependency(argo);

  }
}
