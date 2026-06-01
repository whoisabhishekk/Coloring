#!/usr/bin/env python3
"""
Local Proxy Server for Wingo Strategy Dashboard
Serves static files AND proxies API requests to cooe02.in to avoid CORS issues.
Run: python3 server.py
Open: http://localhost:8080
"""

import http.server
import urllib.request
import urllib.error
import json
import os
import sys

PORT = int(os.environ.get("PORT", 8080))
API_HOST = "https://cooe02.in"

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Proxy API requests
        if self.path.startswith('/api/'):
            self.proxy_request()
        else:
            # Serve static files normally
            super().do_GET()

    def proxy_request(self):
        # Strip '/api' prefix and forward to target
        target_path = self.path[4:]  # Remove '/api'
        target_url = f"{API_HOST}{target_path}"

        try:
            req = urllib.request.Request(target_url)
            req.add_header('User-Agent', 'Mozilla/5.0')
            req.add_header('Accept', 'application/json')

            with urllib.request.urlopen(req, timeout=15) as response:
                data = response.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(data)

        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        # Custom logging - less noisy
        if '/api/' in str(args[0]):
            sys.stderr.write(f"[PROXY] {args[0]}\n")
        elif not any(ext in str(args[0]) for ext in ['.css', '.js', '.ico', '.png']):
            sys.stderr.write(f"[FILE]  {args[0]}\n")

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.HTTPServer(('', PORT), ProxyHandler)
    print(f"🎰 Wingo Strategy Dashboard")
    print(f"   Server: http://localhost:{PORT}")
    print(f"   API Proxy: {API_HOST} → /api/*")
    print(f"   Press Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()
