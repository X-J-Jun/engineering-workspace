"""Shared project workspace. Run behind HTTPS for network access."""
import argparse
import base64
import binascii
import getpass
import hashlib
import hmac
import json
from pathlib import Path
import secrets
import sqlite3
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGE = Path(__file__).with_name("index.html")
MAX_BODY = 8 * 1024 * 1024
COLLECTIONS = ("projects", "tasks", "risks")
EMPTY = {"version": 2, **{name: [] for name in COLLECTIONS}}
DB = None
ROLES = ("owner", "manager", "submitter", "reviewer", "viewer")
MANAGERS = ("owner", "manager")
LOCKED = ("pending", "accepted")


def database():
    return closing(sqlite3.connect(DB, timeout=10))


def initialize():
    with database() as db, db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                name TEXT PRIMARY KEY, salt BLOB NOT NULL, password BLOB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workspace (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                revision INTEGER NOT NULL, state TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS revisions (
                revision INTEGER PRIMARY KEY, actor TEXT NOT NULL,
                saved_at TEXT DEFAULT CURRENT_TIMESTAMP, state TEXT NOT NULL
            );
        """)
        if "role" not in {column[1] for column in db.execute("PRAGMA table_info(users)")}:
            db.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS single_owner ON users(role) WHERE role = 'owner'")
        db.execute("INSERT OR IGNORE INTO workspace VALUES (1, 0, ?)", (json.dumps(EMPTY),))


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)


def validate_state(state):
    if not isinstance(state, dict) or set(state) != {"version", *COLLECTIONS} or state["version"] != 2:
        return False
    indexed = {}
    for name in COLLECTIONS:
        records = state[name]
        if not isinstance(records, list):
            return False
        indexed[name] = {}
        for record in records:
            if not isinstance(record, dict):
                return False
            key = record.get("id")
            if not isinstance(key, str) or not key or key in indexed[name]:
                return False
            indexed[name][key] = record
    for name in ("tasks", "risks"):
        for record in indexed[name].values():
            project = record.get("projectId")
            if not isinstance(project, str) or project not in indexed["projects"]:
                return False
    for task in indexed["tasks"].values():
        if task.get("level") == 2:
            parent_id = task.get("parentId")
            parent = indexed["tasks"].get(parent_id) if isinstance(parent_id, str) else None
            if not parent or parent.get("level") != 1 or parent["projectId"] != task["projectId"]:
                return False
    return True


def scoped_state(state, actor, role):
    if role in (*MANAGERS, "viewer"):
        return state
    if role == "submitter":
        visible = [task for task in state["tasks"] if task.get("level") == 2 and task.get("owner") == actor]
    else:
        visible = [task for task in state["tasks"] if task.get("acceptanceStatus") == "pending"]
    projects = {task["projectId"] for task in visible}
    parents = {task.get("parentId") for task in visible}
    visible += [task for task in state["tasks"] if task["id"] in parents]
    visible_ids = {task["id"] for task in visible}

    def scoped_project(project):
        result = {key: project[key] for key in ("id", "name") if key in project}
        workspace = project.get("robotWorkspace")
        if isinstance(workspace, dict):
            targets = workspace.get("targets")
            targets = targets if isinstance(targets, dict) else {}
            target_fields = ("durationWeeks", "budgetCny", "cycleSeconds", "positionMm",
                             "interlockPercent", "sourceDate")
            links = workspace.get("links")
            links = links if isinstance(links, dict) else {}
            filtered = {}
            for device, link in links.items():
                if not isinstance(device, str) or not isinstance(link, dict):
                    continue
                task_ids = link.get("taskIds")
                task_ids = task_ids if isinstance(task_ids, list) else []
                filtered[device] = {
                    "taskIds": [item for item in task_ids if isinstance(item, str) and item in visible_ids],
                    "riskIds": []
                }
            result["robotWorkspace"] = {
                "enabled": workspace.get("enabled") is True,
                "targets": {key: targets[key] for key in target_fields if key in targets},
                "links": filtered
            }
        return result

    return {"version": 2, "projects": [
        scoped_project(project)
        for project in state["projects"] if project["id"] in projects
    ], "tasks": visible, "risks": []}


def manager_can_save(previous, proposed):
    old_tasks = {task["id"]: task for task in previous["tasks"]}
    new_tasks = {task["id"]: task for task in proposed["tasks"]}
    for task in new_tasks.values():
        old = old_tasks.get(task["id"], {})
        for field, default in (("acceptanceStatus", "not_ready"), ("acceptanceReturnReason", ""),
                               ("submittedBy", ""), ("reviewedBy", "")):
            if task.get(field, default) != old.get(field, default):
                return False
        if old.get("acceptanceStatus") in LOCKED:
            for field in ("owner", "projectId", "status", "deliverable", "acceptanceCriteria", "acceptanceGap"):
                if (task.get(field) or "") != (old.get(field) or ""):
                    return False
            if task.get("requiresAcceptance") is False:
                return False
    return not any(task.get("acceptanceStatus") in LOCKED and key not in new_tasks
                   for key, task in old_tasks.items())


def apply_task_action(state, actor, role, request):
    task = next((task for task in state["tasks"] if task["id"] == request.get("taskId")), None)
    if not task or task.get("level") != 2:
        return False
    action = request.get("action")
    acceptance = task.get("acceptanceStatus", "not_ready")
    assigned = task.get("owner") == actor
    if action in ("update", "submit"):
        if role != "owner" and not (role == "submitter" and assigned):
            return False
        if acceptance in LOCKED:
            return False
        if action == "update":
            status, deliverable = request.get("status"), request.get("deliverable")
            if status not in ("todo", "doing", "done") or not isinstance(deliverable, str) or not deliverable.strip():
                return False
            task.update(status=status, deliverable=deliverable.strip())
        else:
            required = task.get("requiresAcceptance")
            if required is None:
                required = bool(task.get("acceptanceCriteria") or task.get("acceptanceGap") or
                                acceptance == "returned")
            if not required or task.get("status") != "done" or not str(task.get("deliverable") or "").strip():
                return False
            task.update(acceptanceStatus="pending", submittedBy=actor, reviewedBy="")
        return True
    if action not in ("approve", "return") or acceptance != "pending":
        return False
    if role != "owner" and (role != "reviewer" or assigned or task.get("submittedBy") == actor):
        return False
    if action == "return":
        reason = request.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            return False
        task["acceptanceReturnReason"] = reason.strip()
    task.update(acceptanceStatus="accepted" if action == "approve" else "returned", reviewedBy=actor)
    return True


class WorkspaceHandler(BaseHTTPRequestHandler):
    def reply(self, status, body=b"", content_type="application/json", **headers):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def reply_json(self, status, payload):
        self.reply(status, json.dumps(payload, ensure_ascii=True, allow_nan=False).encode())

    def authenticate(self):
        scheme, _, token = self.headers.get("Authorization", "").partition(" ")
        if scheme.lower() == "basic" and len(token) <= 2048:
            try:
                credentials = base64.b64decode(token, validate=True).decode()
                name, separator, password = credentials.partition(":")
                if separator:
                    with database() as db:
                        account = db.execute("SELECT salt, password FROM users WHERE name = ?", (name,)).fetchone()
                    salt, expected = account or (bytes(16), bytes(32))
                    if hmac.compare_digest(password_hash(password, salt), expected) and account:
                        return name
            except (binascii.Error, UnicodeError):
                pass
        self.reply(401, b"{}", **{"WWW-Authenticate": 'Basic realm="Project workspace", charset="UTF-8"'})
        return None

    def do_GET(self):
        actor = self.authenticate()
        if actor is None:
            return
        if self.path in ("/", "/index.html"):
            self.reply(200, PAGE.read_bytes(), "text/html; charset=utf-8")
        elif self.path in ("/robot-model.js", "/robot-workstation.js", "/robot-workstation.css",
                           "/robot-integration.js", "/robot-integration.css",
                           "/robot-line-preview.webp"):
            resource = PAGE.with_name(self.path[1:])
            if resource.is_file():
                content_type = {
                    ".js": "text/javascript; charset=utf-8",
                    ".css": "text/css; charset=utf-8",
                    ".webp": "image/webp",
                }[resource.suffix]
                self.reply(200, resource.read_bytes(), content_type)
            else:
                self.reply_json(404, {"error": "not_found"})
        elif self.path == "/api/members":
            with database() as db:
                role = db.execute("SELECT role FROM users WHERE name = ?", (actor,)).fetchone()
                members = db.execute("SELECT name, role FROM users ORDER BY name").fetchall() if role == ("owner",) else None
            if members is None:
                self.reply_json(403, {"error": "forbidden"})
            else:
                self.reply_json(200, {"members": [{"name": name, "role": role} for name, role in members]})
        elif self.path == "/api/state":
            with database() as db:
                role = db.execute("SELECT role FROM users WHERE name = ?", (actor,)).fetchone()
                revision, state = db.execute("SELECT revision, state FROM workspace WHERE id = 1").fetchone()
            if not role:
                self.reply_json(403, {"error": "forbidden"})
                return
            self.reply_json(200, {"state": {**scoped_state(json.loads(state), actor, role[0]),
                                            "revision": revision}, "actor": actor, "role": role[0]})
        else:
            self.reply_json(404, {"error": "not_found"})

    def do_POST(self):
        actor = self.authenticate()
        if actor is None:
            return
        if self.path not in ("/api/sync", "/api/task-action", "/api/members"):
            self.reply_json(404, {"error": "not_found"})
            return
        if self.headers.get_content_type() != "application/json" or self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.reply_json(415, {"error": "invalid_request"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BODY:
                self.reply_json(413, {"error": "invalid_size"})
                return
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError("invalid request")
            if self.path == "/api/members":
                self.manage_member(actor, payload)
                return
            revision = payload["revision"]
            if type(revision) is not int:
                raise ValueError("invalid revision")
            proposed = payload.get("state")
            if self.path == "/api/sync":
                if not validate_state(proposed):
                    raise ValueError("invalid state")
                json.dumps(proposed, allow_nan=False)
        except (ValueError, KeyError, TypeError, RecursionError):
            self.reply_json(400, {"error": "invalid_state"})
            return
        with database() as db, db:
            db.execute("BEGIN IMMEDIATE")
            account = db.execute("SELECT role FROM users WHERE name = ?", (actor,)).fetchone()
            role = account[0] if account else None
            latest, raw = db.execute("SELECT revision, state FROM workspace WHERE id = 1").fetchone()
            current = json.loads(raw)
            status, error = 200, ""
            if (not role or payload.get("actor", actor) != actor or
                    (self.path == "/api/sync" and role not in MANAGERS)):
                status, error = 403, "forbidden"
            elif self.path == "/api/sync" and proposed == current:
                revision = latest
            elif revision != latest:
                status, error = 409, "revision_conflict"
            elif (self.path == "/api/sync" and
                  (type(payload.get("robotWorkspaceVersion")) is not int or
                   payload["robotWorkspaceVersion"] != 1) and
                  any("robotWorkspace" in project for project in current["projects"])):
                status, error = 409, "client_upgrade_required"
            elif self.path == "/api/task-action":
                if not apply_task_action(current, actor, role, payload):
                    status, error = 403, "forbidden"
            elif role == "manager" and not manager_can_save(current, proposed):
                status, error = 403, "forbidden"
            else:
                current = proposed
            if status == 200 and current != json.loads(raw):
                revision = latest + 1
                serialized = json.dumps(current, sort_keys=True, allow_nan=False)
                db.execute("UPDATE workspace SET revision = ?, state = ? WHERE id = 1", (revision, serialized))
                db.execute("INSERT INTO revisions (revision, actor, state) VALUES (?, ?, ?)",
                           (revision, actor, serialized))
        if status != 200:
            self.reply_json(status, {"error": error})
        else:
            self.reply_json(200, {"state": {**scoped_state(current, actor, role), "revision": revision},
                                  "actor": actor, "role": role})


    def manage_member(self, actor, payload):
        name, action = payload.get("name"), payload.get("action")
        role, password = payload.get("role"), payload.get("password", "")
        if (not isinstance(name, str) or not name or name != name.strip() or ":" in name or
                any(ord(character) < 32 for character in name) or len(name) > 80 or
                action not in ("save", "remove") or not isinstance(password, str) or len(password) > 200 or
                (action == "save" and (role not in ROLES[1:] or (password and len(password) < 12)))):
            self.reply_json(400, {"error": "invalid_member"})
            return
        with database() as db, db:
            db.execute("BEGIN IMMEDIATE")
            account = db.execute("SELECT role FROM users WHERE name = ?", (actor,)).fetchone()
            existing = db.execute("SELECT role FROM users WHERE name = ?", (name,)).fetchone()
            if account != ("owner",) or existing == ("owner",):
                status = 403
            elif action == "remove":
                db.execute("DELETE FROM users WHERE name = ?", (name,))
                status = 200
            elif password:
                salt = secrets.token_bytes(16)
                db.execute("""INSERT INTO users (name, salt, password, role) VALUES (?, ?, ?, ?)
                              ON CONFLICT(name) DO UPDATE SET
                                  salt = excluded.salt, password = excluded.password, role = excluded.role""",
                           (name, salt, password_hash(password, salt), role))
                status = 200
            elif existing:
                db.execute("UPDATE users SET role = ? WHERE name = ?", (role, name))
                status = 200
            else:
                status = 400
        self.reply_json(status, {"ok": status == 200})


def main():
    global DB
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=Path(__file__).with_name("workspace.sqlite3"))
    commands = parser.add_subparsers(dest="command", required=True)
    add = commands.add_parser("set-user", help="Create an account or reset its password")
    add.add_argument("name")
    add.add_argument("--role", choices=ROLES)
    remove = commands.add_parser("remove-user", help="Revoke an account")
    remove.add_argument("name")
    serve = commands.add_parser("serve", help="Serve on this computer")
    serve.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    DB = args.db.resolve()
    initialize()
    if args.command == "set-user":
        if not args.name.strip() or args.name != args.name.strip() or ":" in args.name:
            parser.error("Invalid account name")
        password = getpass.getpass("Password (at least 12 characters): ")
        if len(password) < 12 or password != getpass.getpass("Repeat password: "):
            parser.error("Password is too short or did not match")
        salt = secrets.token_bytes(16)
        with database() as db, db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT role FROM users WHERE name = ?", (args.name,)).fetchone()
            role = args.role or (existing[0] if existing else "viewer")
            owner = db.execute("SELECT name FROM users WHERE role = 'owner'").fetchone()
            if (role == "owner" and owner and owner[0] != args.name) or (
                existing and existing[0] == "owner" and role != "owner"
            ):
                parser.error("The workspace owner cannot be replaced or demoted")
            db.execute("""INSERT INTO users (name, salt, password, role) VALUES (?, ?, ?, ?)
                          ON CONFLICT(name) DO UPDATE SET
                              salt = excluded.salt, password = excluded.password, role = excluded.role""",
                       (args.name, salt, password_hash(password, salt), role))
    elif args.command == "remove-user":
        with database() as db, db:
            db.execute("BEGIN IMMEDIATE")
            account = db.execute("SELECT role FROM users WHERE name = ?", (args.name,)).fetchone()
            if account and account[0] == "owner":
                parser.error("The workspace owner cannot be removed")
            db.execute("DELETE FROM users WHERE name = ?", (args.name,))
    else:
        with ThreadingHTTPServer(("127.0.0.1", args.port), WorkspaceHandler) as server:
            print(f"http://127.0.0.1:{args.port}/", flush=True)
            server.serve_forever()


if __name__ == "__main__":
    main()
