# lw-idp P2.1.2 — sample-nginx onboarding (Jenkins CI + Argo CD CD)

**Status:** approved (2026-04-29)
**Predecessors:**
- `2026-04-27-lw-idp-p2.0-argocd-observability-design.md` (Argo CD + deploy panel + ApplicationSet)
- P2.1.0 — Jenkins install + Dex SSO (PR #14)
- P2.1.1 — gateway Jenkins proxy + Builds tab (PR #15)
- P2.1.1.1 — Jenkins API token automated via JCasC init.groovy (PR #15)

## 1. Goal

Onboard a sample web app (`sample-nginx`) end-to-end through the IDP so a
visitor of the dev cluster can browse `http://sample.lw-idp.local/` and
see a static page that was built and deployed entirely by the IDP's own
machinery: **Jenkins as CI, Argo CD as CD, and the IDP UI as the
single pane of glass.**

This is the first dogfooded *user* application — every prior workload in
the cluster is the IDP itself. After this, "register a service" becomes
a real, demonstrable workflow rather than just a UI flow with no
production data.

## 2. Architecture (one paragraph)

A separate GitHub repo `abhikk30/idp-sample-nginx` holds the source
(Dockerfile + index.html), a Jenkinsfile, and a Helm chart. Jenkins's
kubernetes-plugin agent runs each build inside the kind cluster as a
kaniko pod, pushes the image to the in-cluster registry container
(`kind-registry:5000`), then bumps the chart's `image.tag` in the same
repo and pushes the commit back to `main`. Argo CD watches that repo's
`chart/` path; on each values change it auto-syncs to a dedicated
`sample-nginx` namespace. The IDP catalogs the service the same way it
catalogs itself — through the existing P2.0.5 "Register App" UI flow.

## 3. The new repo (`idp-sample-nginx`)

```
.
├── Dockerfile           # FROM nginx:alpine + COPY html/ /usr/share/nginx/html/
├── Jenkinsfile          # see §6
├── html/
│   └── index.html       # static page; visible content includes a build SHA marker
├── chart/
│   ├── Chart.yaml
│   ├── values.yaml      # image.repository + image.tag (Jenkins rewrites tag)
│   └── templates/
│       ├── deployment.yaml   # 1 replica, /healthz via nginx default index
│       ├── service.yaml      # ClusterIP :80
│       └── ingress.yaml      # host: sample.lw-idp.local, ingressClass: nginx
└── README.md            # how to land a change end-to-end
```

`chart/values.yaml`:

```yaml
image:
  repository: localhost:5001/lw-idp/sample-nginx
  tag: "<sha>"            # Jenkins rewrites this line on every build
  pullPolicy: IfNotPresent
service:
  port: 80
ingress:
  enabled: true
  host: sample.lw-idp.local
  className: nginx
```

`image.repository` uses `localhost:5001/...` because that's the address
the kind nodes' containerd mirror resolves at pull time
(`infra/kind/dev.yaml` maps `localhost:5001` → `http://kind-registry:5000`).
Kaniko, running inside a pod on the kind network, **pushes** to
`kind-registry:5000/lw-idp/sample-nginx:<tag>` directly — both
addresses point to the same image content.

## 4. The image-tag bump loop (key design decision)

The whole CI/CD demo collapses if the chart's `image.tag` doesn't move.
The simplest robust mechanism is **Jenkins commits the bumped tag back
to git** — Argo CD's manifest-watch handles everything else.

Alternatives considered and rejected:
- **Argo CD Image Updater** — write-back to git is more moving parts
  than a single `sed` line in the Jenkinsfile, and we'd need a separate
  controller install + per-app annotations.
- **Jenkins triggers Argo CD sync via REST** — bypasses the GitOps
  invariant ("git is the desired state"); local manifest stays stale.
- **Mutable tags** (e.g. `:latest` always) — Argo CD never sees a
  manifest change, doesn't roll, and the kubelet doesn't repull on
  Helm noop. Defeats GitOps.

The bump is a 3-line shell block at the end of the Jenkinsfile:

```bash
sed -i "s|^  tag: .*|  tag: \"${IMAGE_TAG}\"|" chart/values.yaml
git add chart/values.yaml
git -c user.email=jenkins@lw-idp.local -c user.name=jenkins commit -m "chore: bump image.tag to ${IMAGE_TAG} [skip ci]"
git push https://x-access-token:${GITHUB_PAT}@github.com/abhikk30/idp-sample-nginx.git HEAD:main
```

`[skip ci]` in the commit message prevents Jenkins from triggering
itself on the bump commit (otherwise: infinite loop). This is honored
by the Jenkins git plugin's "Polling ignores commits with certain
messages" setting, which we configure in the seeded job.

## 5. Jenkins side (in `lw-idp` monorepo)

### 5.1 Enable the kubernetes agent

Currently `agent.enabled: false` in `infra/jenkins/values.yaml`. Flip
to `true`, set:

```yaml
agent:
  enabled: true
  podName: jenkins-agent
  defaultsProviderTemplate: ""
  customJenkinsLabels: []
  resources:
    requests: { cpu: 250m, memory: 256Mi }
    limits:   { cpu: 1000m, memory: 1Gi }
```

The chart provisions a default JNLP-agent pod template. Builds that
need kaniko declare a per-build pod template inline in the Jenkinsfile
(see §6).

### 5.2 GitHub PAT for push-back

The user creates a fine-grained PAT scoped to
`abhikk30/idp-sample-nginx` with **Contents: read+write** and pastes it
into:

```bash
kubectl -n jenkins create secret generic jenkins-github-pat \
  --from-literal=GITHUB_PAT=<token>
```

This is a **manual one-time step** because:
- We can't safely commit a real PAT to bootstrap.
- Auto-bootstrap would need a secrets manager (P1.9 direction —
  Vault/ESO — not in scope here).

The runbook covers rotation. The Jenkins controller mounts
`GITHUB_PAT` as an env var from this Secret (added to `containerEnv`
in `infra/jenkins/values.yaml`, alongside the existing OIDC and
service-token entries):

```yaml
- name: GITHUB_PAT
  valueFrom:
    secretKeyRef:
      name: jenkins-github-pat
      key: GITHUB_PAT
      optional: true   # boots cleanly before the user creates the Secret
```

JCasC then exposes the env var as a Jenkins **string** credential id
`github-pat`, which the Jenkinsfile binds via the standard
`withCredentials([string(credentialsId: 'github-pat', …)])` block:

```yaml
credentials:
  system:
    domainCredentials:
      - credentials:
          - string:
              scope: GLOBAL
              id: github-pat
              secret: "${GITHUB_PAT}"
              description: "GitHub PAT for idp-sample-nginx push-back"
```

If the env var is empty (Secret absent), the credential resolves to
empty and the build fails at the `git push` step with a clear error —
runbook directs the user to re-create the Secret.

### 5.3 Job seeded via JCasC + `job-dsl`

`job-dsl` is already installed (per `infra/jenkins/values.yaml`
`installPlugins`). We add a JCasC config block that runs a job-dsl
script at startup to seed a Pipeline job named `sample-nginx`:

```groovy
pipelineJob('sample-nginx') {
  description('CI for github.com/abhikk30/idp-sample-nginx')
  definition {
    cpsScm {
      scm {
        git {
          remote { url('https://github.com/abhikk30/idp-sample-nginx.git') }
          branches('*/main')
          extensions {
            cleanBeforeCheckout()
            // Don't trigger on Jenkins's own bump commits.
            messageExclusion {
              excludedMessage('^chore: bump image\\.tag.*\\[skip ci\\]$')
            }
          }
        }
        scriptPath('Jenkinsfile')
      }
    }
  }
  triggers {
    scm('H/2 * * * *')   // poll every ~2 min in dev; webhook later
  }
}
```

Idempotent: each Jenkins start re-applies the DSL. Editing the DSL
amounts to editing values.yaml and re-syncing helmfile.

## 6. The Jenkinsfile (in `idp-sample-nginx`)

```groovy
pipeline {
  agent {
    kubernetes {
      yaml '''
        apiVersion: v1
        kind: Pod
        spec:
          containers:
            - name: kaniko
              image: gcr.io/kaniko-project/executor:debug
              imagePullPolicy: IfNotPresent
              command: ["/busybox/cat"]
              tty: true
            - name: git
              image: alpine/git:latest
              command: ["cat"]
              tty: true
      '''
    }
  }

  environment {
    REGISTRY     = 'kind-registry:5000'
    IMAGE_REPO   = 'lw-idp/sample-nginx'
    IMAGE_TAG    = "${env.GIT_COMMIT?.take(7) ?: env.BUILD_NUMBER}"
  }

  stages {
    stage('Build & push') {
      steps {
        container('kaniko') {
          sh '''
            /kaniko/executor \
              --dockerfile=Dockerfile \
              --context=. \
              --destination=${REGISTRY}/${IMAGE_REPO}:${IMAGE_TAG} \
              --insecure --skip-tls-verify
          '''
        }
      }
    }

    stage('Bump GitOps tag') {
      steps {
        container('git') {
          withCredentials([string(credentialsId: 'github-pat', variable: 'GITHUB_PAT')]) {
            sh '''
              git config user.email jenkins@lw-idp.local
              git config user.name jenkins
              sed -i "s|^  tag:.*|  tag: \\"${IMAGE_TAG}\\"|" chart/values.yaml
              git add chart/values.yaml
              git diff --cached --quiet && exit 0
              git commit -m "chore: bump image.tag to ${IMAGE_TAG} [skip ci]"
              git push https://x-access-token:${GITHUB_PAT}@github.com/abhikk30/idp-sample-nginx.git HEAD:main
            '''
          }
        }
      }
    }
  }
}
```

The "Bump GitOps tag" stage exits cleanly (`git diff --cached --quiet`)
when nothing changed — re-running the same build is a no-op.

## 7. Argo CD side

A new Argo CD `Application` CR — registered through the IDP's existing
"Register App" UI flow (so we dogfood the registration code path), or
via `kubectl apply` if the UI hits a snag. The CR shape:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: sample-nginx
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/abhikk30/idp-sample-nginx.git
    targetRevision: main
    path: chart
    helm:
      releaseName: sample-nginx
  destination:
    server: https://kubernetes.default.svc
    namespace: sample-nginx
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

`automated` + `selfHeal` keep the cluster pinned to git desired state;
the manual "Sync now" button in the IDP's Deploys panel is still
useful for force-refresh.

## 8. IDP catalog wiring

After Argo CD has synced once, the user opens the IDP Services list,
clicks **Register App**, picks `sample-nginx` from the imported list
(P2.0.5 import flow), and assigns:

- **Owner team:** `lw-idp-platform` (or whatever team exists)
- **Jenkins job:** `sample-nginx` (matches §5.3)

That writes a row in `catalog-svc.services` plus the Jenkins-job
linkage in `catalog-svc.service_jenkins_jobs` (already in P2.1.1
schema). No new tables.

After registration:
- **Services list** — `sample-nginx` appears with a green status pill.
- **Service detail / Deploys tab** — Argo CD app summary, recent syncs,
  Sync / Hard Sync buttons.
- **Service detail / Builds tab** — Jenkins job summary, last 10 runs,
  Trigger Build button.
- `http://sample.lw-idp.local/` — the actual page.

## 9. DNS

`sample.lw-idp.local` resolves the same way `jenkins.lw-idp.local` and
`portal.lw-idp.local` do — via the `/etc/hosts` line the user already
has (one-line addition, `127.0.0.1 sample.lw-idp.local`) plus the
in-cluster CoreDNS rewrite that bootstrap configures.

We extend `scripts/cluster-bootstrap.sh`'s CoreDNS patch to include
`sample.lw-idp.local` so cluster-internal lookups (e.g. argocd-server
posting back) also resolve.

## 10. Failure modes & guardrails

| Failure | Symptom | Mitigation |
|---|---|---|
| Kaniko can't reach kind-registry | Build fails, "no such host" | Already on the kind network — verified by other lw-idp images |
| Jenkins pushes back, triggers itself | Infinite-loop builds | `[skip ci]` exclusion in job-dsl + commit message |
| PAT missing or wrong scope | "git push" 403 in build log | Build fails loudly; runbook step covers re-issue |
| Argo CD pulls before image is pushed | Pod ImagePullBackOff (briefly) | Jenkins push completes before commit; commit triggers Argo, Argo pulls. Race window negligible. |
| Two builds racing | Conflicting tag commits | Single-replica controller; default Jenkins is FIFO. Concurrent same-job runs disabled in the seeded job. |
| `chart/values.yaml` schema drift | sed no-op, tag never bumps | Jenkinsfile fails the build if `git diff --cached --quiet` finds nothing **after** the sed (added in implementation). |

## 11. Out of scope (this iteration)

- GitHub webhook → Jenkins (instead of polling). Polling at 2 min is
  enough for a demo; webhook lands when we wire ngrok/cloudflared in
  a later phase.
- Image vulnerability scanning (Trivy in Jenkins).
- Multi-environment promotion (dev → stage → prod). Single namespace
  for now.
- Notifications on failed builds. Existing argocd-notifications
  fanout covers deploy events; build-event fanout from Jenkins is a
  separate plugin install — defer to P2.2.
- Retiring the `sample-nginx` job via deregister. The "remove from
  IDP" path exists (P2.0.5); we don't need a Jenkins-side delete in
  this phase.

## 12. Done definition

1. `idp-sample-nginx` repo has Dockerfile, Jenkinsfile, html, chart, README.
2. `agent.enabled: true` and JCasC seeds the `sample-nginx` Pipeline job.
3. `kubectl -n jenkins create secret generic jenkins-github-pat …` is
   the only manual one-time step (documented in a runbook).
4. Pushing a commit to `idp-sample-nginx@main` triggers a Jenkins
   build within ~2 min. Build runs kaniko, pushes image, bumps
   `chart/values.yaml`, pushes back. Build duration < 2 min on a
   warm agent.
5. Argo CD detects the bump, syncs `sample-nginx`, pod runs.
6. `curl http://sample.lw-idp.local/` returns the HTML — content
   includes the short-SHA so we can prove the new build is live.
7. The IDP Services list shows `sample-nginx` with green status; its
   detail page Deploys tab and Builds tab both show the new
   build/deploy.

## 13. Risks worth calling out before implementation

- **Kaniko's TLS skip flags** — we're pushing to an insecure HTTP
  registry by design. `--insecure --skip-tls-verify` is correct for
  dev; we'll need to revisit when registries are real.
- **Job-dsl script approval** — Jenkins's script security might
  require admin approval the first time the DSL runs. The init.groovy
  pattern from P2.1.1.1 can pre-approve via `ScriptApproval`; if it
  trips us, we add a one-line approval to the existing init script.
- **Argo CD GitHub credentials** — public repo, no creds needed for
  Argo CD's read. If we ever flip the repo to private, Argo CD needs
  a separate read-only credential. Not in scope now; documented as a
  risk.
