# Sketch RTS HTTPS administration

An owner-authorized remote command/file service, independent of the game.
Requests travel over HTTPS and carry OpenSSH Ed25519 signatures. The supplied
`owner.pub` is Jeffry's public key; **no private key is included in this package**.

## Install once on the Aliyun server

Requirements: Linux + systemd, Python >= 3.9, OpenSSH >= 8.2, and a working Nginx
HTTPS virtual host for `lexicalmathical.com` with an explicit `listen 443 ssl` (or
`IP:443 ssl`) and `server_name lexicalmathical.com`. The standard
`/etc/nginx/conf.d/*.conf` include must be inside Nginx's `http` context.

1. Upload `sketch-rts-admin.tar.gz` with your existing SSH client.
2. As root:

```sh
mkdir -p /root/sketch-rts-admin-setup
tar -xzf /root/sketch-rts-admin.tar.gz -C /root/sketch-rts-admin-setup
cd /root/sketch-rts-admin-setup/sketch-rts-admin
python3 install.py --domain lexicalmathical.com
```

The installer first locates exactly one matching HTTPS server block. It adds a
managed `/_sketch_admin/` location, backs up the original configuration, validates
Nginx, starts the loopback service, verifies unsigned requests receive 401, and
reloads Nginx. It does not restart or modify the game service. On failure it
restores modified configuration and the previous service files. If the vhost
layout is ambiguous, it stops before modifying anything: send that output back
rather than guessing a configuration file. No DNS changes or new inbound ports
are needed. External unsigned health requests should return HTTP 401.

This grants the holder of the authorized private key root command execution on
this server. Commands are not limited to game deployment. Network exposure is
HTTPS on the existing Nginx host; backend 18765 listens only on 127.0.0.1.

## Use from the client machine

Python standard library + `ssh-keygen`; no pip packages. The client honors the
configured HTTPS proxy, requires valid TLS certificates, and refuses redirects.
It uses the original private key locally and never uploads it.

```sh
python3 client.py --key /path/to/aliyun_sketch_rts_ed25519 health
python3 client.py --key /path/to/aliyun_sketch_rts_ed25519 exec 'whoami; hostname; systemctl is-active sketch-rts'
python3 client.py --key /path/to/aliyun_sketch_rts_ed25519 exec 'npm run build:production' --cwd /path/to/checkout --timeout 600 --detach
python3 client.py --key /path/to/aliyun_sketch_rts_ed25519 job JOB_ID
python3 client.py --key /path/to/aliyun_sketch_rts_ed25519 cancel JOB_ID
python3 client.py --key /path/to/aliyun_sketch_rts_ed25519 put ./patch.tar.gz /tmp/patch.tar.gz
python3 client.py --key /path/to/aliyun_sketch_rts_ed25519 get /etc/nginx/nginx.conf ./nginx.conf
```

`exec` prints its job ID **before submission**. If a submission response is lost,
query that ID first; retry with `exec --id SAME_ID` and the identical command,
cwd and timeout. The server will return the existing job instead of executing it
a second time. Uploads refuse overwrite unless `--overwrite` is supplied.

Four concurrent commands, maximum one hour per command, first 2 MiB of output
per job, roughly 128 retained jobs. Longer running services should be managed by
systemd. Each job has its own shell; use `--cwd` or explicit environment settings
rather than expecting `cd`/`export` from previous jobs to persist. This is not a
TTY: interactive editors/password prompts are unsupported. Background jobs keep
running if an HTTP client disconnects. Restarting the admin service terminates
its child jobs and marks unfinished jobs interrupted when the service resumes.

Uploads: up to 8 MiB per request, atomic file replacement, symlink destinations
refused. Downloads are read in 4 MiB chunks; avoid editing a file while downloading
it. File operations cover regular files, not devices or streaming pseudo-files.
Larger artifacts can be split locally, uploaded separately, then concatenated
and checksum-verified by a command. Job/output files are private to root.

## Authentication and revocation

Each signature covers the method, exact URL path/query, timestamp, nonce and
SHA-256 body digest under the dedicated OpenSSH namespace `sketch-admin`.
Two-minute clock window; persistently recorded nonces prevent replay across
service restarts. Keep server/client clocks synchronized. Nginx rate-limits
requests; no cookie authentication or browser-origin requests are accepted.
The service does not log command bodies, headers or file contents.

To revoke this service immediately:

```sh
systemctl disable --now sketch-rts-admin
```

To remove the HTTPS route as well, run `python3 uninstall.py` from this unpacked
directory. It retains backups and job history. SSH's `authorized_keys` is separate:
removing a key there does NOT revoke this HTTP service. Its authorized key lives
in `/etc/sketch-rts-admin/allowed_signers`; edit that file to rotate/revoke it.
The verifier reads the file for every request.

## Tests

```sh
python3 -m unittest discover -s . -p 'test_*.py' -v
```

Tests use temporary keys and a loopback test server, never production credentials.
The local test suite covers authentication, tampering/replay, timeout/cancellation,
job idempotency, file transfer, restart behavior and Nginx configuration matching.
Live Nginx/systemd integration must still be validated on the target server.
