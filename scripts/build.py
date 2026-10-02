#!/usr/bin/env python3
"""
Build the single-file PWA from src/.

    index.html  =  src/shell/head.html  +  src/workout_tracker.jsx  +  src/shell/tail.html

src/workout_tracker.jsx is authored as a normal ES module so editors and
linters understand it. The browser runs it through Babel standalone inside a
<script type="text/plain" id="app-src"> block, where there is no module
system, so the build rewrites the module boundary:

    import { ... } from "react";   ->   const { ... } = React;
    export default function App()  ->   function App()

Nothing else is transformed. Everything the app needs at runtime lives in
the two shell files.

Usage:
    python3 scripts/build.py                 # writes index.html
    python3 scripts/build.py --out other.html
    python3 scripts/build.py --check         # verify index.html is up to date
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "workout_tracker.jsx"
HEAD = ROOT / "src" / "shell" / "head.html"
TAIL = ROOT / "src" / "shell" / "tail.html"
DEFAULT_OUT = ROOT / "index.html"

IMPORT_RE = re.compile(
    r'^import[ \t]*\{([^}]*)\}[ \t]*from[ \t]*["\']react["\'];?[ \t]*$', re.MULTILINE
)
EXPORT_RE = re.compile(r'^export\s+default\s+function\s+App\s*\(', re.MULTILINE)


def transform(jsx: str) -> str:
    """Strip the ES module boundary so the code runs under bare Babel."""
    jsx, n_import = IMPORT_RE.subn(
        lambda m: "const {%s} = React;\n" % m.group(1), jsx, count=1
    )
    if n_import != 1:
        sys.exit('build: expected exactly one `import { ... } from "react"` in src')

    jsx, n_export = EXPORT_RE.subn("function App(", jsx, count=1)
    if n_export != 1:
        sys.exit("build: expected exactly one `export default function App(` in src")

    if "import " in jsx or re.search(r"^export\s", jsx, re.MULTILINE):
        sys.exit("build: leftover import/export in src -- the runtime has no module system")

    return jsx


def build() -> str:
    for p in (SRC, HEAD, TAIL):
        if not p.exists():
            sys.exit("build: missing %s" % p.relative_to(ROOT))

    body = transform(SRC.read_text(encoding="utf-8"))
    head = HEAD.read_text(encoding="utf-8")
    tail = TAIL.read_text(encoding="utf-8")

    if 'id="app-src"' not in head:
        sys.exit('build: head.html must end with the <script ... id="app-src"> tag')

    return head + body + tail


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="output path")
    ap.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero if the output file differs from a fresh build",
    )
    args = ap.parse_args()

    out = Path(args.out)
    html = build()

    if args.check:
        if not out.exists():
            sys.exit("build --check: %s does not exist" % out)
        if out.read_text(encoding="utf-8") != html:
            sys.exit("build --check: %s is stale, run python3 scripts/build.py" % out.name)
        print("%s is up to date (%d KB)" % (out.name, len(html.encode()) // 1024))
        return

    out.write_text(html, encoding="utf-8")
    print(
        "built %s  %d KB  (%d lines of app source)"
        % (out.name, len(html.encode()) // 1024, SRC.read_text(encoding="utf-8").count("\n") + 1)
    )


if __name__ == "__main__":
    main()
