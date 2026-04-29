# lw-idp P2.1.2 — sample-nginx onboarding implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-29-lw-idp-sample-nginx-design.md`

**Goal:** Onboard a real sample app (`sample-nginx`) end-to-end through the lw-idp dev cluster — Jenkins builds via kaniko, commits the new image tag back to git, Argo CD picks up the change, the page is reachable at `http://sample.lw-idp.local/`, and the IDP UI shows the service with live builds + deploys.

**Architecture (one paragraph):** Two repos. `abhikk30/idp-sample-nginx` holds source, Jenkinsfile, and Helm chart — Jenkins watches it, kaniko builds the image, Jenkinsfile sed-bumps `chart/values.yaml` and pushes back. `lw-idp` (this monorepo) gets the Jenkins-side wiring: agent enabled, GitHub PAT mount, JCasC credentials block, JCasC `job-dsl` to seed the pipeline job, CoreDNS rewrite extension, runbook. Argo CD App registered through the IDP's existing P2.0.5 "Register App" UI flow.

**Tech stack:** Jenkins kubernetes-plugin agents + kaniko, Argo CD, JCasC + job-dsl, Helm chart, ingress-nginx, kind local registry.

**Branch:** `p2.1.2-sample-nginx-cicd` (off master, already created). Single PR titled `p2.1.2: onboard sample-nginx via Jenkins CI + Argo CD CD` at end.

---

## Phase A — `idp-sample-nginx` repo bootstrap

### Task A1 — Initialize the sample-app repo

**Repo:** `/Users/akumar/Documents/Mine/idp-sample-nginx` (cloned, currently empty)

**Files:**
- Create `Dockerfile`
- Create `html/index.html`
- Create `chart/Chart.yaml`
- Create `chart/values.yaml`
- Create `chart/templates/_helpers.tpl`
- Create `chart/templates/deployment.yaml`
- Create `chart/templates/service.yaml`
- Create `chart/templates/ingress.yaml`
- Create `Jenkinsfile`
- Create `README.md`
- Create `.gitignore`

- [ ] **Step 1 — Dockerfile**

```dockerfile
FROM nginx:1.27-alpine
COPY html/ /usr/share/nginx/html/
EXPOSE 80
```

- [ ] **Step 2 — html/index.html**

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>idp-sample-nginx</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;color:#222}h1{color:#326ce5}code{background:#f4f4f4;padding:.1em .3em;border-radius:.2em}</style>
</head><body>
<h1>Hello from idp-sample-nginx</h1>
<p>This page was built by Jenkins and deployed by Argo CD.</p>
<p>Build SHA: <code id="sha">__BUILD_SHA__</code></p>
<p>Source: <a href="https://github.com/abhikk30/idp-sample-nginx">github.com/abhikk30/idp-sample-nginx</a></p>
</body></html>
```

The literal `__BUILD_SHA__` is rewritten by the Jenkinsfile to the
short SHA before the kaniko build (so the page proves which commit
is live).

- [ ] **Step 3 — Helm chart files**

`chart/Chart.yaml`:
```yaml
apiVersion: v2
name: sample-nginx
description: lw-idp sample app — onboarded end-to-end
type: application
version: 0.1.0
appVersion: "0.1.0"
```

`chart/values.yaml`:
```yaml
replicaCount: 1
image:
  repository: localhost:5001/lw-idp/sample-nginx
  tag: "bootstrap"
  pullPolicy: IfNotPresent
service:
  type: ClusterIP
  port: 80
ingress:
  enabled: true
  className: nginx
  host: sample.lw-idp.local
resources:
  requests: { cpu: 50m, memory: 32Mi }
  limits:   { cpu: 200m, memory: 128Mi }
