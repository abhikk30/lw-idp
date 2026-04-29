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
