"""A tiny stand-in for Supabase Storage's REST API, for testing backup.sh locally.

Implements only what backup.sh calls, on 127.0.0.1:
  POST   /storage/v1/object/{bucket}/{name}       upload (400 if the name exists)
  POST   /storage/v1/object/list/{bucket}         list top-level objects
  DELETE /storage/v1/object/{bucket}              delete {"prefixes": [...]}

Usage: python fake_storage.py <data dir> <port file> <expected key>
Objects live in <data dir>/objects/<name>; their created_at in <data dir>/index.json, which a
test may seed before starting. Every request must carry `apikey: <expected key>`, and an
`Authorization: Bearer` header only when the key is a JWT, as Supabase's new secret keys
must not be sent as a Bearer token. The port it bound is written to <port file>.
"""

import json
import sys
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DATA = Path(sys.argv[1])
PORT_FILE = Path(sys.argv[2])
KEY = sys.argv[3]
OBJECTS = DATA / "objects"
INDEX = DATA / "index.json"
PREFIX = "/storage/v1/object/"


def load_index() -> dict:
    return json.loads(INDEX.read_text("utf-8")) if INDEX.exists() else {}


def save_index(index: dict) -> None:
    INDEX.write_text(json.dumps(index, indent=1), "utf-8")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # keep test output quiet
        pass

    def reply(self, status: int, body) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self) -> bytes:
        return self.rfile.read(int(self.headers.get("Content-Length") or 0))

    def authorised(self) -> bool:
        bearer = self.headers.get("Authorization")
        expected_bearer = f"Bearer {KEY}" if KEY.startswith("eyJ") else None
        if self.headers.get("apikey") != KEY or bearer != expected_bearer:
            self.reply(401, {"error": "Unauthorized"})
            return False
        return True

    def do_POST(self):
        if not self.authorised() or not self.path.startswith(PREFIX):
            return
        rest = self.path[len(PREFIX) :]
        payload = self.body()
        index = load_index()
        if rest.startswith("list/"):
            query = json.loads(payload)
            if "prefix" not in query:
                return self.reply(400, {"error": "prefix is required"})
            items = [
                {"name": n, "id": f"id-{n}", "created_at": c, "metadata": {}}
                for n, c in sorted(index.items(), key=lambda kv: kv[1])
            ]
            items.append({"name": "a-folder", "id": None, "created_at": None})
            return self.reply(200, items[: query.get("limit", 100)])
        bucket, _, name = rest.partition("/")
        if bucket != "backups" or not name or "/" in name:
            return self.reply(400, {"error": "bad path"})
        if name in index:
            return self.reply(400, {"error": "Duplicate", "message": "The resource already exists"})
        OBJECTS.mkdir(parents=True, exist_ok=True)
        (OBJECTS / name).write_bytes(payload)
        index[name] = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        save_index(index)
        self.reply(200, {"Key": f"{bucket}/{name}"})

    def do_DELETE(self):
        if not self.authorised():
            return
        if self.path != PREFIX + "backups":
            return self.reply(400, {"error": "bad path"})
        prefixes = json.loads(self.body()).get("prefixes") or []
        if not prefixes:
            return self.reply(400, {"error": "prefixes must have at least 1 item"})
        index = load_index()
        gone = []
        for name in prefixes:
            if name in index:
                del index[name]
                (OBJECTS / name).unlink(missing_ok=True)
                gone.append({"name": name})
        save_index(index)
        self.reply(200, gone)


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
PORT_FILE.write_text(str(server.server_address[1]), "utf-8")
server.serve_forever()
