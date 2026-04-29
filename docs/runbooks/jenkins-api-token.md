# Runbook: configure Jenkins API token for the IDP gateway

## When to run this

After every fresh `cluster-reset.sh dev` (the Secret is preserved across
re-runs of `cluster-bootstrap.sh dev`, so a one-time setup per cluster).

## Why this is manual

Jenkins's REST API requires Basic auth with username + API token. API
tokens are minted *per Jenkins user* via the Web UI after a user logs in
at least once — JCasC can't pre-generate them, and the OIDC plugin
doesn't accept Bearer tokens for API calls.

Until this runbook is completed, the IDP's `/api/v1/jenkins/*` proxy
endpoints return `503 jenkins_not_configured` and the Builds tab on
the service detail page renders an "API token not yet configured" empty
state with a link back to this doc.

## Steps

1. **Log into Jenkins via the IDP's SSO** at <http://jenkins.lw-idp.local>.
   First-login walks through Dex → GitHub OAuth.

2. **Generate an API token** for your user:
   - Click your username in the top right → **Configure**.
   - Scroll to **API Token** → **Add new Token** → give it a name like
     `lw-idp-gateway`.
   - Copy the token shown (you can't view it again later).

3. **Patch the gateway's Secret** with your username + token. Username
   is what Jenkins shows under "Full Name" / the `email` claim from
   Dex (typically your GitHub-registered email):

   ```bash
   USERNAME='<your-jenkins-user>'        # e.g. k30abhi@gmail.com
   TOKEN='<paste the token here>'

   kubectl -n lw-idp patch secret gateway-svc-jenkins-api --type=merge -p "$(cat <<EOF
   {
     "data": {
       "JENKINS_API_USERNAME": "$(printf '%s' "$USERNAME" | base64)",
       "JENKINS_API_TOKEN": "$(printf '%s' "$TOKEN" | base64)"
     }
   }
   EOF
   )"
   ```

4. **Restart gateway-svc** so it picks up the new Secret values:

   ```bash
   kubectl -n lw-idp rollout restart deploy/gateway-svc
   kubectl -n lw-idp rollout status deploy/gateway-svc --timeout=120s
   ```

5. **Verify** by curling the proxy through the ingress with a seeded
   session cookie, or just refresh the Builds tab in the IDP portal —
   the empty state should disappear and the gateway should be reachable.

## What this gives the IDP

After step 5, `/api/v1/jenkins/*` proxy routes work:
- `GET /api/v1/jenkins/jobs/<slug>` — job metadata.
- `GET /api/v1/jenkins/jobs/<slug>/builds` — recent build runs.
- `POST /api/v1/jenkins/jobs/<slug>/build` — trigger a new build.
- `GET /api/v1/jenkins/jobs/<slug>/builds/<n>/console` — log tail.

The Builds tab on each service detail page renders these.

## P1.9 follow-up

Replace this manual setup with a Jenkins service-account user backed
by a SealedSecret or External Secrets Operator pull from Vault. Token
rotation handled by the operator instead of human ceremony.
