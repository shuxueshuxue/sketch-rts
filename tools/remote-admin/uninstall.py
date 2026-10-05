#!/usr/bin/env python3
"""Remove the managed route and stop the service; retain job records and backups."""
import json
import os
from pathlib import Path
import subprocess
from nginx_config import INCLUDE

if os.geteuid() != 0:
    raise SystemExit('run as root')
base = Path('/etc/sketch-rts-admin')
info = json.loads((base / 'installation.json').read_text())
path = Path(info['nginx_config'])
original = path.read_text()
path.write_text(original.replace(INCLUDE, ''))
try:
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except Exception:
    path.write_text(original)
    raise
subprocess.run(['systemctl', 'disable', '--now', 'sketch-rts-admin'], check=True)
Path('/etc/systemd/system/sketch-rts-admin.service').unlink(missing_ok=True)
Path('/etc/nginx/conf.d/sketch-rts-admin-rate.conf').unlink(missing_ok=True)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
print('Service disabled and HTTPS route removed. Backups and job records retained.')