```

`chart/templates/_helpers.tpl`:
```yaml
{{- define "sample-nginx.name" -}}sample-nginx{{- end -}}
{{- define "sample-nginx.labels" -}}
app.kubernetes.io/name: {{ include "sample-nginx.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: helm
{{- end -}}
```

`chart/templates/deployment.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "sample-nginx.name" . }}
  labels: {{- include "sample-nginx.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ include "sample-nginx.name" . }}
      app.kubernetes.io/instance: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {{ include "sample-nginx.name" . }}
        app.kubernetes.io/instance: {{ .Release.Name }}
    spec:
      containers:
        - name: nginx
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: 80
          readinessProbe:
            httpGet: { path: /, port: http }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /, port: http }
            periodSeconds: 30
          resources: {{- toYaml .Values.resources | nindent 12 }}
```

`chart/templates/service.yaml`:
```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "sample-nginx.name" . }}
  labels: {{- include "sample-nginx.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      name: http
  selector:
    app.kubernetes.io/name: {{ include "sample-nginx.name" . }}
    app.kubernetes.io/instance: {{ .Release.Name }}
```

`chart/templates/ingress.yaml`:
```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "sample-nginx.name" . }}
  labels: {{- include "sample-nginx.labels" . | nindent 4 }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  rules:
    - host: {{ .Values.ingress.host }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "sample-nginx.name" . }}
                port: { name: http }
{{- end }}
```

- [ ] **Step 4 — Jenkinsfile**

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

  options {
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    REGISTRY   = 'kind-registry:5000'
    IMAGE_REPO = 'lw-idp/sample-nginx'
  }

  stages {
    stage('Compute tag') {
      steps {
        script {
          env.SHORT_SHA = (env.GIT_COMMIT ?: '').take(7) ?: env.BUILD_NUMBER
          env.IMAGE_TAG = env.SHORT_SHA
          echo "Building tag ${env.IMAGE_TAG}"
        }
      }
    }

    stage('Stamp html with SHA') {
      steps {
        sh 'sed -i "s/__BUILD_SHA__/${SHORT_SHA}/" html/index.html'
      }
    }

    stage('Build & push image') {
      steps {
        container('kaniko') {
          sh '''
            /kaniko/executor \\
              --dockerfile=Dockerfile \\
              --context=. \\
              --destination=${REGISTRY}/${IMAGE_REPO}:${IMAGE_TAG} \\
              --insecure --skip-tls-verify
          '''
        }
      }
    }

    stage('Bump chart tag and push') {
      steps {
        container('git') {
          withCredentials([string(credentialsId: 'github-pat', variable: 'GITHUB_PAT')]) {
            sh '''
              set -eu
              git config user.email jenkins@lw-idp.local
              git config user.name  jenkins
              # Re-checkout main fresh: the workspace was checked out at GIT_COMMIT (detached HEAD).
              git fetch origin main
              git checkout main
              git reset --hard origin/main
              # Re-stamp + re-bump on the freshly-checked-out main so the commit is clean.
              sed -i "s|^  tag:.*|  tag: \\"${IMAGE_TAG}\\"|" chart/values.yaml
              git add chart/values.yaml
              if git diff --cached --quiet ; then
                echo "no tag change — skipping push"
                exit 0
              fi
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

- [ ] **Step 5 — README.md**

```markdown
# idp-sample-nginx

Sample static-page app onboarded end-to-end into the lw-idp dev cluster.

- **Source** lives here.
- **CI:** Jenkins (`sample-nginx` pipeline) builds via kaniko on every
  push to `main` and rewrites `chart/values.yaml` `image.tag` with the
  short SHA. The bump commit uses `[skip ci]` to avoid loops.
- **CD:** Argo CD watches `chart/` and auto-syncs to the
  `sample-nginx` namespace.
- **URL:** http://sample.lw-idp.local/

## Make a change

1. Edit `html/index.html` (or anything else).
2. Commit + push to `main`.
3. Watch Jenkins → Argo CD → reload the page.
4. The Build SHA shown on the page should now match the new commit.

## Rotate the GitHub PAT used for tag bumps

