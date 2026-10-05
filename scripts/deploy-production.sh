#!/usr/bin/env bash
set -Eeuo pipefail

artifact_path="${1:?usage: deploy-production.sh <artifact.tar.gz> <revision>}"
revision="${2:?usage: deploy-production.sh <artifact.tar.gz> <revision>}"

deploy_root="${DEPLOY_ROOT:-/opt/sketch-rts}"
service_name="${SERVICE_NAME:-sketch-rts.service}"
node_bin="${NODE_BIN:-/root/.nvm/versions/node/v20.20.0/bin/node}"
port="${PORT:-34574}"
base_path="${SKETCH_RTS_BASE_PATH:-/sketch-rts/}"

if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Revision must be a full Git commit SHA." >&2
  exit 1
fi
health_url="http://127.0.0.1:$port${base_path%/}/api/catalog"

lock_path="${DEPLOY_LOCK_PATH:-/var/lock/sketch-rts-deploy.lock}"
unit_dir="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
releases_dir="$deploy_root/releases"
shared_dir="$deploy_root/shared"
current_link="$deploy_root/current"

exec 9>"$lock_path"
flock -x 9

if [[ ! -s "$artifact_path" ]]; then
  echo "Deploy artifact does not exist or is empty: $artifact_path" >&2
  exit 1
fi

mkdir -p "$releases_dir" "$shared_dir/.benchmark-dashboard"
if [[ -d "$deploy_root/.benchmark-dashboard" && ! -L "$deploy_root/.benchmark-dashboard" ]]; then
  cp -a "$deploy_root/.benchmark-dashboard/." "$shared_dir/.benchmark-dashboard/"
fi

release_dir="$releases_dir/$revision"
tmp_release="$releases_dir/.tmp-$revision-$$"
previous_release="$(readlink -f "$current_link" 2>/dev/null || true)"
if [[ -z "$previous_release" && -f "$deploy_root/dist-server/index.mjs" && -d "$deploy_root/dist" ]]; then
  legacy_revision="$(cat "$deploy_root/.deployed-revision" 2>/dev/null || printf 'unknown')"
  legacy_revision="legacy-${legacy_revision//[^A-Za-z0-9_.-]/-}"
  previous_release="$releases_dir/$legacy_revision"
  if [[ ! -d "$previous_release" ]]; then
    mkdir -p "$previous_release"
    cp -a "$deploy_root/dist" "$deploy_root/dist-server" "$previous_release/"
    ln -sfn "$shared_dir/.benchmark-dashboard" "$previous_release/.benchmark-dashboard"
    printf '%s\n' "$legacy_revision" > "$previous_release/.deployed-revision"
  fi
fi

if [[ "$previous_release" == "$release_dir" ]] && curl --noproxy 127.0.0.1 -fsS --max-time 3 "$health_url" >/dev/null; then
  printf 'already deployed %s\n' "$revision"
  exit 0
fi

if [[ -e "$release_dir" ]]; then
  echo "Release already exists: $release_dir; refusing to overwrite it." >&2
  exit 1
fi
mkdir -p "$tmp_release"
tar -xzf "$artifact_path" -C "$tmp_release"

if [[ ! -f "$tmp_release/dist/index.html" || ! -f "$tmp_release/dist-server/index.mjs" ]]; then
  echo "Deploy artifact is missing dist/index.html or dist-server/index.mjs" >&2
  exit 1
fi

# Nginx reads static assets as an unprivileged user. Admin jobs inherit umask
# 077, so explicitly publish only the frontend and its parent directory.
chmod 755 "$tmp_release"
find "$tmp_release/dist" -type d -exec chmod 755 {} +
find "$tmp_release/dist" -type f -exec chmod 644 {} +
ln -sfn "$shared_dir/.benchmark-dashboard" "$tmp_release/.benchmark-dashboard"
printf '%s\n' "$revision" > "$tmp_release/.deployed-revision"
mv "$tmp_release" "$release_dir"

if [[ ! -f "$unit_dir/$service_name" ]]; then
cat > "$unit_dir/$service_name" <<UNIT
[Unit]
Description=Sketch RTS hosted server
After=network.target

[Service]
Type=simple
WorkingDirectory=$current_link
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=$port
Environment=SKETCH_RTS_BASE_PATH=$base_path
Environment=ROOM_AUTOTICK=1
Environment=PATH=/root/.nvm/versions/node/v20.20.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$node_bin $current_link/dist-server/index.mjs
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
fi

switched=0
rollback_on_error() {
  status=$?
  trap - ERR
  if [[ "$switched" == "1" && -n "$previous_release" && -d "$previous_release" ]]; then
    systemctl stop "$service_name" || true
    ln -sfn "$previous_release" "$current_link.next"
    mv -Tf "$current_link.next" "$current_link"
    systemctl start "$service_name" || true
  fi
  exit "$status"
}
trap rollback_on_error ERR

systemctl daemon-reload
switched=1
systemctl stop "$service_name"

ln -sfn "$release_dir" "$current_link.next"
mv -Tf "$current_link.next" "$current_link"

systemctl start "$service_name"

health_url="http://127.0.0.1:$port${base_path%/}/api/catalog"
healthy=0
for _ in $(seq 1 30); do
  if curl --noproxy 127.0.0.1 -fsS --max-time 3 "$health_url" >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done

if [[ "$healthy" != "1" ]]; then
  echo "Health check failed for $health_url" >&2
  false
fi

printf '%s\n' "$revision" > "$deploy_root/.deployed-revision"
if [[ -d "$deploy_root/.benchmark-dashboard" && ! -L "$deploy_root/.benchmark-dashboard" ]]; then
  rm -rf "$deploy_root/.benchmark-dashboard"
  ln -sfn "$shared_dir/.benchmark-dashboard" "$deploy_root/.benchmark-dashboard"
fi
# Retain legacy files and previous releases for recovery.

printf 'deployed %s\n' "$revision"
