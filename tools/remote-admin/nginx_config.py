#!/usr/bin/env python3
"""Locate HTTPS server blocks without rewriting unrelated Nginx directives."""
import re
from pathlib import Path

INCLUDE = '    include /etc/sketch-rts-admin/nginx-location.conf; # sketch-admin-managed\n'
TOKEN = re.compile(r'\#[^\n]*|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[{};]|[^\s{};#]+')


def server_blocks(text):
    tokens = [m for m in TOKEN.finditer(text) if not m.group().startswith('#')]
    for i, token in enumerate(tokens[:-1]):
        if token.group() != 'server' or tokens[i + 1].group() != '{':
            continue
        depth = 1
        directives, directive = [], []
        for t in tokens[i + 2:]:
            value = t.group()
            if value == '{':
                depth += 1
                directive = []
            elif value == '}':
                depth -= 1
                directive = []
                if depth == 0:
                    yield tokens[i + 1].end(), directives
                    break
            elif depth == 1 and value == ';':
                directives.append(directive)
                directive = []
            elif depth == 1:
                directive.append(value.strip('\"\''))


def candidate(text, domain):
    result = []
    for position, directives in server_blocks(text):
        names = [d[1:] for d in directives if d and d[0] == 'server_name']
        tls = any(d and d[0] == 'listen' and 'ssl' in d and
                  any(v == '443' or v.endswith(':443') for v in d[1:]) for d in directives)
        if tls and any(domain in group for group in names):
            result.append(position)
    return result


def discover(dump, domain):
    paths = set(re.findall(r'^# configuration file (/.+):$', dump, re.M))
    found = []
    for name in sorted(paths):
        path = Path(name).resolve()
        if path.is_file():
            for position in candidate(path.read_text(), domain):
                value = (str(path), position)
                if value not in found:
                    found.append(value)
    return found
