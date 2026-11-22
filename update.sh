#!/usr/bin/env bash
# Update the packages the app uses (Flask and the six it needs), kept inside vendor/flask-bundle.zip.
# Run it now and then, when you're online. The app itself stays fully offline: start.sh never uses this.
#
#   ./update.sh            check for newer versions, ask, update (tests must pass, or nothing changes)
#   ./update.sh --check    only show what's installed and what's newest
#   ./update.sh --undo     put the previous bundle back
#
# Restart the app afterwards to use the new packages.
cd "$(dirname "$0")" || exit 1
SCRIPT=$(cat <<'PY'
import os, re, shutil, subprocess, sys, tempfile, zipfile

ROOT = os.getcwd()
VENDOR = os.path.join(ROOT, "vendor")
BUNDLE = os.path.join(VENDOR, "flask-bundle.zip")
PREVIOUS = os.path.join(VENDOR, "flask-bundle.previous.zip")
NEW = os.path.join(VENDOR, "flask-bundle.new.zip")
PACKAGES = ["flask", "werkzeug", "jinja2", "markupsafe", "itsdangerous", "click", "blinker"]
args = sys.argv[1:]


def say(msg=""):
    print(msg, flush=True)


def norm(name):
    return re.sub(r"[-_.]+", "_", name).lower()


def bundle_versions(path):
    """{package: version} from the dist-info folders inside a bundle."""
    out = {}
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            m = re.match(r"([A-Za-z0-9_.]+)-([^-/]+)\.dist-info/METADATA$", n)
            if m:
                out[norm(m.group(1))] = m.group(2)
    return out


def write_pins(versions):
    """Keep requirements.txt's pinned versions in step with the bundle."""
    req = os.path.join(ROOT, "requirements.txt")
    if not os.path.exists(req):
        return
    text = open(req).read()
    for p in PACKAGES:
        if norm(p) in versions:
            text = re.sub(rf"(?im)^({re.escape(p)})==[^\s#]+", lambda m, v=versions[norm(p)]: f"{m.group(1)}=={v}", text)
    open(req, "w").write(text)


def show(title, versions):
    say(title)
    for p in PACKAGES:
        say(f"  {p:<14}{versions.get(norm(p), '?')}")


# A quick run through the app with the new packages: start, log in, add a transaction, read reports, export Excel.
# It uses a temporary folder for its database, so your data is never touched.
CHECK = r"""
import os, tempfile
from datetime import date
from backend import create_app
from backend.services import totp
d = tempfile.mkdtemp()
app = create_app({"TESTING": True, "DB_PATH": os.path.join(d, "x.db"), "BACKUP_DIR": os.path.join(d, "b"),
                  "SECRET_KEY": b"update-check-key-update-check-key"})
c = app.test_client()
def call(method, url, **kw):
    for h in ("Kanakku Pusthakam", "KanakkuPusthakam"):
        r = c.open(url, method=method, headers={"X-Requested-With": h}, **kw)
        if r.status_code != 400 or b"header" not in r.data:
            return r
    return r
assert c.get("/").status_code == 200, "home page"
assert call("POST", "/api/auth/register", json={"email": "check@example.com", "password": "Update-check-42",
            "confirm": "Update-check-42"}).status_code in (200, 201), "register"
secret = call("POST", "/api/auth/mfa/begin").get_json()["secret"]
assert call("POST", "/api/auth/mfa/confirm", json={"code": totp.code_at(secret, totp.current_step())}).status_code == 200, "login code"
m = call("GET", "/api/masters").get_json()
bank = next(a["id"] for a in m["accounts"] if a["kind"] == "bank")
cat = next(x["id"] for x in m["categories"] if x["kind"] == "expense" and not x["is_system"])
r = call("POST", "/api/entries", json={"type": "expense", "date": date.today().isoformat(), "amount": "250",
                                       "category_id": cat, "from_account_id": bank})
assert r.status_code in (200, 201), "add a transaction: " + r.get_data(as_text=True)[:200]
assert call("GET", "/api/reports/summary").get_json()["expense"] == 250, "reports"
assert call("GET", "/api/reports/export.xlsx").status_code == 200, "Excel export"
print("ok")
"""

# ---------------------------------------------------------------- undo
if "--undo" in args:
    if not os.path.exists(PREVIOUS):
        sys.exit("There's no previous bundle to go back to.")
    shutil.copy2(BUNDLE, NEW)
    os.replace(PREVIOUS, BUNDLE)
    os.replace(NEW, PREVIOUS)
    write_pins(bundle_versions(BUNDLE))
    show("Back to the previous packages:", bundle_versions(BUNDLE))
    say("Restart the app to use them. (Run --undo again to switch back.)")
    sys.exit(0)

current = bundle_versions(BUNDLE)

# an installed Flask is used instead of the bundle: say so, so updating the bundle isn't a surprise
installed = subprocess.run([sys.executable, "-c", "import flask"], capture_output=True).returncode == 0
if installed:
    say("Note: Flask is also installed on this computer's Python, and the app uses that one, not this bundle.")
    say("      Update it with:  python3 -m pip install --user --upgrade flask werkzeug jinja2 markupsafe itsdangerous click blinker")
    say("")

# ---------------------------------------------------------------- download the newest (or use a folder of wheels)
if subprocess.run([sys.executable, "-m", "pip", "--version"], capture_output=True).returncode != 0:
    sys.exit("pip isn't available. On Ubuntu: sudo apt install python3-pip   (then run this again)")

work = tempfile.mkdtemp(prefix="kp-update-")
try:
    if "--from" in args:                                  # wheels already downloaded elsewhere (no internet here)
        src = os.path.abspath(args[args.index("--from") + 1])
        wheels_dir = src
        say(f"Using the package files in {src}")
    else:
        wheels_dir = os.path.join(work, "wheels")
        say("Checking for newer versions (needs internet)...")
        r = subprocess.run([sys.executable, "-m", "pip", "download", "--quiet", "--disable-pip-version-check",
                            "--only-binary=:all:", "--no-deps", "-d", wheels_dir, *PACKAGES],
                           capture_output=True, text=True)
        if r.returncode != 0:
            say(r.stderr.strip()[-600:])
            sys.exit("Couldn't download. Check the internet connection and try again. Nothing was changed.")

    wheels = {}
    for f in os.listdir(wheels_dir):
        m = re.match(r"([A-Za-z0-9_.]+?)-([0-9][^-]*)-.*\.whl$", f)
        if m and norm(m.group(1)) in map(norm, PACKAGES):
            wheels[norm(m.group(1))] = (m.group(2), os.path.join(wheels_dir, f))
    missing = [p for p in PACKAGES if norm(p) not in wheels]
    if missing:
        sys.exit(f"Missing package files for: {', '.join(missing)}. Nothing was changed.")

    newest = {k: v for k, (v, _) in wheels.items()}
    say("")
    say(f"  {'package':<14}{'in the app':<14}newest")
    changes = []
    for p in PACKAGES:
        a, b = current.get(norm(p), "?"), newest[norm(p)]
        mark = "  <- newer" if a != b else ""
        if a != b:
            changes.append(p)
        say(f"  {p:<14}{a:<14}{b}{mark}")
    say("")
    if not changes:
        say("Everything is up to date. Nothing to do.")
        sys.exit(0)
    if "--check" in args:
        say(f"{len(changes)} update(s) available. Run ./update.sh to install them.")
        sys.exit(0)
    if input(f"Update {', '.join(changes)}? [y/N] ").strip().lower() not in ("y", "yes"):
        sys.exit("Nothing was changed.")

    # ---------------------------------------------------------------- build the new bundle (pure Python files only)
    say("Building the new bundle...")
    with zipfile.ZipFile(NEW, "w", zipfile.ZIP_DEFLATED) as out:
        for p in PACKAGES:
            version, whl = wheels[norm(p)]
            with zipfile.ZipFile(whl) as w:
                names = w.namelist()
                info = next(n.split("/")[0] for n in names if n.endswith(".dist-info/METADATA"))
                tops = (w.read(f"{info}/top_level.txt").decode().split() if f"{info}/top_level.txt" in names
                        else sorted({n.split("/")[0] for n in names if "/" in n and not n.split("/")[0].endswith((".dist-info", ".data"))}))
                dirs = set()
                for n in names:
                    first = n.split("/")[0]
                    if first in tops and not n.endswith((".so", ".pyd", ".pyc", "/")):
                        out.writestr(n, w.read(n))
                        dirs.add(os.path.dirname(n))
                # zipimport needs an __init__.py in every folder with Python files (e.g. flask/sansio has none)
                for d in sorted(dirs):
                    if f"{d}/__init__.py" not in names and any(x.startswith(d + "/") and x.endswith(".py") for x in names):
                        out.writestr(f"{d}/__init__.py", "")
                for f in ("METADATA", "top_level.txt"):
                    if f"{info}/{f}" in names:
                        out.writestr(f"{info}/{f}", w.read(f"{info}/{f}"))
                lic = next((n for n in names if n.startswith(info) and "LICENSE" in n.upper()), None)
                if lic:
                    out.writestr(f"licenses/{p}-LICENSE.txt", w.read(lic))

    # ---------------------------------------------------------------- test it before using it
    say("Testing the app with the new bundle...")
    env = dict(os.environ, PYTHONPATH=os.pathsep.join([ROOT, NEW]))
    smoke = subprocess.run([sys.executable, "-S", "-c",
                            "import flask, werkzeug; from backend import create_app"],
                           env=env, capture_output=True, text=True, cwd=ROOT)
    failed = [] if smoke.returncode == 0 else ["start-up check"]
    if not failed:                                         # the app's main paths, on a throwaway database
        r = subprocess.run([sys.executable, "-S", "-c", CHECK], env=env, capture_output=True, text=True, cwd=ROOT)
        say(f"  {'app check (login, entries, reports, Excel)':<44}{'ok' if r.returncode == 0 else 'FAILED'}")
        if r.returncode != 0:
            failed.append("app check")
            say("\n".join(r.stderr.strip().splitlines()[-6:]))
    tests_dir = os.path.join(ROOT, "tests")
    if not failed and os.path.isdir(tests_dir):            # a developer copy also has the full test suite
        for t in sorted(os.listdir(tests_dir)):
            if t.startswith("test_") and t.endswith(".py"):
                r = subprocess.run([sys.executable, "-S", os.path.join("tests", t)], env=env, capture_output=True, text=True, cwd=ROOT)
                say(f"  {t:<28}{'ok' if r.returncode == 0 else 'FAILED'}")
                if r.returncode != 0:
                    failed.append(t)
                    say("\n".join(r.stderr.strip().splitlines()[-6:]))
    else:
        say(smoke.stderr.strip()[-800:])
    if failed:
        os.remove(NEW)
        sys.exit(f"Tests failed ({', '.join(failed)}). The new packages were NOT used; nothing was changed.")

    # ---------------------------------------------------------------- swap in (keep the old one for --undo)
    shutil.copy2(BUNDLE, PREVIOUS)
    os.replace(NEW, BUNDLE)
    write_pins(bundle_versions(BUNDLE))
    say("")
    show("Updated. The app now uses:", bundle_versions(BUNDLE))
    say("Restart the app to use them. If anything looks wrong: ./update.sh --undo")
finally:
    shutil.rmtree(work, ignore_errors=True)
    if os.path.exists(NEW):
        os.remove(NEW)
PY
)
exec python3 -c "$SCRIPT" "$@"
