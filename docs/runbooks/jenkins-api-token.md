# Runbook: Jenkins service-account API token

## Status — automated as of P2.1.1.1

The IDP gateway's Jenkins service-account API token is now generated and
wired automatically by `scripts/cluster-bootstrap.sh`. **No manual steps
are required after a fresh cluster reset.** This runbook is kept only as
a rotation / debugging reference.

## How it works

`scripts/cluster-bootstrap.sh` generates a 32-byte hex token (or reuses
the existing one if both Secrets already agree). It writes the same
plaintext value into two Secrets:

| Secret | Namespace | Key | Read by |
|---|---|---|---|
| `jenkins-svc-token` | `jenkins` | `JENKINS_SVC_TOKEN` | Jenkins controller (mounted via `containerEnv` in `infra/jenkins/values.yaml`) |
| `gateway-svc-jenkins-api` | `lw-idp` | `JENKINS_API_USERNAME` + `JENKINS_API_TOKEN` | gateway-svc (mounted via `extraEnv` in `charts/gateway-svc/values.yaml`) |

A Groovy init script in `controller.initScripts` of the Jenkins values
runs at every Jenkins startup. It:

1. Reads `JENKINS_SVC_TOKEN` from env.
2. Looks up (or creates) the Jenkins user `lw-idp-gateway-svc`.
3. Computes the SHA-256 hex of the plaintext token (the format
   `ApiTokenStore.addFixedNewToken` requires).
4. Revokes any prior token under our marker name (`lw-idp-gateway`),
   then seeds the fresh hash. Idempotent — same final state regardless
   of pre-run state.

The gateway then Basic-auths to Jenkins's REST API as
`lw-idp-gateway-svc:<plaintext token>`. Jenkins's
`BasicHeaderApiTokenAuthenticator` validates by hashing the supplied
token and comparing to the stored hash — succeeds without involving
the OIDC realm.

## When the token rotates

- **Fresh cluster (`cluster-reset.sh dev`):** PVC is wiped → Jenkins user
  store is wiped → bootstrap regenerates token, both Secrets get the new
  value, Jenkins+gateway pods restart. Zero-touch.
- **Existing cluster, re-running bootstrap:** Both Secrets already have
  matching values → bootstrap reuses the existing token → no pod
  restarts.

## Manual rotation

If you ever need to force-rotate the token:

```bash
kubectl -n lw-idp delete secret gateway-svc-jenkins-api
kubectl -n jenkins delete secret jenkins-svc-token
bash scripts/cluster-bootstrap.sh dev
```

The bootstrap script will detect the missing Secrets, generate a fresh
token, write it into both, and rolling-restart Jenkins + gateway-svc.

## Troubleshooting

**Builds tab shows "API token not yet configured"** (gateway returns
`503 jenkins_not_configured`):
- Check `kubectl -n lw-idp get secret gateway-svc-jenkins-api -o yaml`
  — `JENKINS_API_USERNAME` and `JENKINS_API_TOKEN` must both be
  non-empty (base64 of a non-empty value).
- Check gateway env: `kubectl -n lw-idp exec deploy/gateway-svc -- env | grep JENKINS_API_`.
- Restart gateway: `kubectl -n lw-idp rollout restart deploy/gateway-svc`.

**Builds tab shows "Jenkins unreachable / unauthorized":**
- Check init.groovy ran: `kubectl -n jenkins logs jenkins-0 -c jenkins | grep "lw-idp init"`.
- If you see `JENKINS_SVC_TOKEN not set`, the env var isn't reaching
  Jenkins. Verify `kubectl -n jenkins exec jenkins-0 -c jenkins -- env | grep JENKINS_SVC_TOKEN`.
- If init.groovy ran but Jenkins still rejects, the SHA hashing might
  have failed silently — check the controller log for stack traces.

## P1.9 follow-up

Replace the bootstrap-side `openssl rand` with a pull from External
Secrets Operator → Vault. The init.groovy script doesn't change — it
still reads `JENKINS_SVC_TOKEN` from env regardless of source.
