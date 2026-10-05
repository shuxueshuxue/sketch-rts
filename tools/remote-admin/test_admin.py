import base64
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
import uuid

from nginx_config import candidate, INCLUDE
from server import PREFIX, canonical


class AdminTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.key = cls.root / 'key'
        cls.other = cls.root / 'other'
        for key in (cls.key, cls.other):
            subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key)], check=True)
        cls.signers = cls.root / 'allowed_signers'
        cls.signers.write_text('owner namespaces="sketch-admin" ' + cls.key.with_suffix('.pub').read_text())
        cls.state = cls.root / 'state'
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            cls.port = s.getsockname()[1]
        cls.start()

    @classmethod
    def start(cls):
        env = dict(os.environ, ADMIN_PORT=str(cls.port), ADMIN_STATE=str(cls.state), ADMIN_SIGNERS=str(cls.signers))
        cls.process = subprocess.Popen(['python3', '-I', str(Path(__file__).with_name('server.py'))], env=env, start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try:
                with socket.create_connection(('127.0.0.1', cls.port), timeout=0.2):
                    return
            except OSError:
                time.sleep(0.05)
        raise RuntimeError('test server failed to start')

    @classmethod
    def stop(cls):
        import signal
        os.killpg(cls.process.pid, signal.SIGTERM)
        cls.process.wait(timeout=5)

    @classmethod
    def tearDownClass(cls):
        cls.stop()
        cls.tmp.cleanup()

    def headers(self, method, path, body, key=None, stamp=None):
        stamp = stamp or str(int(time.time()))
        nonce = uuid.uuid4().hex
        signed = subprocess.run(['ssh-keygen', '-Y', 'sign', '-f', str(key or self.key), '-n', 'sketch-admin'], input=canonical(method, path, stamp, nonce, body), capture_output=True, check=True).stdout
        return {'Content-Type': 'application/json', 'X-Admin-Time': stamp, 'X-Admin-Nonce': nonce, 'X-Admin-Signature': base64.b64encode(signed).decode()}

    def request(self, method, path, data=None, headers=None, key=None):
        body = json.dumps(data).encode() if data is not None else b''
        if headers is None:
            headers = self.headers(method, path, body, key=key)
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        try:
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def submit(self, command, timeout=10, job_id=None):
        data = {'id': job_id or uuid.uuid4().hex, 'command': command, 'cwd': str(self.root), 'timeout': timeout}
        code, result = self.request('POST', PREFIX + '/jobs', data)
        self.assertIn(code, (200, 202), result)
        return data, result

    def finish(self, job_id):
        for _ in range(100):
            code, job = self.request('GET', PREFIX + '/jobs/' + job_id)
            self.assertEqual(code, 200)
            if job['status'] not in ('running', 'queued'):
                return job
            time.sleep(0.05)
        self.fail('job did not finish')

    def test_authentication_tampering_and_replay(self):
        path = PREFIX + '/health'
        self.assertEqual(self.request('GET', path, headers={})[0], 401)
        self.assertEqual(self.request('GET', path, key=self.other)[0], 401)
        h = self.headers('GET', path, b'')
        self.assertEqual(self.request('GET', path, headers=h)[0], 200)
        self.assertEqual(self.request('GET', path, headers=h)[0], 401)
        expired = self.headers('GET', path, b'', stamp=str(int(time.time()) - 300))
        self.assertEqual(self.request('GET', path, headers=expired)[0], 401)
        payload = {'id': uuid.uuid4().hex, 'command': 'touch tampered', 'cwd': str(self.root)}
        h = self.headers('POST', PREFIX + '/jobs', b'{}')
        self.assertEqual(self.request('POST', PREFIX + '/jobs', payload, headers=h)[0], 401)
        self.assertFalse((self.root / 'tampered').exists())
        h = self.headers('GET', path, b'')
        self.assertEqual(self.request('GET', path + '?changed=1', headers=h)[0], 401)
        h = self.headers('GET', path, b'')
        h['Origin'] = 'https://attacker.invalid'
        self.assertEqual(self.request('GET', path, headers=h)[0], 403)

    def test_command_and_idempotent_retry(self):
        data, job = self.submit("printf x >> counter; printf 'hello'; printf 'err' >&2; exit 7")
        done = self.finish(job['id'])
        self.assertEqual(done['exit_code'], 7)
        self.assertEqual(base64.b64decode(done['output_b64']), b'helloerr')
        self.assertEqual(self.request('POST', PREFIX + '/jobs', data)[0], 200)
        self.assertEqual((self.root / 'counter').read_text(), 'x')
        data['command'] = 'true'
        self.assertEqual(self.request('POST', PREFIX + '/jobs', data)[0], 409)

    def test_timeout_and_cancel(self):
        _, job = self.submit('sleep 20', timeout=1)
        self.assertEqual(self.finish(job['id'])['status'], 'timed_out')
        _, job = self.submit('sleep 20')
        for _ in range(30):
            code, _ = self.request('DELETE', PREFIX + '/jobs/' + job['id'])
            if code == 200:
                break
            time.sleep(0.02)
        self.assertEqual(self.finish(job['id'])['status'], 'cancelled')

    def test_file_roundtrip_and_overwrite(self):
        from urllib.parse import urlencode
        path = self.root / 'bytes.bin'
        content = bytes(range(256)) * 50
        data = {'path': str(path), 'content_b64': base64.b64encode(content).decode()}
        code, result = self.request('PUT', PREFIX + '/file', data)
        self.assertEqual(code, 200, result)
        self.assertEqual(result['sha256'], hashlib.sha256(content).hexdigest())
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.request('PUT', PREFIX + '/file', data)[0], 409)
        data['overwrite'] = True
        self.assertEqual(self.request('PUT', PREFIX + '/file', data)[0], 200)
        code, result = self.request('GET', PREFIX + '/file?' + urlencode({'path': str(path)}))
        self.assertEqual(code, 200)
        self.assertEqual(base64.b64decode(result['content_b64']), content)
        link = self.root / 'link'
        link.symlink_to(path)
        data['path'] = str(link)
        self.assertEqual(self.request('PUT', PREFIX + '/file', data)[0], 400)

    def test_output_bound(self):
        _, job = self.submit("python3 -c 'print(\"a\" * 2200000)' ")
        done = self.finish(job['id'])
        self.assertTrue(done['output_truncated'])
        self.assertEqual((self.state / (job['id'] + '.log')).stat().st_size, 2 * 1024 * 1024)
        self.assertEqual(done['exit_code'], 0)

    def test_restart_preserves_nonce_and_marks_jobs(self):
        headers = self.headers('GET', PREFIX + '/health', b'')
        self.assertEqual(self.request('GET', PREFIX + '/health', headers=headers)[0], 200)
        _, job = self.submit('sleep 20')
        time.sleep(0.1)
        self.stop()
        self.start()
        self.assertEqual(self.request('GET', PREFIX + '/health', headers=headers)[0], 401)
        self.assertEqual(self.finish(job['id'])['status'], 'interrupted')


    def test_real_client_roundtrip(self):
        import urllib.request
        from client import Client
        c = Client('https://example.invalid', self.key)
        c.origin = 'http://127.0.0.1:' + str(self.port)
        c.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.assertTrue(c.request('GET', PREFIX + '/health')['ok'])
        job = c.request('POST', PREFIX + '/jobs', {'id': uuid.uuid4().hex, 'command': 'printf real-client', 'cwd': str(self.root), 'timeout': 5})
        self.assertEqual(base64.b64decode(self.finish(job['id'])['output_b64']), b'real-client')
        with self.assertRaises(ValueError):
            Client('http://example.invalid', self.key)
        with self.assertRaises(ValueError):
            Client('https://example.invalid/unexpected-path', self.key)


class NginxTest(unittest.TestCase):
    def test_matches_only_target_https_block(self):
        text = '''# server { listen 443 ssl; server_name lexicalmathical.com; }
server { listen 80; server_name lexicalmathical.com; return 301 https://$host$request_uri; }
server { listen 443 ssl; server_name other.com; }
server {
 listen [::]:443 ssl;
 server_name lexicalmathical.com www.lexicalmathical.com;
 location / { return 200 "server { fake }"; }
}
'''
        positions = candidate(text, 'lexicalmathical.com')
        self.assertEqual(len(positions), 1)
        p = positions[0]
        modified = text[:p] + '\n' + INCLUDE + text[p:]
        self.assertEqual(modified.replace('\n' + INCLUDE, ''), text)
        self.assertEqual(len(candidate(modified, 'lexicalmathical.com')), 1)

    def test_duplicate_vhosts_are_detected(self):
        text = 'server { listen 443 ssl; server_name lexicalmathical.com; }\n' * 2
        self.assertEqual(len(candidate(text, 'lexicalmathical.com')), 2)


if __name__ == '__main__':
    unittest.main()
