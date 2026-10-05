#!/usr/bin/env python3
"""Owner-authorized HTTPS administration backend. Bind only to loopback."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import stat
import subprocess
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

PREFIX = '/_sketch_admin/v1'
STATE = Path(os.environ.get('ADMIN_STATE', '/var/lib/sketch-rts-admin'))
SIGNERS = os.environ.get('ADMIN_SIGNERS', '/etc/sketch-rts-admin/allowed_signers')
MAX_BODY = 12 * 1024 * 1024
MAX_OUTPUT = 2 * 1024 * 1024
LOCK = threading.RLock()
PROCESSES = {}
SLOTS = threading.BoundedSemaphore(4)


def canonical(method, path, timestamp, nonce, body):
    return ('sketch-admin-v1\n' + method + '\n' + path + '\n' + timestamp + '\n' + nonce + '\n' + hashlib.sha256(body).hexdigest() + '\n').encode()


def save_job(job):
    path = STATE / (job['id'] + '.json')
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(job))
    tmp.replace(path)


def get_job(job_id):
    if not re.fullmatch(r'[0-9a-f]{32}', job_id):
        raise ValueError('invalid job id')
    return json.loads((STATE / (job_id + '.json')).read_text())


def kill_group(proc):
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def run_job(job, command, cwd, timeout):
    proc = None
    timer = None
    timed_out = threading.Event()
    try:
        env = os.environ.copy()
        for name in list(env):
            if name.startswith('ADMIN_'):
                del env[name]
        proc = subprocess.Popen(['/bin/bash', '-lc', command], cwd=cwd, env=env,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, start_new_session=True)
        with LOCK:
            PROCESSES[job['id']] = proc
            job.update(status='running', started_at=time.time())
            save_job(job)
        def expire():
            timed_out.set()
            kill_group(proc)
        timer = threading.Timer(timeout, expire)
        timer.daemon = True
        timer.start()
        total = 0
        with (STATE / (job['id'] + '.log')).open('wb', buffering=0) as log:
            while True:
                chunk = os.read(proc.stdout.fileno(), 65536)
                if not chunk:
                    break
                if total < MAX_OUTPUT:
                    log.write(chunk[:MAX_OUTPUT - total])
                total += len(chunk)
        code = proc.wait()
        with LOCK:
            current = get_job(job['id'])
            status = 'cancelled' if current.get('cancel_requested') else ('timed_out' if timed_out.is_set() else 'finished')
            job.update(status=status, exit_code=code, output_truncated=total > MAX_OUTPUT)
    except Exception as exc:
        if proc:
            kill_group(proc)
            proc.wait()
        job.update(status='failed', error=str(exc))
    finally:
        if timer:
            timer.cancel()
        with LOCK:
            PROCESSES.pop(job['id'], None)
            job['finished_at'] = time.time()
            save_job(job)
        SLOTS.release()


class Handler(BaseHTTPRequestHandler):
    server_version = 'SketchAdmin/1'
    timeout = 15

    def log_message(self, *_):
        pass  # Do not log paths, commands, signatures, or file contents.

    def reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self, body):
        stamp = self.headers.get('X-Admin-Time', '')
        nonce = self.headers.get('X-Admin-Nonce', '')
        signature = self.headers.get('X-Admin-Signature', '')
        if not stamp.isdigit() or abs(time.time() - int(stamp)) > 120:
            return False
        if not re.fullmatch(r'[0-9a-f]{32}', nonce) or len(signature) > 4096:
            return False
        try:
            decoded = base64.b64decode(signature, validate=True)
            with tempfile.NamedTemporaryFile() as sig:
                sig.write(decoded)
                sig.flush()
                result = subprocess.run(['ssh-keygen', '-Y', 'verify', '-f', SIGNERS,
                    '-I', 'owner', '-n', 'sketch-admin', '-s', sig.name],
                    input=canonical(self.command, self.path, stamp, nonce, body),
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
            if result.returncode:
                return False
            with sqlite3.connect(STATE / 'nonces.sqlite') as db:
                db.execute('DELETE FROM nonces WHERE seen < ?', (time.time() - 300,))
                db.execute('INSERT INTO nonces VALUES (?, ?)', (nonce, time.time()))
            return True
        except (ValueError, OSError, sqlite3.Error, subprocess.TimeoutExpired):
            return False

    def handle_request(self):
        try:
            if self.headers.get('Origin') or self.headers.get('Transfer-Encoding'):
                return self.reply(403, {'error': 'browser origins and chunked requests are not supported'})
            lengths = self.headers.get_all('Content-Length', [])
            if len(lengths) > 1:
                return self.reply(400, {'error': 'multiple content lengths'})
            size = int(lengths[0]) if lengths else 0
            if not 0 <= size <= MAX_BODY:
                return self.reply(413, {'error': 'body too large'})
            body = self.rfile.read(size)
            if len(body) != size:
                return self.reply(400, {'error': 'incomplete body'})
            if not self.authorized(body):
                return self.reply(401, {'error': 'invalid, expired, or replayed signature'})
            url = urlsplit(self.path)
            path = url.path
            query = parse_qs(url.query)
            data = json.loads(body) if body else {}
            if not isinstance(data, dict):
                raise ValueError('JSON object required')
            if self.command == 'GET' and path == PREFIX + '/health':
                return self.reply(200, {'ok': True, 'protocol': 1, 'uid': os.getuid()})
            if self.command == 'POST' and path == PREFIX + '/jobs':
                command = data['command']
                cwd = data.get('cwd', '/root')
                duration = int(data.get('timeout', 300))
                job_id = data['id']
                if not isinstance(command, str) or not 1 <= len(command) <= 131072:
                    raise ValueError('command must be 1..131072 characters')
                if not isinstance(cwd, str) or not Path(cwd).is_absolute() or not Path(cwd).is_dir():
                    raise ValueError('cwd must be an existing absolute directory')
                if not 1 <= duration <= 3600 or not re.fullmatch(r'[0-9a-f]{32}', job_id):
                    raise ValueError('invalid timeout or job id')
                digest = hashlib.sha256(json.dumps([command, cwd, duration]).encode()).hexdigest()
                with LOCK:
                    if (STATE / (job_id + '.json')).exists():
                        old = get_job(job_id)
                        if old['request_hash'] != digest:
                            return self.reply(409, {'error': 'job id already used for different command'})
                        return self.reply(200, old)
                    # Bound retained history and output to roughly 256 MiB.
                    histories = sorted(STATE.glob('*.json'), key=lambda p: p.stat().st_mtime)
                    for old in histories[:-127]:
                        item = json.loads(old.read_text())
                        if item['status'] not in ('running', 'queued'):
                            old.unlink(missing_ok=True)
                            old.with_suffix('.log').unlink(missing_ok=True)
                    if not SLOTS.acquire(blocking=False):
                        return self.reply(429, {'error': 'four commands already active'})
                    job = {'id': job_id, 'status': 'queued', 'created_at': time.time(), 'request_hash': digest}
                    save_job(job)
                    threading.Thread(target=run_job, args=(job.copy(), command, cwd, duration), daemon=True).start()
                return self.reply(202, job)
            if path.startswith(PREFIX + '/jobs/'):
                job_id = path[len(PREFIX + '/jobs/'):]
                if self.command == 'GET':
                    offset = max(0, int(query.get('offset', ['0'])[0]))
                    with LOCK:
                        job = get_job(job_id)
                        log = STATE / (job_id + '.log')
                        output = b''
                        if log.exists():
                            with log.open('rb') as f:
                                f.seek(offset)
                                output = f.read(65536)
                        job.update(output_b64=base64.b64encode(output).decode(), next_offset=offset + len(output))
                    return self.reply(200, job)
                if self.command == 'DELETE':
                    with LOCK:
                        job = get_job(job_id)
                        if job['status'] == 'queued':
                            return self.reply(409, {'error': 'job starting; retry cancellation'})
                        if job_id in PROCESSES:
                            job['cancel_requested'] = True
                            save_job(job)
                            kill_group(PROCESSES[job_id])
                    return self.reply(200, {'id': job_id, 'cancel_requested': job.get('cancel_requested', False)})
            if path == PREFIX + '/file':
                file_path = data.get('path') if self.command == 'PUT' else query.get('path', [''])[0]
                target = Path(file_path)
                if not target.is_absolute():
                    raise ValueError('absolute path required')
                if self.command == 'GET':
                    offset = max(0, int(query.get('offset', ['0'])[0]))
                    fd = os.open(target, os.O_RDONLY | os.O_NONBLOCK)
                    with os.fdopen(fd, 'rb') as f:
                        info = os.fstat(f.fileno())
                        if not stat.S_ISREG(info.st_mode):
                            raise ValueError('file downloads require a regular file')
                        f.seek(offset)
                        chunk = f.read(4 * 1024 * 1024)
                    return self.reply(200, {'content_b64': base64.b64encode(chunk).decode(), 'next_offset': offset + len(chunk), 'size': info.st_size})
                if self.command == 'PUT':
                    content = base64.b64decode(data['content_b64'], validate=True)
                    if target.is_symlink():
                        raise ValueError('write the resolved target explicitly; symlink destinations are refused')
                    if target.exists() and not data.get('overwrite', False):
                        return self.reply(409, {'error': 'destination exists; specify overwrite'})
                    existing = target.stat() if target.exists() else None
                    mode = int(data.get('mode', existing.st_mode & 0o777 if existing else 0o600))
                    if not 0 <= mode <= 0o777:
                        raise ValueError('mode must be 0000..0777')
                    fd, temp = tempfile.mkstemp(prefix='.sketch-admin-', dir=target.parent)
                    try:
                        with os.fdopen(fd, 'wb') as f:
                            f.write(content)
                            f.flush()
                            os.fchmod(f.fileno(), mode)
                            if existing and os.getuid() == 0:
                                os.fchown(f.fileno(), existing.st_uid, existing.st_gid)
                            os.fsync(f.fileno())
                        if data.get('overwrite', False):
                            os.replace(temp, target)
                        else:
                            os.link(temp, target)  # Atomic no-clobber creation.
                    finally:
                        Path(temp).unlink(missing_ok=True)
                    return self.reply(200, {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
            return self.reply(404, {'error': 'unknown endpoint'})
        except FileNotFoundError:
            self.reply(404, {'error': 'file or job not found'})
        except (ValueError, KeyError, TypeError) as exc:
            self.reply(400, {'error': str(exc)})
        except OSError as exc:
            self.reply(400, {'error': str(exc)})

    do_GET = do_POST = do_PUT = do_DELETE = handle_request


def main():
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(STATE / 'nonces.sqlite') as db:
        db.execute('CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, seen REAL)')
    for path in STATE.glob('*.json'):
        job = json.loads(path.read_text())
        if job['status'] in ('running', 'queued'):
            job.update(status='interrupted', finished_at=time.time())
            save_job(job)
    server = ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('ADMIN_PORT', '18765'))), Handler)
    server.serve_forever()


if __name__ == '__main__':
    main()
