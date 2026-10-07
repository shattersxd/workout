#!/usr/bin/env python3
"""
Build the single-file PWA from src/.

    index.html       =  src/shell/head.html  +  src/workout_tracker.jsx  +  src/shell/tail.html
    beta/index.html  =  то же + src/beta/*.jsx, с отдельными ключами хранилища
    beta/sw.js       =  sw.js с кэшем "sila-beta-*" и путями к ../vendor/

src/workout_tracker.jsx is authored as a normal ES module so editors and
linters understand it. The browser runs it through Babel standalone inside a
<script type="text/plain" id="app-src"> block, where there is no module
system, so the build rewrites the module boundary:

    import { ... } from "react";   ->   const { ... } = React;
    export default function App()  ->   function App()

Тестовая версия (beta) - тот же код плюс файлы из src/beta/, вставленные перед App.
Боевая сборка их не содержит. Отличия beta, больше ничего не трансформируется:

    const APP_VARIANT = "prod";        ->  "beta"  (ключи localStorage свои, см. STORAGE_KEY)
    <title> / имя на экране "Домой"    ->  Workout BETA
    loadScript('vendor/...')           ->  loadScript('../vendor/...')  (библиотеки общие)

Usage:
    python3 scripts/build.py                 # пишет index.html, beta/index.html, beta/sw.js
    python3 scripts/build.py --out other.html   # только боевая сборка в другой файл
    python3 scripts/build.py --check         # проверить, что все три файла свежие
"""

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "workout_tracker.jsx"
HEAD = ROOT / "src" / "shell" / "head.html"
TAIL = ROOT / "src" / "shell" / "tail.html"
BETA_DIR = ROOT / "src" / "beta"
SW = ROOT / "sw.js"
DEFAULT_OUT = ROOT / "index.html"
BETA_OUT = ROOT / "beta" / "index.html"
BETA_SW_OUT = ROOT / "beta" / "sw.js"

IMPORT_RE = re.compile(
    r'^import[ \t]*\{([^}]*)\}[ \t]*from[ \t]*["\']react["\'];?[ \t]*$', re.MULTILINE
)
EXPORT_RE = re.compile(r'^export\s+default\s+function\s+App\s*\(', re.MULTILINE)

LIBS = ("react.production.min.js", "react-dom.production.min.js", "babel.min.js")


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


def replace_once(text: str, old: str, new: str, what: str) -> str:
    """Замена, которая обязана сработать ровно один раз: тихий промах = боевые данные под бета-ключом."""
    if text.count(old) != 1:
        sys.exit("build: expected exactly one %s in the source, found %d" % (what, text.count(old)))
    return text.replace(old, new)


def beta_modules() -> str:
    files = sorted(BETA_DIR.glob("*.jsx"))
    if not files:
        sys.exit("build: src/beta/ has no .jsx files")
    parts = []
    for f in files:
        parts.append("// ---- src/beta/%s ----\n%s\n" % (f.name, f.read_text(encoding="utf-8")))
    return "\n".join(parts)


def build(beta: bool = False) -> str:
    for p in (SRC, HEAD, TAIL):
        if not p.exists():
            sys.exit("build: missing %s" % p.relative_to(ROOT))

    body = transform(SRC.read_text(encoding="utf-8"))
    head = HEAD.read_text(encoding="utf-8")
    tail = TAIL.read_text(encoding="utf-8")

    if 'id="app-src"' not in head:
        sys.exit('build: head.html must end with the <script ... id="app-src"> tag')

    if beta:
        body = replace_once(body, 'const APP_VARIANT = "prod";', 'const APP_VARIANT = "beta";', "APP_VARIANT")
        body = replace_once(body, "function App(", beta_modules() + "\nfunction App(", "function App(")
        head = replace_once(head, "<title>Workout Routine</title>", "<title>Workout BETA</title>", "<title>")
        head = replace_once(
            head,
            'name="apple-mobile-web-app-title" content="Workout Routine"',
            'name="apple-mobile-web-app-title" content="Workout BETA"',
            "apple-mobile-web-app-title",
        )
        head = replace_once(head, "%22name%22%3A%22Workout%20Routine%22", "%22name%22%3A%22Workout%20BETA%22", "manifest name")
        head = replace_once(head, "%22short_name%22%3A%22Workout%22", "%22short_name%22%3A%22Workout%20BETA%22", "manifest short_name")
        for lib in LIBS:
            head = replace_once(head, "loadScript('vendor/%s'" % lib, "loadScript('../vendor/%s'" % lib, lib)

    return head + body + tail


def build_beta_sw() -> str:
    """sw.js для /beta/: свой кэш и префикс, библиотеки берёт из общей ../vendor/."""
    sw = SW.read_text(encoding="utf-8")
    sw = replace_once(sw, 'const CACHE = "sila-v6";', 'const CACHE = "sila-beta-v1";', "CACHE")
    sw = replace_once(sw, 'const CACHE_PREFIX = "sila-v";', 'const CACHE_PREFIX = "sila-beta-";', "CACHE_PREFIX")
    for lib in LIBS:
        sw = replace_once(sw, '"vendor/%s"' % lib, '"../vendor/%s"' % lib, "precache " + lib)
    return sw


def label(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return path.name


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="output path of the production page")
    ap.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero if any output file differs from a fresh build",
    )
    args = ap.parse_args()

    prod_out = Path(args.out)
    files = [(prod_out, build(beta=False))]
    if prod_out.resolve() == DEFAULT_OUT.resolve():   # --out собирает только боевую страницу
        files += [(BETA_OUT, build(beta=True)), (BETA_SW_OUT, build_beta_sw())]

    if args.check:
        for out, text in files:
            if not out.exists():
                sys.exit("build --check: %s does not exist" % label(out))
            if out.read_text(encoding="utf-8") != text:
                sys.exit("build --check: %s is stale, run python3 scripts/build.py" % label(out))
            print("%s is up to date (%d KB)" % (label(out), len(text.encode()) // 1024))
        return

    for out, text in files:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8", newline="\n")
        print("built %s  %d KB" % (label(out), len(text.encode()) // 1024))
    print("app source: %d lines" % (SRC.read_text(encoding="utf-8").count("\n") + 1))


if __name__ == "__main__":
    main()