See `lw-idp/docs/runbooks/sample-nginx-onboarding.md` (in the lw-idp repo).
```

- [ ] **Step 6 — .gitignore**

```
.DS_Store
*.bak
```

- [ ] **Step 7 — Push to main**

```bash
cd /Users/akumar/Documents/Mine/idp-sample-nginx
git add .
git commit -m "chore: initial scaffold (Dockerfile, chart, Jenkinsfile, html)"
git branch -M main
git push -u origin main
```

Expected: `idp-sample-nginx` on GitHub now has the scaffolded files on `main`.

---

## Phase B — Jenkins-side enablement (in lw-idp monorepo)

### Task B1 — Enable kubernetes agent + agent resource defaults

**Files:**
- Modify `infra/jenkins/values.yaml`

- [ ] **Step 1 — flip `agent.enabled`**

Replace the trailing block:
```yaml
agent:
  enabled: false
```

with:
```yaml
agent:
  enabled: true
  podName: jenkins-agent
  resources:
    requests: { cpu: 250m, memory: 256Mi }
    limits:   { cpu: 1000m, memory: 1Gi }
  # Kaniko/git pod templates are declared inline in each Jenkinsfile;
  # no static templates needed in the chart.
```

- [ ] **Step 2 — helmfile sync + wait for controller restart**

```bash
helmfile -f infra/jenkins/helmfile.yaml sync
kubectl -n jenkins rollout status statefulset/jenkins --timeout=120s
```

Expected: Jenkins pod restarts cleanly, `kubectl -n jenkins logs jenkins-0 -c jenkins | grep -i "kubernetes"` shows the agent plugin initialized.

- [ ] **Step 3 — commit**

```bash
git add infra/jenkins/values.yaml
git commit -m "infra(jenkins): enable kubernetes agents for dynamic build pods"
```

### Task B2 — Mount `GITHUB_PAT` env + JCasC credential

**Files:**
- Modify `infra/jenkins/values.yaml`

- [ ] **Step 1 — extend `controller.containerEnv` with the PAT mount**

Append to the existing `containerEnv:` list (just below the `JENKINS_SVC_TOKEN` block):

```yaml
    - name: GITHUB_PAT
      valueFrom:
        secretKeyRef:
          name: jenkins-github-pat
          key: GITHUB_PAT
          optional: true
```

`optional: true` keeps Jenkins booting cleanly before the user creates the Secret.

- [ ] **Step 2 — add a `credentials` JCasC config block**

Add a new entry under `controller.JCasC.configScripts`:

```yaml
      credentials-config: |
        credentials:
          system:
            domainCredentials:
              - credentials:
                  - string:
                      scope: GLOBAL
                      id: github-pat
                      secret: "${GITHUB_PAT}"
                      description: "GitHub PAT for idp-sample-nginx push-back (P2.1.2)"
```

- [ ] **Step 3 — sync + verify the credential exists**

```bash
helmfile -f infra/jenkins/helmfile.yaml sync
kubectl -n jenkins rollout status statefulset/jenkins --timeout=120s

