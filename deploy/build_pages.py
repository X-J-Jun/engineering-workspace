"""Build the static GitHub Pages artifact from the local workspace page."""
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "").strip()
if not re.fullmatch(r"https://[a-z0-9]+\.supabase\.co", url):
    raise SystemExit("Set SUPABASE_URL to the hosted project URL")
if not re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]+", key):
    raise SystemExit("Set SUPABASE_PUBLISHABLE_KEY to a publishable key")
html = (ROOT / "index.html").read_text(encoding="utf-8")
adapter = (ROOT / "deploy" / "cloud.js").read_text(encoding="utf-8")
config = json.dumps({"url": url, "key": key})
entry = "<script>\n'use strict';\n\nconst STORAGE_KEY"
if html.count(entry) != 1:
    raise SystemExit("Could not locate the workspace script")
html = html.replace(entry, f"<script>window.workspaceCloudConfig = {config};\n{adapter}</script>\n{entry}")
output = ROOT / "_site"
output.mkdir(exist_ok=True)
(output / "index.html").write_text(html, encoding="utf-8")

