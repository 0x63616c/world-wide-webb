"""Owned loopback-only playback fixture. No home services or real credentials.

Run from this folder with python3 server.py. Terminates with its owning job.
GET /stats exposes counts only; it never records or prints header values.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re
import sys

VIDEO = Path(__file__).with_name("synthetic.mp4").read_bytes()
COUNTS = {"authenticated_ranges": 0, "denied": 0, "redirects": 0, "redirect_followed": 0}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path == "/stats":
            body = json.dumps(COUNTS).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/redirect":
            COUNTS["redirects"] += 1
            self.send_response(302)
            self.send_header("Location", f"http://localhost:{self.server.server_port}/redirect-target")
            self.end_headers()
            return
        if self.path == "/redirect-target":
            COUNTS["redirect_followed"] += 1
            self.send_error(403)
            return
        if self.path != "/synthetic.mp4":
            self.send_error(404)
            return
        if (self.headers.get("CF-Access-Client-Id") != "synthetic-id"
                or self.headers.get("CF-Access-Client-Secret") != "synthetic-secret"):
            COUNTS["denied"] += 1
            self.send_error(403)
            return
        match = re.fullmatch(r"bytes=(\d+)-(\d+)", self.headers.get("Range", ""))
        if not match:
            self.send_error(416)
            return
        start, end = map(int, match.groups())
        if start >= len(VIDEO) or start > end:
            self.send_error(416)
            return
        end = min(end, len(VIDEO) - 1)
        COUNTS["authenticated_ranges"] += 1
        self.send_response(206)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{len(VIDEO)}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        try:
            self.wfile.write(VIDEO[start:end + 1])
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 18733), Handler)
    print(server.server_port, flush=True)
    server.serve_forever()
