#!/usr/bin/env bash
# Point the live DigitalOcean App Platform app (`gotchiverse-realm`) at THIS repo and
# apply the Agent-as-Player env vars — patching the live spec in place so existing
# secrets (JWT_SECRET, …) are preserved. Then wait for the deployment.
#
# Required env:
#   DIGITALOCEAN_ACCESS_TOKEN        (vault: gotchiverse-2d)
# Optional secrets (set when present in env, left untouched otherwise):
#   ACARTRIDGE_ATTESTOR_SECRET       (vault: AarcadeGh-t)
#   ACARTRIDGE_ATTESTOR_PRIVATE_KEY  (vault: Gotchiverse-Server → EVM_PRIVATE_KEY)
#   AARCADE_POCKET_CREDIT_SECRET     (vault: AarcadeGh-t, if KO prizes should credit pockets)
# Optional: DO_APP_NAME (gotchiverse-realm), REALM_REPO (userdefault13/gotchiverse-realm-server),
#           REALM_BRANCH (main), ACARTRIDGE_DIAMOND / ACARTRIDGE_CHAIN_ID overrides, DRY_RUN=1
#
# Run with abra so no secret touches the shell history (three Touch IDs, keys scoped with -k):
#   abra run gotchiverse-2d -k DIGITALOCEAN_ACCESS_TOKEN -- \
#   abra run AarcadeGh-t -k ACARTRIDGE_ATTESTOR_SECRET,AARCADE_POCKET_CREDIT_SECRET -- \
#   abra run Gotchiverse-Server -k EVM_PRIVATE_KEY -- \
#   bash -c 'ACARTRIDGE_ATTESTOR_PRIVATE_KEY=$EVM_PRIVATE_KEY scripts/deploy-do-app.sh'
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DIGITALOCEAN_ACCESS_TOKEN:?DIGITALOCEAN_ACCESS_TOKEN required}"
export DO_APP_NAME="${DO_APP_NAME:-gotchiverse-realm}"
export REALM_REPO="${REALM_REPO:-userdefault13/gotchiverse-realm-server}"
export REALM_BRANCH="${REALM_BRANCH:-main}"
export ACARTRIDGE_DIAMOND="${ACARTRIDGE_DIAMOND:-0x8fB6DD5Cef4521E01cCAb178B84eE1392CdB1232}"
export ACARTRIDGE_CHAIN_ID="${ACARTRIDGE_CHAIN_ID:-84532}"

python3 - <<'PY'
import json, os, sys, time, urllib.request, urllib.error

token = os.environ["DIGITALOCEAN_ACCESS_TOKEN"]
name = os.environ["DO_APP_NAME"]
dry = os.environ.get("DRY_RUN") == "1"
H = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

def api(method, path, body=None):
    req = urllib.request.Request(f"https://api.digitalocean.com/v2{path}", headers=H, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        sys.exit(f"DO API {method} {path} → {e.code}: {e.read().decode()[:400]}")

apps = api("GET", "/apps?per_page=200").get("apps", [])
app = next((a for a in apps if a["spec"]["name"] == name), None)
if not app:
    sys.exit(f"app {name!r} not found — create it first: doctl apps create --spec .do/app.yaml")
spec = app["spec"]
svc = next((s for s in spec.get("services", []) if s.get("name") == "realm"), None) or spec["services"][0]

before = (svc.get("github") or {}).get("repo"), svc.get("source_dir"), svc.get("dockerfile_path")
svc["github"] = {"repo": os.environ["REALM_REPO"], "branch": os.environ["REALM_BRANCH"], "deploy_on_push": True}
svc["source_dir"] = "/"
svc["dockerfile_path"] = "Dockerfile"
svc.pop("build_command", None)

plain = {
    "AARCADE_ACARTRIDGE_URL": "https://aarcadeghst.com/api/acartridge",
    "ACARTRIDGE_GAME_ID": "gotchiverse-base",
    "ACARTRIDGE_DIAMOND": os.environ["ACARTRIDGE_DIAMOND"],
    "ACARTRIDGE_CHAIN_ID": os.environ["ACARTRIDGE_CHAIN_ID"],
    "AARCADE_CARTRIDGE_SIM_URL": "https://aarcadeghst.com/api/cartridge-sim",
}
secrets = {k: os.environ[k] for k in
           ("ACARTRIDGE_ATTESTOR_SECRET", "ACARTRIDGE_ATTESTOR_PRIVATE_KEY", "AARCADE_POCKET_CREDIT_SECRET")
           if os.environ.get(k)}

envs = svc.setdefault("envs", [])
def upsert(key, value, secret=False):
    for e in envs:
        if e.get("key") == key:
            e["value"] = value
            if secret: e["type"] = "SECRET"
            return "updated"
    envs.append({"key": key, "value": value, **({"type": "SECRET"} if secret else {})})
    return "added"

print(f"app {name} ({app['id']}) source: {before} → ({os.environ['REALM_REPO']}@{os.environ['REALM_BRANCH']}, /, Dockerfile)")
for k, v in plain.items():
    print(f"  {upsert(k, v):7} {k}={v}")
for k, v in secrets.items():
    print(f"  {upsert(k, v, True):7} {k} (secret)")
missing = [k for k in ("ACARTRIDGE_ATTESTOR_SECRET", "ACARTRIDGE_ATTESTOR_PRIVATE_KEY") if k not in secrets
           and not any(e.get("key") == k for e in envs)]
if missing:
    print(f"  note: not set and not present on the app: {', '.join(missing)} (realm will attest soft-style)")
if dry:
    print("dry run — spec not sent"); sys.exit(0)

api("PUT", f"/apps/{app['id']}", {"spec": spec})
print("spec updated; waiting for deployment…")
for _ in range(60):
    time.sleep(10)
    a = api("GET", f"/apps/{app['id']}")["app"]
    dep = a.get("active_deployment") or {}
    inprog = a.get("in_progress_deployment") or {}
    phase = inprog.get("phase") or dep.get("phase")
    print(f"  {phase}")
    if inprog and inprog.get("phase") in ("ERROR", "CANCELED"):
        sys.exit(f"deployment {inprog.get('phase')} — see the DO dashboard build logs")
    if not inprog and dep.get("phase") == "ACTIVE" and dep.get("id") != app.get("active_deployment", {}).get("id"):
        break
print(f"live: {a.get('live_url')}")
PY

echo
echo "health: $(curl -s -m 10 https://realm.aarcadeghst.com/health | head -c 200)"
