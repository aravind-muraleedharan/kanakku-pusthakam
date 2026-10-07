#!/usr/bin/env python3
"""Rebuild vendor/flask-bundle.zip, the bundled copy of Flask and its dependencies.

The app adds this zip to Python's import path when Flask isn't installed, so users don't need pip or internet.
All bundled packages are pure Python (BSD-3-Clause licensed); see vendor/LICENSES.md.

Usage (needs internet once, on the maintainer's machine):
    python3 -m venv /tmp/vb && /tmp/vb/bin/pip install -r requirements.txt
    /tmp/vb/bin/python tools/build_vendor.py
"""
import importlib.metadata as md
import os
import zipfile

PACKAGES = ["flask", "werkzeug", "jinja2", "markupsafe", "itsdangerous", "click", "blinker"]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "vendor", "flask-bundle.zip")


def main():
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for name in PACKAGES:
            dist = md.distribution(name)
            top = (dist.read_text("top_level.txt") or name).split()[0]
            base = str(dist.locate_file(""))
            pkg_dir = os.path.join(base, top)
            for root, dirs, files in os.walk(pkg_dir):
                dirs[:] = [d for d in dirs if d != "__pycache__"]
                for f in files:
                    if f.endswith((".pyc", ".so", ".pyd")):
                        continue      # pure Python only (MarkupSafe falls back to its Python version)
                    full = os.path.join(root, f)
                    z.write(full, os.path.relpath(full, base))
                # zipimport needs an __init__.py in every package directory (flask/sansio has none)
                if root != pkg_dir and "__init__.py" not in files and any(f.endswith(".py") for f in files):
                    z.writestr(os.path.relpath(os.path.join(root, "__init__.py"), base), "")
            # keep the package metadata (version lookups) and licence
            meta_dir = f"{dist.metadata['Name'].lower().replace('-', '_')}-{dist.version}.dist-info"
            for f in ("METADATA", "top_level.txt"):
                text = dist.read_text(f)
                if text:
                    z.writestr(f"{meta_dir}/{f}", text)
            for f in dist.files or []:
                if "LICENSE" in str(f).upper():
                    z.write(dist.locate_file(f), f"licenses/{name}-LICENSE.txt")
                    break
            print(f"  {name} {dist.version}")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
