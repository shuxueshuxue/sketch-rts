#!/usr/bin/env python3
"""HTTPS client; OpenSSH signs requests locally, private key never sent."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
import uuid

PREFIX = '/_sketch_admin/v1'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('Redirect refused: use the final HTTPS origin')

class Client:
    def __init__(self, origin, key):
        u = urllib.parse.urlsplit(origin)
        if u.scheme != 'https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
            raise ValueError('endpoint must be an HTTPS origin, e.g. https://lexicalmathical.com')
        self.origin, self.key = origin.rstrip('/'), str(key)
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, method, path, data=None):
        body = json.dumps(data, separators=(',', ':')).encode() if data is not None else b''
        stamp, nonce = str(int(time.time())), uuid.uuid4().hex
        signed = ('sketch-admin-v1\n' + method + '\n' + path + '\n' + stamp + '\n' + nonce + '\n' + hashlib.sha256(body).hexdigest() + '\n').encode()
        sig = subprocess.run(['ssh-keygen', '-Y', 'sign', '-f', self.key, '-n', 'sketch-admin'],
                             input=signed, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout
        req = urllib.request.Request(self.origin + path, data=body if data is not None else None, method=method,
            headers={'Content-Type': 'application/json', 'X-Admin-Time': stamp, 'X-Admin-Nonce': nonce,
                     'X-Admin-Signature': base64.b64encode(sig).decode()})
        with self.opener.open(req, timeout=30) as result:
            return json.load(result)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--endpoint', default='https://lexicalmathical.com')
    p.add_argument('--key', required=True)
    sub = p.add_subparsers(dest='action', required=True)
    sub.add_parser('health')
    run = sub.add_parser('exec')
    run.add_argument('command')
    run.add_argument('--cwd', default='/root')
    run.add_argument('--timeout', type=int, default=300)
    run.add_argument('--detach', action='store_true')
    run.add_argument('--id', default=None, help='reuse this 32-hex id after an uncertain submit response to prevent duplicate execution')
    job = sub.add_parser('job')
    job.add_argument('id')
    job.add_argument('--offset', type=int, default=0)
    cancel = sub.add_parser('cancel')
    cancel.add_argument('id')
    put = sub.add_parser('put')
    put.add_argument('local')
    put.add_argument('remote')
    put.add_argument('--overwrite', action='store_true')
    get = sub.add_parser('get')
    get.add_argument('remote')
    get.add_argument('local')
    args = p.parse_args()
    client = Client(args.endpoint, args.key)
    if args.action == 'health':
        print(json.dumps(client.request('GET', PREFIX + '/health')))
    elif args.action == 'exec':
        job_id = args.id or uuid.uuid4().hex
        print('job_id=' + job_id, file=sys.stderr, flush=True)
        job = client.request('POST', PREFIX + '/jobs', {'id': job_id, 'command': args.command, 'cwd': args.cwd, 'timeout': args.timeout})
        if args.detach:
            print(json.dumps(job))
            return
        offset = 0
        while True:
            job = client.request('GET', PREFIX + '/jobs/' + job_id + '?offset=' + str(offset))
            output = base64.b64decode(job['output_b64'])
            sys.stdout.buffer.write(output)
            sys.stdout.buffer.flush()
            offset = job['next_offset']
            if job['status'] not in ('queued', 'running') and not output:
                print(json.dumps({k: v for k, v in job.items() if k != 'output_b64'}), file=sys.stderr)
                sys.exit(0 if job.get('exit_code') == 0 and job['status'] == 'finished' else 1)
            time.sleep(0.7)
    elif args.action == 'job':
        job = client.request('GET', PREFIX + '/jobs/' + args.id + '?offset=' + str(args.offset))
        sys.stdout.buffer.write(base64.b64decode(job.pop('output_b64')))
        print(json.dumps(job), file=sys.stderr)
    elif args.action == 'cancel':
        print(json.dumps(client.request('DELETE', PREFIX + '/jobs/' + args.id)))
    elif args.action == 'put':
        content = Path(args.local).read_bytes()
        if len(content) > 8 * 1024 * 1024:
            p.error('single-file upload limit is 8 MiB; split larger files and concatenate in a remote job')
        print(json.dumps(client.request('PUT', PREFIX + '/file', {'path': args.remote, 'content_b64': base64.b64encode(content).decode(), 'overwrite': args.overwrite})))
    elif args.action == 'get':
        offset = 0
        with Path(args.local).open('xb') as f:
            while True:
                result = client.request('GET', PREFIX + '/file?' + urllib.parse.urlencode({'path': args.remote, 'offset': offset}))
                chunk = base64.b64decode(result['content_b64'])
                f.write(chunk)
                offset = result['next_offset']
                if offset >= result['size']:
                    break
                if not chunk:
                    raise RuntimeError('remote file changed while downloading')

if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as exc:
        print('HTTP', exc.code, exc.read(2048).decode(errors='replace'), file=sys.stderr)
        sys.exit(1)
