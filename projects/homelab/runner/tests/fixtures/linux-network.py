#!/usr/bin/env python3
"""Explicit disposable-guest network gate. No credentials or job code are used."""
import argparse
import ipaddress
import json
import socket
import socketserver
import threading
import urllib.request

MAGIC = b'homelab-isolation-proof\n'


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.sendall(MAGIC)


class Server6(socketserver.ThreadingTCPServer):
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        super().server_bind()


def serve():
    with socketserver.ThreadingTCPServer(('0.0.0.0', 45951), Handler) as ipv4:
        with Server6(('::', 45952), Handler) as ipv6:
            threading.Thread(target=ipv4.serve_forever, daemon=True).start()
            ipv6.serve_forever()


def probe(targets_path):
    targets = json.load(open(targets_path))
    results = []
    for target in targets:
        address = target['address']
        parsed = ipaddress.ip_address(address.split('%', 1)[0])
        if not (parsed.is_private or parsed in ipaddress.ip_network('100.64.0.0/10')):
            raise ValueError('proof targets must be host, LAN, tailnet or peer addresses')
        if target['port'] not in (45951, 45952) and not (target['label'] == 'lan_router_https' and target['port'] == 443):
            raise ValueError('only the fixed proof listener ports are allowed')
        connected = False
        received = False
        error = None
        try:
            with socket.create_connection((address, target['port']), timeout=3) as stream:
                connected = True
                if target['port'] != 443:
                    received = stream.recv(128) == MAGIC
        except OSError as failure:
            error = type(failure).__name__
        results.append({'label': target['label'], 'address': address,
                        'port': target['port'], 'connected': connected,
                        'proof_listener': received, 'error': error})
    # Positive public traffic control: a timeout against private addresses alone
    # cannot establish working internet access or prove a selective block.
    with urllib.request.urlopen('https://github.com', timeout=15) as response:
        public_status = response.status
    print(json.dumps({'schema': 1, 'public_https_status': public_status,
                      'targets': results}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--serve', action='store_true')
    mode.add_argument('--probe')
    args = parser.parse_args()
    if args.serve:
        serve()
    else:
        probe(args.probe)
