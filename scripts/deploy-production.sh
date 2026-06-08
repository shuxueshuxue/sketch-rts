#!/usr/bin/env bash
set -Eeuo pipefail

artifact_path="${1:?usage: deploy-production.sh <artifact.tar.gz> <revision>}"
revision="${2:?usage: deploy-production.sh <artifact.tar.gz> <revision>}"

deploy_root="${DEPLOY_ROOT:-/opt/sketch-rts}"
service_name="${SERVICE_NAME:-sketch-rts.service}"
node_bin="${NODE_BIN:-/root/.nvm/versions/node/v20.20.0/bin/node}"
port="${PORT:-34574}"
base_path="${SKETCH_RTS_BASE_PATH:-/sketch-rts/}"
keep_releases="${KEEP_RELEASES:-3}"

lock_path="/var/lock/sketch-rts-deploy.lock"
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

release_dir="$releases_dir/$revision"
tmp_release="$releases_dir/.tmp-$revision-$$"
previous_release="$(readlink -f "$current_link" 2>/dev/null || true)"

rm -rf "$tmp_release" "$release_dir"
mkdir -p "$tmp_release"
tar -xzf "$artifact_path" -C "$tmp_release"

if [[ ! -f "$tmp_release/dist/index.html" || ! -f "$tmp_release/dist-server/index.mjs" ]]; then
  echo "Deploy artifact is missing dist/index.html or dist-server/index.mjs" >&2
  exit 1
fi

ln -sfn "$shared_dir/.benchmark-dashboard" "$tmp_release/.benchmark-dashboard"
printf '%s\n' "$revision" > "$tmp_release/.deployed-revision"
mv "$tmp_release" "$release_dir"

cat > "/etc/systemd/system/$service_name" <<UNIT
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

systemctl daemon-reload
systemctl stop "$service_name"

ln -sfn "$release_dir" "$current_link.next"
mv -Tf "$current_link.next" "$current_link"

systemctl start "$service_name"

health_url="http://127.0.0.1:$port${base_path%/}/api/catalog"
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS "$health_url" >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done

if [[ "$healthy" != "1" ]]; then
  echo "Health check failed for $health_url" >&2
  systemctl stop "$service_name"
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    ln -sfn "$previous_release" "$current_link.next"
    mv -Tf "$current_link.next" "$current_link"
    systemctl start "$service_name"
  fi
  exit 1
fi

find "$releases_dir" -mindepth 1 -maxdepth 1 -type d ! -name ".$revision-*" -printf '%T@ %p\n' \
  | sort -rn \
  | tail -n +"$((keep_releases + 1))" \
  | cut -d' ' -f2- \
  | xargs -r rm -rf

printf 'deployed %s\n' "$revision"