# Verify via Jenkins script console (script-console-via-curl helper from the
# gateway service-account isn't ideal; use a quick port-forward + curl):
# (deferred to manual verification — JCasC will register the credential on boot)
```

- [ ] **Step 4 — commit**

```bash
git add infra/jenkins/values.yaml
git commit -m "infra(jenkins): mount jenkins-github-pat + JCasC credential 'github-pat'"
```

### Task B3 — Seed the `sample-nginx` Pipeline job via JCasC `job-dsl`

**Files:**
- Modify `infra/jenkins/values.yaml`

- [ ] **Step 1 — add `jobs:` block under JCasC**

Add a new `configScripts` entry:

```yaml
      jobs-config: |
        jobs:
          - script: >
              pipelineJob('sample-nginx') {
                description('CI for github.com/abhikk30/idp-sample-nginx — built end-to-end via lw-idp.')
                logRotator { numToKeep(20) }
                definition {
                  cpsScm {
                    scm {
                      git {
                        remote { url('https://github.com/abhikk30/idp-sample-nginx.git') }
                        branches('*/main')
                        extensions {
                          cleanBeforeCheckout()
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
                  scm('H/2 * * * *')
                }
              }
```

- [ ] **Step 2 — sync + verify the job appears**

```bash
helmfile -f infra/jenkins/helmfile.yaml sync
kubectl -n jenkins rollout status statefulset/jenkins --timeout=120s
# In a browser: http://jenkins.lw-idp.local/ → "sample-nginx" job is listed.
```

- [ ] **Step 3 — commit**

```bash
git add infra/jenkins/values.yaml
git commit -m "infra(jenkins): seed sample-nginx Pipeline job via JCasC job-dsl"
```

### Task B4 — Bootstrap-script extension + runbook

**Files:**
- Modify `scripts/cluster-bootstrap.sh`
- Create `docs/runbooks/sample-nginx-onboarding.md`

- [ ] **Step 1 — extend CoreDNS rewrite to include `sample.lw-idp.local`**

Find the existing `coredns` ConfigMap patch in `scripts/cluster-bootstrap.sh` (search for `lw-idp.local`). Add `sample.lw-idp.local` to the rewrite rule list — same pattern as `jenkins.lw-idp.local` and `argocd.lw-idp.local`. The rewrite target is `ingress-nginx-controller.ingress-nginx.svc.cluster.local` (or whatever the existing pattern uses).

- [ ] **Step 2 — runbook for the manual one-time PAT step**

`docs/runbooks/sample-nginx-onboarding.md`:

```markdown
# Runbook: onboard `sample-nginx` (Jenkins CI + Argo CD CD)

This runbook captures the **two manual steps** needed once after a fresh
`cluster-reset.sh dev` run, before `sample-nginx` builds end-to-end.
Everything else is automated by `cluster-bootstrap.sh` and JCasC.

## 1. Add the host entry

```bash
echo "127.0.0.1 sample.lw-idp.local" | sudo tee -a /etc/hosts
```

(Same pattern as `jenkins.lw-idp.local`, `argocd.lw-idp.local`, etc.)

## 2. Create the GitHub PAT for tag-bump push-back

1. GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.
2. **Repository access:** Only `abhikk30/idp-sample-nginx`.
3. **Repository permissions:** `Contents: Read and write`.
4. Expiry: per your policy. (Dev: 90 days is fine.)
5. Copy the token (`github_pat_...`) and create the Jenkins Secret:

```bash
kubectl -n jenkins create secret generic jenkins-github-pat \
  --from-literal=GITHUB_PAT='<paste-token-here>'
kubectl -n jenkins rollout restart statefulset/jenkins
```

JCasC reads `${GITHUB_PAT}` from the controller's env at startup and
registers a Jenkins string credential `github-pat` (consumed by the
sample-nginx Jenkinsfile via `withCredentials`).

## 3. Register the Argo CD App through the IDP UI

1. http://portal.lw-idp.local/ → log in via Dex.
2. **Applications → Register App** (P2.0.5 flow).
3. Repo URL: `https://github.com/abhikk30/idp-sample-nginx.git`
4. Path: `chart`
5. Target revision: `main`
6. Destination namespace: `sample-nginx` (auto-create on)
7. Sync policy: automated + selfHeal + prune ON.

After ~15 s the App is created in Argo CD and immediately starts syncing.

## Rotate the PAT

```bash
kubectl -n jenkins delete secret jenkins-github-pat
kubectl -n jenkins create secret generic jenkins-github-pat \
  --from-literal=GITHUB_PAT='<new-token>'
kubectl -n jenkins rollout restart statefulset/jenkins
```

Wait for the controller to come back; JCasC re-registers the credential
on boot. The next Jenkins build picks up the new token automatically.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Jenkins build fails at "Bump chart tag" with 403 | PAT missing or wrong scope | Recreate Secret with `Contents: read+write` |
| Argo CD App stays "Unknown" sync status | Repo URL typo or Argo can't reach GitHub | Check `kubectl -n argocd logs deploy/argocd-repo-server` |
| Pod ImagePullBackOff for `localhost:5001/lw-idp/sample-nginx:<tag>` | Tag bumped before image push completed (race) | Re-trigger the build; kaniko push always finishes before the git commit |
| Page loads but Build SHA `__BUILD_SHA__` literal | Sed step skipped or html unchanged | Confirm Jenkinsfile "Stamp html with SHA" stage ran in this build |
```

- [ ] **Step 3 — re-run bootstrap to apply CoreDNS rewrite + commit**

```bash
bash scripts/cluster-bootstrap.sh dev
# Verify: kubectl -n kube-system get cm coredns -o yaml | grep sample.lw-idp.local
git add scripts/cluster-bootstrap.sh docs/runbooks/sample-nginx-onboarding.md
git commit -m "infra(bootstrap): CoreDNS rewrite for sample.lw-idp.local + onboarding runbook"
```

---

## Phase C — Argo CD App + DNS

### Task C1 — Add /etc/hosts entry (manual one-time, captured in runbook)

This is the user step from the runbook. No commit needed — pure operator action.

- [ ] **Step 1 — user runs**

```bash
echo "127.0.0.1 sample.lw-idp.local" | sudo tee -a /etc/hosts
```

### Task C2 — Register the Argo CD Application

We use the existing IDP "Register App" UI flow to dogfood the registration code path. If the UI flow hits a snag, the same shape can be applied via `kubectl apply`.

- [ ] **Step 1 — register via UI**

Navigate to `http://portal.lw-idp.local/applications/new` (or whatever the URL is in P2.0.5). Inputs:
- Repo URL: `https://github.com/abhikk30/idp-sample-nginx.git`
- Path: `chart`
- Target revision: `main`
- Destination cluster: `in-cluster`
- Destination namespace: `sample-nginx`
- Auto-sync: ON, prune ON, selfHeal ON, CreateNamespace ON

- [ ] **Step 2 — fallback CLI (only if UI flow blocks)**

```bash
kubectl apply -n argocd -f - <<'EOF'
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
    helm: { releaseName: sample-nginx }
  destination:
    server: https://kubernetes.default.svc
    namespace: sample-nginx
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: ["CreateNamespace=true"]
EOF
```

- [ ] **Step 3 — verify sync**

```bash
kubectl -n argocd get app sample-nginx -o jsonpath='{.status.sync.status}{"\n"}{.status.health.status}'
# → Synced / Healthy   (after first build pushes a real image; before that, OutOfSync is fine)
```

---

## Phase D — End-to-end verification

### Task D1 — User creates GitHub PAT + Secret (manual, runbook §2)

- [ ] **Step 1 — user runs the runbook step**

```bash
kubectl -n jenkins create secret generic jenkins-github-pat --from-literal=GITHUB_PAT='<token>'
kubectl -n jenkins rollout restart statefulset/jenkins
kubectl -n jenkins rollout status statefulset/jenkins --timeout=120s
```

### Task D2 — First end-to-end run

- [ ] **Step 1 — trigger initial build**

In the Jenkins UI: **sample-nginx → Build Now**. (Or wait up to 2 min for the SCM poller.)

Expected sequence:
1. Build starts, kaniko pod spins up, image pushed.
2. Bump stage commits the new tag and pushes back to `main`.
3. Argo CD detects the manifest change, syncs, pod runs.
4. `curl http://sample.lw-idp.local/` returns the page.
5. The page's `Build SHA: <short-sha>` matches the new commit.

- [ ] **Step 2 — make a content change, push, watch the loop run**

```bash
cd /Users/akumar/Documents/Mine/idp-sample-nginx
sed -i '' 's|<h1>Hello.*|<h1>Hello from idp-sample-nginx (rev 2)</h1>|' html/index.html
git commit -am "tweak: page heading"
git push
```

Expected: SCM poller picks up within 2 min, build runs, Argo syncs, page reloads with new heading.

### Task D3 — Verify in the IDP UI

- [ ] **Step 1 — Services list**

`http://portal.lw-idp.local/services` shows `sample-nginx` with a green status pill.

- [ ] **Step 2 — Service detail / Deploys tab**

Argo CD application metadata loads, recent syncs are populated, Sync + Hard Sync buttons work.

- [ ] **Step 3 — Service detail / Builds tab**

Jenkins job summary loads, last 1–2 runs visible, Trigger Build button kicks off a new run.

---

## Phase E — Polish + PR

### Task E1 — Top-level README touch

**Files:**
- Modify `README.md` (root)

- [ ] **Step 1 — add a one-liner under the "What's deployed" section**

```markdown
- **`sample-nginx`** — the IDP's first dogfooded user app. Source: <https://github.com/abhikk30/idp-sample-nginx>. Page: <http://sample.lw-idp.local/>. Onboarding runbook: `docs/runbooks/sample-nginx-onboarding.md`.
```

- [ ] **Step 2 — commit**

```bash
git add README.md
git commit -m "docs: link sample-nginx onboarding from root README"
```

### Task E2 — Final sanity sweep + PR

- [ ] **Step 1 — run unit + typecheck across the monorepo**

```bash
pnpm -r typecheck
pnpm -r test
```

Expected: clean. (No services were modified; should be a no-op.)

- [ ] **Step 2 — open the PR**

```bash
git push -u origin p2.1.2-sample-nginx-cicd
gh pr create --title "p2.1.2: onboard sample-nginx via Jenkins CI + Argo CD CD" --body "$(cat <<'EOF'
## Summary

Onboards the IDP's first dogfooded user app (`sample-nginx`):

- New repo `abhikk30/idp-sample-nginx` (scaffolded separately, not part of this PR's diff) holds source + Jenkinsfile + Helm chart.
- Jenkins kubernetes-plugin agents enabled; kaniko builds + pushes to `kind-registry:5000/lw-idp/sample-nginx:<sha>`.
- JCasC seeds a `sample-nginx` Pipeline job, mounts a `GITHUB_PAT` env, and registers a `github-pat` Jenkins string credential.
- Bootstrap CoreDNS rewrite extended for `sample.lw-idp.local`.
- Runbook covers the only two manual steps: `/etc/hosts` and PAT creation.
- Argo CD app registered through the IDP's existing P2.0.5 "Register App" UI.

## End-to-end demo

1. Edit `html/index.html` in `idp-sample-nginx`, push to `main`.
2. Within ~2 min, Jenkins builds (kaniko pod), pushes image, commits tag bump back to `main`.
3. Argo CD detects the manifest change, syncs, pod rolls.
4. <http://sample.lw-idp.local/> shows the new content; "Build SHA" line matches HEAD.
5. IDP Services list shows `sample-nginx` with green status; Deploys + Builds tabs both populated.

## Test plan

- [ ] Fresh `cluster-reset.sh dev` + run runbook steps → page reachable.
- [ ] Push a content change → page updates within 2 min.
- [ ] Bump commit does NOT re-trigger Jenkins ([skip ci] exclusion works).
- [ ] PAT rotation via runbook → next build still pushes successfully.
EOF
)"
```

---

## Manual / out-of-band steps summary (for the executor)

The implementer subagents handle Phases A, B, E. Phases C and D are operator steps (the user runs them after the implementer reports the corresponding code-side task complete):

| Phase | Step | Who |
|---|---|---|
| A | scaffold + push idp-sample-nginx | implementer (writes files), user (or implementer with permission) pushes |
| B | enable agent, mount PAT env, seed job, CoreDNS, runbook | implementer |
| C1 | `/etc/hosts` line | user |
| C2 | register Argo CD app via UI | user (or implementer if UI is browseable headlessly) |
| D1 | create GitHub PAT + Secret | user (PAT creation requires human web flow) |
| D2 | trigger first build, edit + push to verify loop | user |
| D3 | verify in IDP UI | user |
| E | README + PR | implementer |

Implementer subagents flag in their final reports which manual steps the user still owes.
