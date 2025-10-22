import { Stack, StackProps } from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import { Construct } from "constructs";

interface Props extends StackProps {
  cluster: eks.Cluster;

  // Where Argo CD should read your k8s apps from:
  repoUrl: string; // e.g. "https://github.com/your-user/your-repo.git"
  targetRevision?: string; // e.g. "main" (defaulted below)
  appsPath?: string; // e.g. "k8s/apps" (defaulted below)

  // Optional: create a public ALB Ingress for the Argo UI
  exposeArgoUi?: boolean;
  argoUiHost?: string; // optional DNS host; omit to use the ALB hostname
  acmCertificateArn?: string; // optional ACM for HTTPS
}

export class ArgoStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const {
      cluster,
      repoUrl,
      targetRevision = "main",
      appsPath = "k8s/apps",
      exposeArgoUi = false,
      argoUiHost,
      acmCertificateArn,
    } = props;

    // 1) Install Argo CD via Helm
    const argo = cluster.addHelmChart("argo-cd", {
      repository: "https://argoproj.github.io/argo-helm",
      chart: "argo-cd",
      namespace: "argocd",
      release: "argo-cd",
      wait: true,
      atomic: true,
      // create the namespace automatically (CDK v2 supports this on addHelmChart)
      createNamespace: true as any, // some typings miss this; it's supported by the underlying call
      values: {
        server: { extraArgs: ["--insecure"] }, // behind ALB; add TLS later if you want
      },
    });

    // 2) Root "App-of-Apps" Application: tells Argo CD to watch your repo's k8s/apps folder
    const rootApp = cluster.addManifest("argocd-root-app", {
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Application",
      metadata: { name: "platform-root", namespace: "argocd" },
      spec: {
        project: "default",
        source: {
          repoURL: repoUrl,
          targetRevision,
          path: appsPath, // <--- points at k8s/apps
        },
        destination: {
          server: "https://kubernetes.default.svc",
          namespace: "argocd",
        },
        syncPolicy: {
          automated: { prune: true, selfHeal: true },
          // Let Argo create target namespaces defined by child apps
          syncOptions: ["CreateNamespace=true"],
        },
      },
    });
    // Ensure the Argo CD CRDs exist before applying the Application
    rootApp.node.addDependency(argo);

    // 3) (Optional) Public ALB Ingress for Argo CD UI
    if (exposeArgoUi) {
      const annotations: Record<string, string> = {
        "kubernetes.io/ingress.class": "alb",
        "alb.ingress.kubernetes.io/scheme": "internet-facing",
        "alb.ingress.kubernetes.io/target-type": "ip",
        // start with HTTP only; add ACM below if provided
        "alb.ingress.kubernetes.io/listen-ports": '[{"HTTP":80}]',
      };
      if (acmCertificateArn) {
        annotations["alb.ingress.kubernetes.io/listen-ports"] =
          '[{"HTTP":80},{"HTTPS":443}]';
        annotations["alb.ingress.kubernetes.io/certificate-arn"] =
          acmCertificateArn;
        annotations["alb.ingress.kubernetes.io/actions.ssl-redirect"] =
          '{"Type":"redirect","RedirectConfig":{"Protocol":"HTTPS","Port":"443","StatusCode":"HTTP_301"}}';
      }

      const argoUiIngress = cluster.addManifest("argocd-ui-ingress", {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: {
          name: "argocd-ui",
          namespace: "argocd",
          annotations,
        },
        spec: {
          ingressClassName: "alb",
          rules: [
            {
              host: argoUiHost, // can be undefined; ALB DNS works without a host
              http: {
                paths: [
                  {
                    path: "/",
                    pathType: "Prefix",
                    backend: {
                      service: { name: "argocd-server", port: { number: 80 } },
                    },
                  },
                ],
              },
            },
          ],
        },
      });
      argoUiIngress.node.addDependency(argo);
    }
  }
}
