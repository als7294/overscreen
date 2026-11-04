#!/usr/bin/env python3
"""Phone-remote relay for SamSUCKS (runs on the VPS, stdlib only).

  GET  /r              the phone remote page (secret travels in the #fragment)
  POST /k/<secret>     body: a Samsung key name such as KEY_UP, or APP:<app id>
  GET  /tv/<secret>    the TV long-polls this and gets a JSON list of keys

The secret is 32 hex characters made on the TV and shown only in its QR code.
Run: python3 remote-relay.py [port]      (default 7311)
"""
import json
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = re.compile(r'^[0-9a-f]{32}$')
KEY = re.compile(r'^(KEY_[A-Z0-9_]{1,24}|APP:[A-Za-z0-9._-]{1,64})$')
MAX_QUEUE = 50
MAX_AGE = 10  # seconds; keys older than this are dropped (TV was away)

lock = threading.Condition()
queues = {}  # secret -> [(time, key)]


def push(secret, key):
    with lock:
        q = queues.setdefault(secret, [])
        q.append((time.time(), key))
        del q[:-MAX_QUEUE]
        lock.notify_all()


def take(secret, wait):
    deadline = time.time() + wait
    with lock:
        while True:
            q = queues.get(secret)
            if q:
                fresh = [k for t, k in q if time.time() - t < MAX_AGE]
                queues[secret] = []
                if fresh:
                    return fresh
            left = deadline - time.time()
            if left <= 0:
                return []
            lock.wait(left)


PAGE = open(__file__.replace('remote-relay.py', 'remote.html'), 'rb').read() if __name__ == '__main__' else b''


class Handler(BaseHTTPRequestHandler):
    def send(self, code, body, ctype='application/json'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ('/r', '/r/'):
            return self.send(200, PAGE, 'text/html; charset=utf-8')
        m = re.match(r'^/tv/([0-9a-f]+)$', self.path)
        if m and SECRET.match(m.group(1)):
            return self.send(200, json.dumps(take(m.group(1), 25)).encode())
        self.send(404, b'{}')

    def do_POST(self):
        m = re.match(r'^/k/([0-9a-f]+)$', self.path)
        length = min(int(self.headers.get('Content-Length') or 0), 100)
        key = self.rfile.read(length).decode('ascii', 'replace').strip()
        if m and SECRET.match(m.group(1)) and KEY.match(key):
            push(m.group(1), key)
            return self.send(200, b'{"ok":true}')
        self.send(400, b'{"ok":false}')

    def log_message(self, *args):
        pass  # don't log URLs: they contain the secret


def selftest():
    s = 'a' * 32
    push(s, 'KEY_UP')
    push(s, 'APP:9Ur5IzDKqV.TizenYouTube')
    assert take(s, 0) == ['KEY_UP', 'APP:9Ur5IzDKqV.TizenYouTube']
    assert take(s, 0) == []
    assert not KEY.match('KEY_UP; rm -rf') and not SECRET.match('nothex')
    print('relay selftest ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['--test']:
        selftest()
    else:
        port = int(sys.argv[1]) if sys.argv[1:] else 7311
        ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
