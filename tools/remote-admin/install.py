#!/usr/bin/env python3
"""Run as root on the server. Installs only after locating the existing TLS vhost."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from nginx_config import discover, INCLUDE

BASE = Path('/etc/sketch-rts-admin')
APP = Path('/opt/sketch-rts-admin')
UNIT = Path('/etc/systemd/system/sketch-rts-admin.service')
ZONE = Path('/etc/nginx/conf.d/sketch-rts-admin-rate.conf')


def run(*args, **kw):
    return subprocess.run(args, check=True, **kw)


def write(path, text, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(mode)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--domain', default='lexicalmathical.com')
    p.add_argument('--public-key', default=str(Path(__file__).with_name('owner.pub')))
    args = p.parse_args()
    if os.geteuid() != 0:
        p.error('run with sudo or as root')
    for command in ('nginx', 'systemctl', 'ssh-keygen', 'python3'):
        if not shutil.which(command):
            p.error('missing executable: ' + command)
    if sys.version_info < (3, 9):
        p.error('Python 3.9 or later is required')
    public = Path(args.public_key).read_text().strip()
    if not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\n\r]+)?', public):
        p.error('provide an Ed25519 PUBLIC key, never a private key')
    run('ssh-keygen', '-lf', args.public_key)
    # Check OpenSSH signing support with a disposable local test key.
    with tempfile.TemporaryDirectory() as directory:
        key = str(Path(directory) / 'test-key')
        run('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', key)
        signed = run('ssh-keygen', '-Y', 'sign', '-f', key, '-n', 'sketch-admin', input=b'check', capture_output=True).stdout
        sig = Path(directory) / 'signature'
        sig.write_bytes(signed)
        signers = Path(directory) / 'signers'
        signers.write_text('owner ' + Path(key + '.pub').read_text())
        run('ssh-keygen', '-Y', 'verify', '-f', str(signers), '-I', 'owner', '-n', 'sketch-admin', '-s', str(sig), input=b'check', capture_output=True)
    nginx = run('nginx', '-T', capture_output=True, text=True).stdout
    candidates = discover(nginx, args.domain)
    if len(candidates) != 1:
        p.error('expected one explicit HTTPS server block for ' + args.domain + '; found ' + str(candidates) + '. No changes made. Send this output to the maintainer.')
    config, position = candidates[0]
    config = Path(config)
    original = config.read_text()
    previous_unit = UNIT.read_bytes() if UNIT.exists() else None
    previous_zone = ZONE.read_bytes() if ZONE.exists() else None
    previous_location = (BASE / 'nginx-location.conf').read_bytes() if (BASE / 'nginx-location.conf').exists() else None
    was_active = subprocess.run(['systemctl', 'is-active', '--quiet', 'sketch-rts-admin']).returncode == 0
    # Abort before touching files if the dedicated port is occupied on first installation.
    if previous_unit is None:
        import socket
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 18765))
    BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    APP.mkdir(mode=0o755, parents=True, exist_ok=True)
    backup = BASE / ('nginx-backup-' + str(time.time_ns()) + '.conf')
    shutil.copy2(config, backup)
    app_backup = (APP / 'server.py').read_bytes() if (APP / 'server.py').exists() else None
    signers_backup = (BASE / 'allowed_signers').read_bytes() if (BASE / 'allowed_signers').exists() else None
    try:
        shutil.copy2(Path(__file__).with_name('server.py'), APP / 'server.py')
        (APP / 'server.py').chmod(0o644)
        write(BASE / 'allowed_signers', 'owner namespaces="sketch-admin" ' + public + '\n')
        write(BASE / 'nginx-location.conf', '''location ^~ /_sketch_admin/ {
    if ($scheme != https) { return 404; }
    limit_req zone=sketch_admin_rate burst=20 nodelay;
    limit_conn sketch_admin_conn 8;
    client_max_body_size 12m;
    client_body_timeout 15s;
    proxy_pass http://127.0.0.1:18765;
    proxy_http_version 1.1;
    proxy_set_header Connection "close";
    proxy_set_header Host $host;
    proxy_read_timeout 30s;
    proxy_connect_timeout 3s;
    proxy_request_buffering on;
    proxy_buffering off;
    access_log off;
    add_header Cache-Control "no-store" always;
}
''', 0o644)
        write(ZONE, '''limit_req_zone $binary_remote_addr zone=sketch_admin_rate:1m rate=5r/s;
limit_conn_zone $binary_remote_addr zone=sketch_admin_conn:1m;
''', 0o644)
        if INCLUDE.strip() not in original:
            config.write_text(original[:position] + '\n' + INCLUDE + original[position:])
        write(UNIT, '''[Unit]
Description=Owner-signed HTTPS administration for Sketch RTS
After=network.target

[Service]
Type=simple
User=root
UMask=0077
ExecStart=/usr/bin/python3 -I /opt/sketch-rts-admin/server.py
Environment=ADMIN_PORT=18765
Environment=ADMIN_STATE=/var/lib/sketch-rts-admin
Environment=ADMIN_SIGNERS=/etc/sketch-rts-admin/allowed_signers
StateDirectory=sketch-rts-admin
StateDirectoryMode=0700
Restart=on-failure
RestartSec=3
KillMode=control-group
TimeoutStopSec=10
NoNewPrivileges=true
LimitNOFILE=4096
TasksMax=512

[Install]
WantedBy=multi-user.target
''', 0o644)
        run('nginx', '-t')
        run('systemctl', 'daemon-reload')
        run('systemctl', 'enable', '--now', 'sketch-rts-admin')
        run('systemctl', 'restart', 'sketch-rts-admin')
        # Verify service is up and refuses unsigned requests before exposing its route.
        import urllib.request, urllib.error
        ready = False
        for _ in range(20):
            try:
                urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:18765/_sketch_admin/v1/health', timeout=1)
            except urllib.error.HTTPError as exc:
                if exc.code == 401:
                    ready = True
                    break
                raise
            except urllib.error.URLError:
                time.sleep(0.25)
        if not ready:
            raise RuntimeError('backend did not become ready and reject unsigned requests')
        run('systemctl', 'reload', 'nginx')
        write(BASE / 'installation.json', json.dumps({'domain': args.domain, 'nginx_config': str(config), 'backup': str(backup)}, indent=2))
    except Exception:
        config.write_text(original)
        for path, content in ((UNIT, previous_unit), (ZONE, previous_zone), (BASE / 'nginx-location.conf', previous_location), (APP / 'server.py', app_backup), (BASE / 'allowed_signers', signers_backup)):
            if content is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(content)
        if not was_active:
            subprocess.run(['systemctl', 'disable', '--now', 'sketch-rts-admin'], check=False)
        subprocess.run(['systemctl', 'daemon-reload'], check=False)
        if was_active:
            subprocess.run(['systemctl', 'restart', 'sketch-rts-admin'], check=False)
        if subprocess.run(['nginx', '-t']).returncode == 0:
            subprocess.run(['systemctl', 'reload', 'nginx'], check=False)
        raise
    print('\nInstalled: https://' + args.domain + '/_sketch_admin/v1/health')
    print('Unsigned requests must return 401. No private key was installed.')
    print('Existing game service was not restarted. Nginx configuration backup: ' + str(backup))
    print('Emergency disable: systemctl disable --now sketch-rts-admin')

if __name__ == '__main__':
    main()
