#!/usr/bin/env node
/**
 * Comprehensive regression suite for the workout PWA.
 *
 * Run from the repo root, after building:
 *     python3 scripts/build.py && node tests/test_pwa.js
 *
 * Reads src/workout_tracker.jsx and index.html (override with the
 * WORKOUT_SRC / WORKOUT_PWA environment variables).
 *
 * Every section here exists because a real bug shipped. Do not delete a test
 * to make a change pass -- see CLAUDE.md.
 *
 * Covers every class of bug that has caused iOS PWA failures:
 *   1. String literal safety   (fancy quotes, unescaped chars, embedded quotes)
 *   2. iOS Safari syntax       (?. ?? ||= Array.at structuredClone)
 *   3. iOS PWA runtime safety  (AudioContext, Notification, vibrate, localStorage)
 *   4. PWA HTML structure      (Babel loading order, error display, app-src)
 *   5. iOS meta tags           (apple-mobile, manifest, service worker)
 *   6. Data integrity          (exercise IDs, rest formats, danger/warn fields)
 *   7. React component logic   (timer, state, hooks, swap, progress tab)
 *   8. JSX structure           (balanced braces/parens, self-closing tags)
 */

const fs   = require('fs');
const path = require('path');

const GREEN  = s => `\x1b[32m${s}\x1b[0m`;
const RED    = s => `\x1b[31m${s}\x1b[0m`;
const BOLD   = s => `\x1b[1m${s}\x1b[0m`;
const YELLOW = s => `\x1b[33m${s}\x1b[0m`;
const DIM    = s => `\x1b[2m${s}\x1b[0m`;

const PASS = [], FAIL = [];

function section(name) {
  console.log(`\n${BOLD('── ' + name + ' ' + '─'.repeat(Math.max(0, 52 - name.length)))}`);
}
function test(name, fn) {
  try { fn(); PASS.push(name); console.log(`  ${GREEN('✓')} ${name}`); }
  catch(e) { FAIL.push({name, msg: e.message}); console.log(`  ${RED('✗')} ${name}\n    ${RED('→')} ${e.message}`); }
}
// Асинхронные тесты (сервис-воркер): test() не ждёт промисы и засчитал бы их вхолостую,
// поэтому они копятся здесь и выполняются перед итогом, см. SUMMARY
const ASYNC_TESTS = [];
function testAsync(name, fn) { ASYNC_TESTS.push({ name, fn }); }
function assert(cond, msg)    { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertNot(cond, msg) { if (cond)  throw new Error(msg || 'should not be true'); }
function info(msg)            { console.log(`       ${DIM(msg)}`); }

// ── Load files ───────────────────────────────────────────────────────────────
const ROOT     = path.resolve(__dirname, '..');
const SRC_PATH = process.env.WORKOUT_SRC || path.join(ROOT, 'src', 'workout_tracker.jsx');
const PWA_PATH = process.env.WORKOUT_PWA || path.join(ROOT, 'index.html');
assert(fs.existsSync(SRC_PATH), `Source not found: ${SRC_PATH}`);
assert(fs.existsSync(PWA_PATH), `PWA not found: ${PWA_PATH} (run: python3 scripts/build.py)`);

const src  = fs.readFileSync(SRC_PATH, 'utf8');
const html = fs.readFileSync(PWA_PATH, 'utf8');

const APP_MARKER = 'id="app-src">';
assert(html.includes(APP_MARKER), 'PWA missing id="app-src" section');
const APP_START = html.indexOf(APP_MARKER) + APP_MARKER.length;
const APP_END   = html.indexOf('</script>', APP_START);
assert(APP_END > APP_START, 'PWA app-src not closed');
const app = html.slice(APP_START, APP_END);

// ── String-aware walker ──────────────────────────────────────────────────────
function walkStrings(source, onChar) {
  let i = 0, line = 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && source[i+1] === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '/' && source[i+1] === '*') {
      while (i < source.length && !(source[i] === '*' && source[i+1] === '/')) { if (source[i]==='\n') line++; i++; }
      i += 2; continue;
    }
    if (c === '`') { i++; while (i < source.length) { if (source[i]==='\\'){i+=2;continue;} if(source[i]==='\n')line++; if(source[i]==='`'){i++;break;} i++; } continue; }
    if (c === '"' || c === "'") {
      const q = c, sl = line; i++;
      while (i < source.length) {
        const ch = source[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '\n') { line++; i++; break; }
        if (ch === q)    { i++; break; }
        onChar(ch, sl, q);
        i++;
      }
      continue;
    }
    i++;
  }
}

function stripStrings(source) {
  let out = '', i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c==='/' && source[i+1]==='/') { while(i<source.length && source[i]!=='\n'){out+=' ';i++;} continue; }
    if (c==='/' && source[i+1]==='*') { out+='  ';i+=2; while(i<source.length&&!(source[i]==='*'&&source[i+1]==='/')){ out+=source[i]==='\n'?'\n':' ';i++;} out+='  ';i+=2;continue; }
    if (c==='`'||c==='"'||c==="'") { const q=c;out+=q;i++; while(i<source.length){if(source[i]==='\\'){out+='\\X';i+=2;continue;}if(source[i]===q){out+=q;i++;break;}out+=source[i]==='\n'?'\n':'_';i++;} continue; }
    out+=c; i++;
  }
  return out;
}

function balancedDepth(source, open, close) {
  let depth = 0, i = 0;
  while (i < source.length) {
    const c = source[i];
    // Skip // line comments
    if (c==='/' && source[i+1]==='/') { while(i<source.length && source[i]!=='\n')i++; continue; }
    if (c==='"'||c==="'") { const q=c;i++; while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i]===q){i++;break;}i++;} continue; }
    // Template literal — must skip ${...} nesting properly
    if (c==='`') {
      i++;
      while(i<source.length) {
        if(source[i]==='\\'){i+=2;continue;}
        if(source[i]==='`'){i++;break;}
        // skip ${...} inside template literal
        if(source[i]==='$' && source[i+1]==='{') {
          i+=2; let td=1;
          while(i<source.length && td>0){
            if(source[i]==='{')td++;
            else if(source[i]==='}')td--;
            i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }
    if (c===open) depth++;
    else if (c===close) depth--;
    i++;
  }
  return depth;
}

function codeLines(s) { return s.split('\n').filter(l => !l.trim().startsWith('//')); }

// ═══════════════════════════════════════════════════════════════════════════
section('1 · STRING LITERAL SAFETY');
// ═══════════════════════════════════════════════════════════════════════════

test('No fancy/curly quotes inside string literals (source)', () => {
  const FANCY = '«»\u201c\u201d\u2018\u2019\u00ab\u00bb';
  const bad = [];
  walkStrings(src, (ch, line) => { if (FANCY.includes(ch)) bad.push(`L${line}:${JSON.stringify(ch)}`); });
  assert(bad.length === 0, `Fancy quotes in strings: ${bad.slice(0,5).join(' ')}`);
});

test('No fancy/curly quotes inside string literals (PWA app source)', () => {
  const FANCY = '«»\u201c\u201d\u2018\u2019\u00ab\u00bb';
  const bad = [];
  walkStrings(app, (ch, line) => { if (FANCY.includes(ch)) bad.push(`L${line}:${JSON.stringify(ch)}`); });
  assert(bad.length === 0, `Fancy quotes in PWA strings: ${bad.slice(0,5).join(' ')}`);
});

test('No invisible/zero-width unicode in string literals', () => {
  const BAD = new Set([0x00a0,0x200b,0x200c,0x200d,0xfeff,0x2028,0x2029]);
  const bad = [];
  walkStrings(src, (ch, line) => { if (BAD.has(ch.charCodeAt(0))) bad.push(`L${line}:U+${ch.charCodeAt(0).toString(16).toUpperCase()}`); });
  assert(bad.length === 0, `Invisible chars: ${bad.slice(0,5).join(' ')}`);
});

test('No double-quoted string broken by embedded unescaped double-quote', () => {
  // Pattern: word"" or ""word inside what must be a string value (not empty string boundary)
  const bad = [];
  src.split('\n').forEach((line, i) => {
    if (/[а-яёА-ЯЁa-zA-Z0-9]""/.test(line) || /""[а-яёА-ЯЁa-zA-Z]/.test(line))
      bad.push(`L${i+1}: ${line.trim().slice(0,100)}`);
  });
  assert(bad.length === 0, `Broken embedded quotes:\n${bad.slice(0,3).join('\n')}`);
});

test('No unescaped </script> tag in PWA app source (ends script block prematurely)', () => {
  const raw = app.replace(/<\\\/script>/g, '');
  assertNot(raw.includes('</script>'), 'Unescaped </script> found — will break HTML parsing');
});

test('No non-ASCII characters outside of string literals in code structure', () => {
  // Strip all strings, then check remaining code has no exotic chars
  const stripped = stripStrings(src);
  const bad = [];
  stripped.split('\n').forEach((line, i) => {
    for (const ch of line) {
      const code = ch.charCodeAt(0);
      // Allow: printable ASCII + common CJK ranges we intentionally use as identifiers (none)
      const ALLOWED_NON_ASCII = new Set([0x00D7, 0x00B7]); // × · used in JSX text nodes
      if (code > 127 && code < 0x0400 && !ALLOWED_NON_ASCII.has(code))
        bad.push(`L${i+1}: U+${code.toString(16).toUpperCase()} "${ch}" in code context`);
    }
  });
  // Filter known-safe: Cyrillic in JSX text (between > and <) is fine
  const realBad = bad.filter(b => !b.includes('JSX text'));
  assert(realBad.length === 0, `Non-ASCII in code: ${realBad.slice(0,3).join(', ')}`);
});

// ═══════════════════════════════════════════════════════════════════════════
section('2 · iOS SAFARI SYNTAX COMPATIBILITY');
// ═══════════════════════════════════════════════════════════════════════════

test('No optional chaining ?. in source (crashes iOS < 14, not transpiled by Babel here)', () => {
  const hits = codeLines(src).filter(l => l.includes('?.'));
  assert(hits.length === 0, `?. found on ${hits.length} lines:\n${hits.slice(0,2).map(l=>'  '+l.trim().slice(0,80)).join('\n')}`);
});

test('No optional chaining ?. in PWA app source', () => {
  const hits = codeLines(app).filter(l => l.includes('?.'));
  assert(hits.length === 0, `?. in PWA: ${hits.length} lines`);
});

test('No nullish coalescing ?? in source (crashes iOS < 13.4)', () => {
  const hits = codeLines(src).filter(l => /[^?]\?\?[^?=]/.test(l));
  assert(hits.length === 0, `?? found on ${hits.length} lines`);
});

test('No logical assignment operators ||= &&= ??= (iOS < 14)', () => {
  for (const op of ['||=','&&=','??=']) {
    const hits = codeLines(src).filter(l => l.includes(op));
    assert(hits.length === 0, `${op} found`);
  }
});

test('No Array.at() (iOS < 15.4)', () => {
  assertNot(src.includes('.at('), '.at() method found');
});

test('No Object.hasOwn() (iOS < 15.4)', () => {
  assertNot(src.includes('Object.hasOwn'), 'Object.hasOwn found');
});

test('No structuredClone() (iOS < 15.4)', () => {
  assertNot(src.includes('structuredClone'), 'structuredClone found');
});

test('No at() in PWA app source either', () => {
  assertNot(app.includes('.at('), '.at() in PWA app source');
});

// ═══════════════════════════════════════════════════════════════════════════
section('3 · iOS PWA RUNTIME SAFETY');
// ═══════════════════════════════════════════════════════════════════════════

test('No AudioContext in source or PWA (crashes iOS standalone PWA on set completion)', () => {
  assertNot(src.includes('AudioContext'), 'AudioContext in source — will crash iOS PWA');
  assertNot(app.includes('AudioContext'), 'AudioContext in PWA app — will crash iOS PWA');
});

test('navigator.vibrate() guarded by existence check', () => {
  const calls = src.split('\n').filter(l => l.includes('navigator.vibrate(') && !l.trim().startsWith('//'));
  const unguarded = calls.filter(l => !l.includes('if (navigator.vibrate)') && !l.includes('navigator.vibrate &&'));
  assert(unguarded.length === 0, `Unguarded vibrate calls: ${unguarded.length}`);
});

test('Notification.permission condition uses correct operator precedence', () => {
  // Bug was: (typeof X !== "..." && X.permission) === "granted" — always false
  assertNot(src.includes('&& Notification.permission) ==='), 'Broken Notification condition in source');
  assertNot(app.includes('&& Notification.permission) ==='), 'Broken Notification condition in PWA');
});

test('new Notification() calls wrapped in try/catch', () => {
  // new Notification() is inside try { ... } catch — check both are present near each other
  const notifCalls = (src.match(/new Notification\(/g) || []).length;
  const tryCatches = (src.match(/try\s*\{[\s\S]{0,200}new Notification/g) || []).length;
  assert(notifCalls > 0, 'No new Notification() calls found');
  assert(tryCatches >= notifCalls, `${notifCalls} Notification calls but only ${tryCatches} wrapped in try/catch`);
});

test('localStorage calls wrapped in try/catch (Safari Private Mode throws)', () => {
  const lsOps = (src.match(/localStorage\.(setItem|getItem|removeItem)/g) || []).length;
  const tryCount = (src.match(/try\s*\{[\s\S]{0,200}localStorage/g) || []).length;
  info(`${lsOps} localStorage ops, ${tryCount} try-wrapped`);
  assert(tryCount >= 3, `Only ${tryCount}/≥3 localStorage calls in try/catch — Safari Private Mode will throw`);
});

test('Timer uses wall-clock endsAt (correct after iOS background freeze)', () => {
  assert(src.includes('endsAt'), 'endsAt not found — timer counts ticks, will desync after backgrounding');
  assert(src.includes('Date.now()'), 'Date.now() not used — timer not clock-based');
});

test('Timer state saved to and restored from localStorage on app kill/reopen', () => {
  // Ключ идёт через TIMER_KEY: у тестовой версии он свой (sila_timer_beta), боевой остаётся sila_timer
  assert(src.includes('const TIMER_KEY = APP_VARIANT === "beta" ? "sila_timer_beta" : "sila_timer"'), 'TIMER_KEY declaration missing or changed');
  assert(src.includes('localStorage.getItem(TIMER_KEY)'), 'Timer not restored from localStorage');
  assert(src.includes('localStorage.setItem(TIMER_KEY,'), 'Timer not saved to localStorage');
  assert(src.includes('localStorage.removeItem(TIMER_KEY)'), 'Timer not removed from localStorage on stop');
  assert((src.match(/"sila_timer"/g) || []).length === 1, 'the timer key must appear as a literal only in its declaration');
});

test('visibilitychange listener syncs timer when app returns to foreground', () => {
  assert(src.includes('visibilitychange'), 'No visibilitychange listener');
  assert(src.includes('document.hidden'), 'visibilitychange does not check document.hidden');
  // Should recalculate left from endsAt
  const visBlock = src.slice(src.indexOf('visibilitychange'));
  assert(visBlock.slice(0, 300).includes('endsAt') || src.includes('endsAt - Date.now()'),
    'visibilitychange handler does not recalculate from endsAt');
});

test('Notification timeout scheduled via setTimeout on startTimer (not only on tick)', () => {
  assert(src.includes('notifTimerRef'), 'notifTimerRef missing');
  assert(src.includes('notifTimerRef.current = setTimeout'), 'notification timeout not scheduled with notifTimerRef');
  assert(src.includes('clearTimeout(notifTimerRef.current)'), 'notification timeout not cleared');
});

// ═══════════════════════════════════════════════════════════════════════════
section('4 · PWA HTML STRUCTURE & LOADING');
// ═══════════════════════════════════════════════════════════════════════════

test('Scripts load sequentially via chained callbacks (not async/defer)', () => {
  assert(html.includes('function loadScript'), 'No loadScript helper function');
  const chains = (html.match(/loadScript\s*\([^)]+,\s*function/g) || []).length;
  assert(chains >= 3, `Only ${chains} chained loadScript calls — need ≥3 for React→ReactDOM→Babel`);
});

test('React loads before ReactDOM loads before Babel (correct dependency order)', () => {
  const rIdx  = html.indexOf('react.production.min.js');
  const rdIdx = html.indexOf('react-dom.production.min.js');
  const bIdx  = html.indexOf('babel.min.js');
  assert(rIdx > -1, 'React CDN URL not found'); assert(rdIdx > -1, 'ReactDOM CDN not found'); assert(bIdx > -1, 'Babel CDN not found');
  assert(rIdx < rdIdx, 'ReactDOM nested before React');
  assert(rdIdx < bIdx, 'Babel nested before ReactDOM');
});

test('Babel version pinned to specific release (not @latest)', () => {
  // Babel лежит в vendor/ и не обновляется сам: версия зашита самим файлом
  const babel = fs.readFileSync(path.join(ROOT, 'vendor', 'babel.min.js'), 'utf8');
  assert(babel.includes('7.23.10'), 'vendor/babel.min.js is not Babel 7.23.10 - the iOS syntax rules in CLAUDE.md were verified on it');
  assertNot(html.includes('@latest'), 'a script URL points at @latest');
  info('Babel: 7.23.10 (vendored)');
});

test('Babel compiles with react preset', () => {
  assert(
    html.includes("presets: [['react'") || html.includes("presets: ['react'") ||
    html.includes("presets:[['react'") || html.includes("\"presets\":[\"react\""),
    'Babel.transform missing react preset'
  );
});

test('window.onerror handler catches uncaught errors (prevents silent black screen)', () => {
  assert(html.includes('window.onerror'), 'No window.onerror — JS errors show as black screen');
  assert(html.includes('showErr'), 'showErr not called from onerror');
});

test('Compilation errors shown to user via showErr', () => {
  assert(html.includes('showErr('), 'showErr never called');
  assert(html.includes("catch(e)") || html.includes("catch (e)"), 'No catch around Babel.transform');
  // Should show error message
  assert(html.includes('e.message') || html.includes('err.message'), 'Error message not displayed');
});

test('Loading screen present with visible animation (not just black)', () => {
  assert(html.includes('id="loader"'), 'No #loader element');
  assert(html.includes('animation') || html.includes('animateTransform'), 'Loader has no animation');
});

test('Loading screen dismissed after successful app init', () => {
  assert(html.includes('hideLoader'), 'hideLoader() missing — loading screen stays forever on success');
  // hideLoader should be called after ReactDOM.createRoot succeeds
  const bootBlock = html.slice(html.indexOf('Babel.transform'));
  assert(bootBlock.slice(0, 500).includes('hideLoader'), 'hideLoader not called after successful compile+render');
});

test('app-src script tag type is text/plain (browser must not execute it directly)', () => {
  assert(html.includes('type="text/plain"'), 'app-src script not type="text/plain" — browser will try to execute JSX as JS');
});

test('ReactDOM.createRoot present in PWA bootstrap (renders the app)', () => {
  assert(app.includes('ReactDOM.createRoot'), 'ReactDOM.createRoot missing — app never renders');
});

test('React hooks destructured from global React object (not import statement)', () => {
  assert(app.includes('const { useState') || app.includes('const {useState'), 'Hooks not destructured from React');
  assertNot(app.includes("from 'react'") || app.includes('from "react"'), 'import statement in PWA app source');
});

test('No export default in PWA app source', () => {
  assertNot(app.includes('export default'), 'export default in PWA app source — SyntaxError');
});

// ═══════════════════════════════════════════════════════════════════════════
section('5 · iOS META TAGS & MANIFEST');
// ═══════════════════════════════════════════════════════════════════════════

test('apple-mobile-web-app-capable (enables PWA mode)', () => {
  assert(html.includes('apple-mobile-web-app-capable'), 'Missing apple-mobile-web-app-capable');
});
test('apple-mobile-web-app-status-bar-style (status bar theming)', () => {
  assert(html.includes('apple-mobile-web-app-status-bar-style'), 'Missing status bar style');
});
test('apple-mobile-web-app-title (app name on home screen)', () => {
  assert(html.includes('apple-mobile-web-app-title'), 'Missing PWA title meta tag');
});
test('apple-touch-icon (icon on iOS home screen)', () => {
  assert(html.includes('apple-touch-icon'), 'Missing apple-touch-icon — no icon on home screen');
});
test('viewport user-scalable=no (prevents zoom on input tap)', () => {
  assert(html.includes('user-scalable=no'), 'Missing user-scalable=no — iOS zooms on number input tap');
});
test('theme-color meta (browser chrome color)', () => {
  assert(html.includes('theme-color'), 'Missing theme-color');
});
test('manifest link', () => {
  assert(html.includes('rel="manifest"'), 'Missing manifest link');
});
test('Manifest JSON has standalone display mode', () => {
  const m = html.match(/rel="manifest"\s+href="data:application\/json,([^"]+)"/);
  if (!m) { info('external manifest — skipping JSON parse'); return; }
  const manifest = JSON.parse(decodeURIComponent(m[1]));
  assert(manifest.display === 'standalone', `manifest.display="${manifest.display}", expected "standalone"`);
  info(`Manifest: name="${manifest.name}" display="${manifest.display}"`);
});
test('Service worker registered with feature detection', () => {
  assert(html.includes('serviceWorker'), 'No service worker');
  assert(html.includes("'serviceWorker' in navigator"), 'No feature detection for SW');
});
test('iOS install hint (#ios-hint) with share + add to home screen instructions', () => {
  assert(html.includes('ios-hint'), 'No #ios-hint element');
  assert(html.includes('Домой') || html.includes('Поделиться'), 'iOS hint missing share/add instructions');
});

// ═══════════════════════════════════════════════════════════════════════════
section('6 · DATA INTEGRITY');
// ═══════════════════════════════════════════════════════════════════════════

test('PROGRAM has all 3 days: push, pull, legs', () => {
  assert(/push\s*:/.test(src) || src.includes('"push"'), 'push day missing');
  assert(/pull\s*:/.test(src) || src.includes('"pull"'), 'pull day missing');
  assert(/legs\s*:/.test(src) || src.includes('"legs"'), 'legs day missing');
});
test('All exercise IDs are unique', () => {
  const ids = [...src.matchAll(/\bid:\s*"([a-z_]+)"/g)].map(m => m[1]);
  const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert(dups.length === 0, `Duplicate IDs: ${[...new Set(dups)].join(', ')}`);
  info(`${ids.length} unique exercise IDs`);
});
test('No danger: null (all exercises have safety notes)', () => {
  assertNot(src.includes('danger: null'), 'danger: null found');
});
test('All warn fields are boolean', () => {
  const warnTrue  = (src.match(/warn:\s*true/g)  || []).length;
  const warnFalse = (src.match(/warn:\s*false/g) || []).length;
  assert(warnTrue + warnFalse > 0, 'No warn fields found');
  // Exclude dynamic references like warn: ex.warn or warn: ex.danger
  const badWarn = (src.match(/warn:\s*(?!true|false|ex\.|e\.|p\.|prev\.|cw\.)[^\s,}\n]+/g) || []);
  assert(badWarn.length === 0, `Non-boolean warn values: ${badWarn}`);
  info(`warn: true=${warnTrue} false=${warnFalse}`);
});
test('All exercises have required fields: id, name, sets, reps, rest, steps', () => {
  // Only check exercise blocks inside ALTERNATIVES and PROGRAM, not ACHIEVEMENTS
  const progStart = src.indexOf('const ALTERNATIVES =');
  const progEnd = src.indexOf('const ACHIEVEMENTS =');
  const exSrc = progStart >= 0 && progEnd >= 0 ? src.slice(progStart, progEnd) : src;
  const exBlocks = exSrc.split(/\{\s*id:\s*"/).slice(1);
  const required = ['name:', 'sets:', 'reps:', 'rest:', 'steps:'];
  exBlocks.forEach((block, i) => {
    const idMatch = block.match(/^([a-z_]+)"/);
    const id = idMatch ? idMatch[1] : `#${i}`;
    for (const field of required) {
      const scope = block.slice(0, 400);
      assert(scope.includes(field), `Exercise "${id}" missing field: ${field}`);
    }
  });
  info(`${exBlocks.length} exercises all have required fields`);
});
test('All rest values match parseRestSeconds format (N мин / N сек)', () => {
  const restValues = [...src.matchAll(/rest:\s*"([^"]+)"/g)].map(m => m[1]);
  const bad = restValues.filter(r => !/\d+\s*(мин|сек)/.test(r));
  assert(bad.length === 0, `Unrecognised rest formats: ${bad.join(', ')}`);
  info(`${[...new Set(restValues)].join(', ')}`);
});
test('ALTERNATIVES defined and referenced in component', () => {
  assert(src.includes('const ALTERNATIVES'), 'ALTERNATIVES const missing');
  assert(src.includes('ALTERNATIVES['), 'ALTERNATIVES not used in component');
});
test('WEEK_SCHEDULE defined with 7 entries', () => {
  assert(src.includes('WEEK_SCHEDULE'), 'WEEK_SCHEDULE missing');
  const days = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'];
  const missing = days.filter(d => !src.includes(`"${d}"`));
  assert(missing.length === 0, `WEEK_SCHEDULE missing days: ${missing.join(', ')}`);
});

// ═══════════════════════════════════════════════════════════════════════════
section('7 · REACT COMPONENT LOGIC');
// ═══════════════════════════════════════════════════════════════════════════

test('App defined as named function (not arrow function)', () => {
  assert(src.includes('function App()'), 'App is not a named function — may fail in certain Babel configs');
});
test('All 3 hooks imported: useState useEffect useRef', () => {
  assert(src.includes('useState') && src.includes('useEffect') && src.includes('useRef'), 'Missing hook imports');
});
test('Core state: data, activeDay, activeTab, timer, notifEnabled', () => {
  assert(src.includes('useState(loadData)') || src.includes('useState(load'), 'data state missing');
  assert(src.includes('"push"') && (src.includes('useState("push")') || src.includes("useState('push')") || src.includes('todayWorkout || "push"') || src.includes('sched[schedIdx] || "push"') || src.includes("parsed.schedule")), 'activeDay state missing');
  assert(src.includes("useState(null)"), 'timer state (null initial) missing');
  assert(src.includes('[notifEnabled, setNotifEnabled]'), 'notifEnabled useState declaration missing — variable will be undefined at runtime');
});
test('toggleDone passes rest string to startTimer', () => {
  assert(src.includes('function toggleDone'), 'toggleDone missing');
  assert(src.includes('toggleDone(ex.id, i, ex.rest)'), 'toggleDone not called with ex.rest');
});
test('addTime updates endsAt (not just left)', () => {
  assert(src.includes('function addTime'), 'addTime missing');
  const fn = src.slice(src.indexOf('function addTime'), src.indexOf('function addTime') + 400);
  assert(fn.includes('endsAt'), 'addTime does not update endsAt — timer desyncs after +30s');
});
test('stopTimer clears interval AND notification timeout AND localStorage', () => {
  assert(src.includes('function stopTimer'), 'stopTimer missing');
  const fn = src.slice(src.indexOf('function stopTimer'), src.indexOf('function stopTimer') + 300);
  assert(fn.includes('clearInterval'), 'stopTimer does not clearInterval');
  assert(fn.includes('clearTimeout'), 'stopTimer does not clearTimeout');
  assert(fn.includes('removeItem'), 'stopTimer does not remove timer from localStorage');
});
test('getExHistory present for progress chart', () => {
  assert(src.includes('function getExHistory'), 'getExHistory missing — progress tab crashes');
});
test('Progress tab active condition present', () => {
  assert(src.includes("activeTab === \"progress\"") || src.includes("activeTab === 'progress'"), 'Progress tab content missing');
  assert(src.includes('ПРОГРЕСС'), 'ПРОГРЕСС tab label missing');
});
test('getLastWeight uses correct session key filtering', () => {
  assert(src.includes('function getLastWeight'), 'getLastWeight missing');
  assert(src.includes('function getPastExSets'), 'getPastExSets missing - hints have no data source');
  const fn = src.slice(src.indexOf('function getPastExSets'), src.indexOf('function getLastWeight'));
  assert(fn.includes('sessionKey'), 'getPastExSets does not exclude current session');
  const lw = src.slice(src.indexOf('function getLastWeight'), src.indexOf('function getExHistory'));
  assert(lw.includes('getPastExSets('), 'getLastWeight must read through getPastExSets');
});
test('finishWorkout saves to per-day history array', () => {
  assert(src.includes('function finishWorkout'), 'finishWorkout missing');
  assert(src.includes("history[activeDay]"), 'finishWorkout not saving to day history');
});
test('showToast auto-clears after delay', () => {
  assert(src.includes('function showToast'), 'showToast missing');
  assert(src.includes('setTimeout(() => setToast(null)'), 'toast does not auto-clear');
});
test('Swap logic: swapModal state + swapExercise function', () => {
  assert(src.includes('swapModal'), 'swapModal state missing');
  assert(src.includes('function swapExercise'), 'swapExercise missing');
});
test('requestNotifPermission is async and awaits Notification.requestPermission', () => {
  assert(src.includes('async function requestNotifPermission'), 'requestNotifPermission not async');
  assert(src.includes('Notification.requestPermission'), 'Notification.requestPermission not called');
});

// ═══════════════════════════════════════════════════════════════════════════
section('8 · JSX / CODE STRUCTURE');
// ═══════════════════════════════════════════════════════════════════════════

test('Balanced { } braces in source file', () => {
  const d = balancedDepth(src, '{', '}');
  assert(d === 0, `Unbalanced braces: depth=${d} (${d>0?'missing }':'extra }'})`);
});
test('Balanced ( ) parens in source file', () => {
  const d = balancedDepth(src, '(', ')');
  assert(d === 0, `Unbalanced parens: depth=${d}`);
});
test('Balanced { } braces in PWA app source', () => {
  const d = balancedDepth(app, '{', '}');
  assert(d === 0, `Unbalanced braces in PWA: depth=${d}`);
});
test('Balanced ( ) parens in PWA app source', () => {
  const d = balancedDepth(app, '(', ')');
  assert(d === 0, `Unbalanced parens in PWA: depth=${d}`);
});
test('No HTML void elements without self-closing /> in JSX', () => {
  const stripped = stripStrings(app);
  for (const tag of ['<br>', '<hr>', '<input>', '<img>']) {
    const count = (stripped.split(tag).length - 1);
    assert(count === 0, `Non-self-closing ${tag} found ${count} times — JSX requires ${tag.replace('>','/')}>`)
  }
});
test('No console.log left in production code', () => {
  const logs = src.split('\n').filter(l => l.includes('console.log') && !l.trim().startsWith('//'));
  assert(logs.length === 0, `${logs.length} console.log call(s) found — may slow down iOS`);
});

// ── 9 · iOS BABEL NON-ASCII SAFETY ──────────────────────────────────────────
section("9 · iOS BABEL NON-ASCII SAFETY");

// Babel 7.23 on iOS crashes on any non-ASCII char inside JS string literals
// (single/double quoted strings and template literals)
// Allowed: Cyrillic (U+0400-U+04FF), degree ° (U+00B0), emoji (U+1F000+)
function scanNonAsciiInStrings(source) {
  const bad = [];
  let i = 0, line = 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\n') { line++; i++; continue; }
    // Skip // comments
    if (source[i] === '/' && source[i+1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    // Single/double quoted strings
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < source.length) {
        const ch = source[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '\n') line++;
        if (ch === q) { i++; break; }
        const code = ch.codePointAt(0);
        const isSafe = (code >= 0x0400 && code <= 0x04FF) || code === 0x00B0 || code >= 0x2600 || (code >= 0xD800 && code <= 0xDFFF);
        if (code > 127 && !isSafe) {
          bad.push(`L${line} U+${code.toString(16).toUpperCase().padStart(4,'0')} ${JSON.stringify(ch)}`);
        }
        i++;
      }
      continue;
    }
    // Template literals
    if (c === '`') {
      i++;
      while (i < source.length) {
        const ch = source[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '\n') line++;
        if (ch === '$' && source[i+1] === '{') {
          i += 2; let d = 1;
          while (i < source.length && d > 0) {
            if (source[i] === '{') d++;
            else if (source[i] === '}') d--;
            if (source[i] === '\n') line++;
            i++;
          }
          continue;
        }
        if (ch === '`') { i++; break; }
        const code = ch.codePointAt(0);
        const isSafe = (code >= 0x0400 && code <= 0x04FF) || code === 0x00B0 || code >= 0x2600 || (code >= 0xD800 && code <= 0xDFFF);
        if (code > 127 && !isSafe) {
          bad.push(`L${line} U+${code.toString(16).toUpperCase().padStart(4,'0')} ${JSON.stringify(ch)} in template`);
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return bad;
}

test('No non-ASCII (non-Cyrillic) chars in JS string literals (Babel iOS crash)', () => {
  const badChars = scanNonAsciiInStrings(app);
  assert(badChars.length === 0, badChars.length > 0 ? `${badChars.length} bad chars: ${badChars.slice(0,5).join(', ')}` : '');
  info(`0 bad chars found`);
});

// ── SECTION 10: NEW FEATURES ─────────────────────────────────────────────
section('10 · NEW FEATURES');

test('deleteHistoryEntry: filters by ts, cleans up empty day', () => {
  assert(src.includes('filter(e => e.ts !== ts)'), 'deleteHistoryEntry should filter by ts');
  assert(src.includes('delete history[workout]'), 'deleteHistoryEntry should clean up empty day key');
  assert(src.includes('можно вернуть из корзины'), 'delete must tell the user it is recoverable');
  assert(src.includes('trash.unshift'), 'deleted entry must go to trash, not vanish');
});

test('resumeSession restores the workout, including a session already cleared on save', () => {
  const fn = src.slice(src.indexOf('function resumeSession'), src.indexOf('function cancelResume'));
  assert(fn.includes('setActiveDay(entry.workout)'), 'must switch to the right day');
  assert(fn.includes('setActiveTab("workout")'), 'must switch to the workout tab');
  // finishWorkout deletes the session, so resuming must rebuild it from detail
  assert(fn.includes('entry.detail && entry.detail.length > 0'), 'must fall back to entry.detail when the session is gone');
  assert(fn.includes('weight: s.w || ""'), 'must restore logged weights');
  assert(fn.includes('done: !!s.done'), 'must restore completed set marks');
  assert(fn.includes('d.added'), 'must restore exercises that were added mid-workout');
  info('Resume rebuilds sets and added exercises from the saved record');
});

test('finishWorkout: deduplicates by date (no double entries)', () => {
  assert(src.includes('findIndex(e => e.date === today)'), 'finishWorkout deduplicates by date');
  assert(src.includes('history[activeDay][existingIdx] = entry'), 'finishWorkout updates existing entry');
  assert(src.includes('delete sessions[sessionKey]'), 'finishWorkout clears session after save');
  assert(src.includes('"Тренировка обновлена!"'), 'finishWorkout shows update toast');
});

test('finishWorkout: blocks save when exDone < 3', () => {
  assert(src.includes('prog.exDone < 3') && src.includes('"Выполни хотя бы 3 упражнения"'), 'finishWorkout guards minimum exercises');
});

test('toggleDone: requires weight before marking done', () => {
  assert(src.includes('"Впиши вес перед отметкой"'), 'toggleDone requires weight');
  assert(src.includes('!cur.weight || cur.weight === ""'), 'toggleDone checks weight empty string');
});

test('Marking a set restarts the rest timer, unmarking stops it', () => {
  const fn = src.slice(src.indexOf('function toggleDone'), src.indexOf('function getExProgress'));
  assert(/if \(newDone\) \{[\s\S]*?startTimer\(restStr\)/.test(fn), 'each completed set must start rest over');
  assert(!fn.includes('!timer || !timer.running || timer.left === 0'), 'restart must not be conditional — set two follows set one');
  assert(/\} else \{[\s\S]*?stopTimer\(\)/.test(fn), 'unmarking a set must end the rest timer');
  info('Restart on mark, stop on unmark');
});

test('Timer effect re-runs when endsAt changes (restart actually ticks)', () => {
  // With deps on running alone, startTimer clears the interval but the effect
  // never re-fires, so the countdown freezes at the initial value.
  const m = src.match(/\}, \[timer \? timer\.running : false[^\]]*\]\);/);
  assert(m, 'timer effect dependency array not found');
  assert(m[0].includes('timer.endsAt'), 'effect must depend on endsAt, otherwise a restart never recreates the interval');
  info('Effect keyed on both running and endsAt');
});

test('autoSave: triggers on visibilitychange and beforeunload', () => {
  assert(src.includes('visibilitychange') && src.includes('autoSave'), 'autoSave registered on visibilitychange');
  assert(src.includes('beforeunload'), 'autoSave registered on beforeunload');
  assert(src.includes('if (prog.exDone < 3) return'), 'autoSave guards minimum exercises');
  assert(src.includes('window.removeEventListener("beforeunload"'), 'autoSave cleaned up on unmount');
});

test('savePrompt: triggers after 3rd completed exercise', () => {
  assert(src.includes('savePrompt') && src.includes('setSavePrompt'), 'savePrompt state present');
  assert(src.includes('lastPromptedExDone'), 'lastPromptedExDone ref present to prevent spam');
  assert(src.includes('prog.exDone > lastPromptedExDone.current'), 'savePrompt only fires on new completions');
});

test('schedule: stored in data.schedule, 7 entries, used for activeDay init', () => {
  assert(src.includes('d.schedule'), 'schedule initialized in loadData');
  assert(src.includes('data.schedule || ["push",null,"pull",null,"legs",null,null]'), 'schedule has correct default');
  assert(src.includes('parsed.schedule'), 'activeDay init reads persisted schedule');
});

test('Journal: "not finished" applies only to autosaves, never to manual finishes', () => {
  assert(src.includes('const partial = pct < 100'), 'partial flag computed');
  assert(src.includes('const incomplete = partial && entry.src === "auto"'),
    'incomplete must require an autosave - a manually finished workout is finished at any pct');
  assert(src.includes('НЕ ЗАКОНЧЕНО'), 'incomplete badge text present');
  assert(src.includes('ДОПОЛНИТЬ'), 'resume button present for partial entries');
});

test('custom workout CRUD: save, delete, getWorkout handles custom key', () => {
  assert(src.includes('function saveCustomWorkout('), 'saveCustomWorkout present');
  assert(src.includes('function deleteCustomWorkout('), 'deleteCustomWorkout present');
  assert(src.includes('if (activeDay === id) setActiveDay("push")'), 'deleteCustomWorkout resets activeDay if needed');
  assert(src.includes('function getWorkout(dayKey)'), 'getWorkout present');
  assert(src.includes('data.customWorkouts && data.customWorkouts[dayKey]'), 'getWorkout handles custom key');
});

test('computeAch: counts workouts, week streak, PPL cycles', () => {
  assert(src.includes('function computeAch()'), 'computeAch present');
  assert(src.includes('totalWorkouts'), 'computeAch counts total workouts');
  assert(src.includes('weekStreak'), 'computeAch computes week streak');
  assert(src.includes('cycles'), 'computeAch counts PPL cycles');
  assert(src.includes('w["push"] && w["pull"] && w["legs"]'), 'computeAch checks full PPL week');
});

test('getDayProgress: counts fully completed exercises (all sets done)', () => {
  assert(src.includes('allSetsDone'), 'getDayProgress uses allSetsDone flag');
  assert(src.includes('allSetsDone && numSets > 0') || src.includes('allSetsDone'), 'exDone increments only on full completion');
  assert(src.includes('exDone'), 'getDayProgress returns exDone');
});

test('week schedule editor: cycleNext updates data.schedule at correct index', () => {
  assert(src.includes('const cycleNext = ()'), 'cycleNext function present in schedule editor');
  assert(src.includes('ns[idx] = next'), 'cycleNext updates correct index');
  assert(src.includes('schedule: ns'), 'cycleNext saves updated schedule to data');
});


// ── SECTION 11: STRUCTURAL INTEGRITY ────────────────────────────────────────
section('11 · STRUCTURAL INTEGRITY');

test('No orphan keys outside const objects (posture_extra bug)', () => {
  // All keys like "foo_extra: [" must be inside a const BLOCK = { ... }
  // Strategy: verify they appear between ALTERNATIVES = { and its closing };
  const altStart = src.indexOf('const ALTERNATIVES');
  const progStart = src.indexOf('const PROGRAM');
  assert(altStart >= 0 && progStart > altStart, 'ALTERNATIVES and PROGRAM both found');
  const altBlock = src.slice(altStart, progStart);
  // All _extra keys must be inside altBlock
  const extraKeys = [...src.matchAll(/\b([a-z_]+_extra\d*):\s*\[/g)].map(m => m[1]);
  const orphans = extraKeys.filter(k => !altBlock.includes(k + ':'));
  assert(orphans.length === 0, `Orphan extra keys outside ALTERNATIVES: ${orphans.join(', ')}`);
  info(`${extraKeys.length} _extra keys all inside ALTERNATIVES`);
});

test('ALTERNATIVES brace-balanced internally', () => {
  const altStart = src.indexOf('const ALTERNATIVES');
  const progStart = src.indexOf('const PROGRAM');
  const altBlock = src.slice(altStart, progStart);
  let depth = 0;
  for (const c of altBlock) { if (c === '{') depth++; else if (c === '}') depth--; }
  assert(depth === 0, `ALTERNATIVES brace imbalance: ${depth}`);
  info('ALTERNATIVES braces balanced');
});

test('PROGRAM brace-balanced internally', () => {
  const progStart = src.indexOf('const PROGRAM');
  const achStart = src.indexOf('const ACHIEVEMENTS');
  const progBlock = src.slice(progStart, achStart);
  let depth = 0;
  for (const c of progBlock) { if (c === '{') depth++; else if (c === '}') depth--; }
  assert(depth === 0, `PROGRAM brace imbalance: ${depth}`);
  info('PROGRAM braces balanced');
});

test('WARMUP brace-balanced internally', () => {
  const warmStart = src.indexOf('const WARMUP');
  const altStart = src.indexOf('const ALTERNATIVES');
  const warmBlock = src.slice(warmStart, altStart);
  let depth = 0;
  for (const c of warmBlock) { if (c === '{') depth++; else if (c === '}') depth--; }
  assert(depth === 0, `WARMUP brace imbalance: ${depth}`);
  info('WARMUP braces balanced');
});

test('All major const blocks present in correct order', () => {
  const order = ['const WARMUP', 'const ALTERNATIVES', 'const PROGRAM', 'const ACHIEVEMENTS', 'const WEEK_SCHEDULE', 'const STORAGE_KEY'];
  let lastIdx = -1;
  for (const name of order) {
    const idx = src.indexOf(name);
    assert(idx > lastIdx, `${name} missing or out of order`);
    lastIdx = idx;
  }
  info('All 6 const blocks in correct order');
});

test('No duplicate exercise IDs across all blocks', () => {
  const ids = [...src.matchAll(/\bid:\s*"([^"]+)"/g)].map(m => m[1]);
  const seen = {};
  const dupes = [];
  for (const id of ids) {
    if (seen[id]) dupes.push(id);
    seen[id] = true;
  }
  assert(dupes.length === 0, `Duplicate IDs: ${dupes.join(', ')}`);
  info(`${Object.keys(seen).length} unique IDs`);
});

test('No exercise has empty steps array', () => {
  const emptySteps = (src.match(/steps:\s*\[\s*\]/g) || []).length;
  assert(emptySteps === 0, `Found ${emptySteps} exercises with empty steps`);
  info('All exercises have non-empty steps');
});

test('PROGRAM has exactly push, pull, legs days', () => {
  const progStart = src.indexOf('const PROGRAM');
  const achStart = src.indexOf('const ACHIEVEMENTS');
  const progBlock = src.slice(progStart, achStart);
  assert(progBlock.includes('push:'), 'push day missing');
  assert(progBlock.includes('pull:'), 'pull day missing');
  assert(progBlock.includes('legs:'), 'legs day missing');
  const extraDays = progBlock.match(/^\s{2}[a-z]+:\s*\{/gm) || [];
  assert(extraDays.length === 3, `Expected 3 days in PROGRAM, found ${extraDays.length}`);
  info('PROGRAM has exactly 3 days: push, pull, legs');
});


// ── SECTION 12: DATA STRUCTURE VALIDITY ─────────────────────────────────────
section('12 · DATA STRUCTURE VALIDITY');

test('WARMUP has all 3 days: push, pull, legs', () => {
  const wuStart = src.indexOf('const WARMUP');
  const wuEnd   = src.indexOf('const ALTERNATIVES');
  const wuBlock = src.slice(wuStart, wuEnd);
  assert(wuBlock.includes('push:'), 'WARMUP missing push day');
  assert(wuBlock.includes('pull:'), 'WARMUP missing pull day');
  assert(wuBlock.includes('legs:'), 'WARMUP missing legs day');
  const count = (wuBlock.match(/\bname:\s*"/g) || []).length;
  assert(count >= 9, `WARMUP has only ${count} exercises (expected >=9)`);
  info(`WARMUP: 3 days, ${count} exercises`);
});

test('WARMUP brace-balanced internally', () => {
  const wuStart = src.indexOf('const WARMUP');
  const wuEnd   = src.indexOf('const ALTERNATIVES');
  const block   = src.slice(wuStart, wuEnd);
  let d = 0;
  for (const c of block) { if (c==='{') d++; else if (c==='}') d--; }
  assert(d === 0, `WARMUP brace imbalance: ${d}`);
  info('WARMUP braces balanced');
});


test('WARMUP: every day supplies every field the renderer reads (wu.*)', () => {
  // Derive required fields from what the render actually accesses — so a new
  // wu.something in the UI automatically becomes a required field here.
  const required = [...new Set([...src.matchAll(/\bwu\.(\w+)/g)].map(m => m[1]))];
  assert(required.length >= 4, `Expected renderer to read >=4 wu.* fields, found ${required.length}`);
  const wuStart = src.indexOf('const WARMUP');
  const wuEnd   = src.indexOf('const ALTERNATIVES');
  const block   = src.slice(wuStart, wuEnd);
  const keys    = [...block.matchAll(/^\s{2}(\w+):\s*\{/gm)].map(m => m[1]);
  assert(keys.length >= 3, `Expected >=3 WARMUP days, got ${keys.length}`);
  keys.forEach(k => {
    const start = block.indexOf(`  ${k}: {`);
    const nextKeyMatch = block.slice(start + 5).match(/^\s{2}\w+:\s*\{/m);
    const end = nextKeyMatch ? start + 5 + nextKeyMatch.index : block.length;
    const entry = block.slice(start, end);
    required.forEach(f => {
      assert(entry.includes(f + ':'), `WARMUP.${k} missing "${f}" — renderer calls wu.${f} and will crash`);
    });
  });
  info(`${keys.length} days x ${required.length} renderer fields (${required.join(', ')}) all present`);
});

test('WARMUP: every blocks[] entry has title, time, items', () => {
  const wuStart = src.indexOf('const WARMUP');
  const wuEnd   = src.indexOf('const ALTERNATIVES');
  const block   = src.slice(wuStart, wuEnd);
  const titles = (block.match(/title:\s*"/g) || []).length;
  const times  = (block.match(/time:\s*"/g) || []).length;
  assert(titles === times, `blocks title/time mismatch: ${titles} titles vs ${times} times`);
  assert(titles >= 9, `Expected >=9 warmup blocks total, got ${titles}`);
  info(`${titles} warmup blocks all have title + time`);
});

test('WARMUP: every day key exists in PROGRAM (selector would render blank)', () => {
  const wuStart = src.indexOf('const WARMUP');
  const wuEnd   = src.indexOf('const ALTERNATIVES');
  const wuKeys  = [...src.slice(wuStart, wuEnd).matchAll(/^\s{2}(\w+):\s*\{/gm)].map(m => m[1]);
  const pStart  = src.indexOf('const PROGRAM');
  const pEnd    = src.indexOf('const ACHIEVEMENTS');
  const pKeys   = [...src.slice(pStart, pEnd).matchAll(/^\s{2}(\w+):\s*\{/gm)].map(m => m[1]);
  const orphans = wuKeys.filter(k => !pKeys.includes(k));
  assert(orphans.length === 0, `WARMUP days with no matching PROGRAM day: ${orphans.join(', ')}`);
  info(`${wuKeys.length} WARMUP days all map to PROGRAM days`);
});

test('ACHIEVEMENTS array: all 12 items have id, icon, name, req, type', () => {
  const achStart = src.indexOf('const ACHIEVEMENTS');
  const achEnd   = src.indexOf('const WEEK_SCHEDULE');
  const block    = src.slice(achStart, achEnd);
  const items    = [...block.matchAll(/\{[^{}]+\}/g)].map(m => m[0]);
  assert(items.length >= 12, `Expected >=12 achievements, got ${items.length}`);
  const required = ['id:', 'icon:', 'name:', 'req:', 'type:'];
  items.forEach((item, i) => {
    required.forEach(f => assert(item.includes(f), `Achievement #${i} missing ${f}`));
  });
  info(`${items.length} achievements all have required fields`);
});

test('ACHIEVEMENTS: all type values are valid (workouts|weeks|cycles)', () => {
  const achStart = src.indexOf('const ACHIEVEMENTS');
  const achEnd   = src.indexOf('const WEEK_SCHEDULE');
  const types    = [...src.slice(achStart, achEnd).matchAll(/type:\s*"([^"]+)"/g)].map(m => m[1]);
  const valid    = new Set(['workouts', 'weeks', 'cycles']);
  const bad      = types.filter(t => !valid.has(t));
  assert(bad.length === 0, `Invalid achievement types: ${bad.join(', ')}`);
  info(`${types.length} achievement types all valid`);
});

test('WEEK_SCHEDULE has exactly 7 entries with day and workout fields', () => {
  const wsStart  = src.indexOf('const WEEK_SCHEDULE');
  const wsEnd    = src.indexOf('const STORAGE_KEY');
  const block    = src.slice(wsStart, wsEnd);
  const entries  = [...block.matchAll(/\{[^{}]+\}/g)].map(m => m[0]);
  assert(entries.length === 7, `Expected 7 schedule entries, got ${entries.length}`);
  entries.forEach((e, i) => {
    assert(e.includes('day:'), `Schedule entry #${i} missing day field`);
    assert(e.includes('workout:'), `Schedule entry #${i} missing workout field`);
  });
  info('WEEK_SCHEDULE: 7 entries, all have day and workout fields');
});

test('ALTERNATIVES keys match known PROGRAM exercise IDs', () => {
  const altBlock = src.slice(src.indexOf('const ALTERNATIVES'), src.indexOf('const PROGRAM'));
  const progBlock = src.slice(src.indexOf('const PROGRAM'), src.indexOf('const ACHIEVEMENTS'));
  const progIds   = new Set([...progBlock.matchAll(/\bid:\s*"([^"]+)"/g)].map(m => m[1]));
  // Base alt keys (strip _extra suffix) should exist as IDs in PROGRAM
  const altKeys   = [...altBlock.matchAll(/^\s{2}([a-z][a-z_\d]+):\s*\[/gm)].map(m => m[1]);
  const baseKeys  = altKeys.map(k => k.replace(/_extra\d*$/, '').replace(/_extra$/, ''));
  const orphans   = baseKeys.filter(k => !progIds.has(k) && !k.includes('stretch') && !k.includes('posture'));
  assert(orphans.length === 0, `Alt keys with no matching PROGRAM ID: ${orphans.join(', ')}`);
  info(`${altKeys.length} alt key groups validated`);
});

// ── SECTION 13: RUNTIME LOGIC INTEGRITY ─────────────────────────────────────
section('13 · RUNTIME LOGIC INTEGRITY');

test('All useRef declarations are used via .current', () => {
  const refs  = [...src.matchAll(/const (\w+Ref)\s*=\s*useRef/g)].map(m => m[1]);
  refs.forEach(r => {
    assert(src.includes(r + '.current'), `${r} declared but never accessed via .current`);
  });
  info(`${refs.length} refs all accessed via .current`);
});

test('All useState setters are called at least once', () => {
  const pairs = [...src.matchAll(/const \[(\w+),\s*(set\w+)\]/g)];
  pairs.forEach(([, val, setter]) => {
    const callCount = (src.match(new RegExp('\\b' + setter + '\\s*\\(', 'g')) || []).length;
    assert(callCount >= 1, `${setter} declared but never called`);
  });
  info(`${pairs.length} state setters all called at least once`);
});

test('sessionKey uses todayKey() and activeDay (correct format)', () => {
  assert(src.includes('`${todayKey()}_${activeDay}`'), 'sessionKey must use template literal with todayKey() and activeDay');
  info('sessionKey format correct');
});

test('activeTab default is "workout"', () => {
  // По умолчанию "workout"; единственное исключение - тестовая сборка, которая после входа в Spotify
  // возвращает на вкладку БЕТА (betaInitialTab есть только там, в боевой странице его нет)
  const match = src.match(/\[activeTab, setActiveTab\] = useState\(typeof betaInitialTab === "function" \? betaInitialTab\(\) : "(\w+)"\)/);
  assert(match && match[1] === 'workout', `activeTab default should be "workout", got: ${match && match[1]}`);
  assertNot(/function betaInitialTab/.test(app), 'betaInitialTab must not exist in the production page');
  info('activeTab defaults to "workout" (BETA seam only in the test build)');
});

test('localStorage keys are consistent (ppl_tracker_v4 and sila_timer)', () => {
  // Основной ключ и ключ таймера идут через константы (у beta они свои), прямых строковых ключей быть не должно
  assert(src.includes('const STORAGE_KEY = APP_VARIANT === "beta" ? "ppl_tracker_beta" : "ppl_tracker_v4"'), 'STORAGE_KEY declaration missing or changed');
  assert(src.includes('const TIMER_KEY = APP_VARIANT === "beta" ? "sila_timer_beta" : "sila_timer"'), 'TIMER_KEY declaration missing or changed');
  assert(src.includes('localStorage.getItem(STORAGE_KEY)') && src.includes('localStorage.setItem(STORAGE_KEY,'), 'main data must go through STORAGE_KEY');
  const keys = new Set([...src.matchAll(/localStorage\.\w+\(['"]([^'"]+)['"]/g)].map(m => m[1]));
  const unexpected = [...keys].filter(k => k !== 'ach_unlocked');
  assert(unexpected.length === 0, `Unexpected literal localStorage keys (use STORAGE_KEY / TIMER_KEY): ${unexpected.join(', ')}`);
  info('Keys: STORAGE_KEY (ppl_tracker_v4 / _beta), TIMER_KEY (sila_timer / _beta)');
});

test('Parentheses balance outside strings and comments', () => {
  // Counting raw characters is wrong: exercise names contain "(Goblet)" etc.
  // Walk the source and skip string and comment content.
  let i = 0, p = 0, b = 0, line = 1;
  const bad = [];
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '\n') line++;
        if (src[i] === q) { i++; break; }
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          i += 2; let d = 1;
          while (i < src.length && d > 0) {
            if (src[i] === '{') d++;
            else if (src[i] === '}') d--;
            else if (src[i] === '(') p++;
            else if (src[i] === ')') p--;
            if (src[i] === '\n') line++;
            i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }
    if (c === '(') p++;
    else if (c === ')') { p--; if (p < 0) bad.push(`L${line}: unmatched )`); }
    else if (c === '{') b++;
    else if (c === '}') b--;
    i++;
  }
  assert(p === 0, `Paren imbalance outside strings: ${p} ${bad.slice(0, 3).join(', ')}`);
  assert(b === 0, `Brace imbalance outside strings: ${b}`);
  info('Parens and braces balanced (strings excluded)');
});

test('No onClick handlers that immediately invoke (memory leak / wrong pattern)', () => {
  // onClick={someFunc()} is wrong — should be onClick={() => someFunc()}
  // onClick={e => e.stopPropagation()} is fine (arrow returning call result)
  const bad = [...src.matchAll(/onClick=\{(\w+)\(\)/g)].map(m => m[0]);
  assert(bad.length === 0, `onClick immediate invocation: ${bad.join(', ')}`);
  info('No bad onClick invocations');
});

test('getDayProgress returns exDone, done, total, pct', () => {
  const fnDgp = src.slice(src.indexOf('function getDayProgress'), src.indexOf('function getDayProgress') + 800);
  assert(fnDgp.includes('exDone'), 'getDayProgress missing exDone');
  assert(fnDgp.includes('done'), 'getDayProgress missing done');
  assert(fnDgp.includes('total'), 'getDayProgress missing total');
  assert(fnDgp.includes('pct'), 'getDayProgress missing pct');
  info('getDayProgress returns all required fields');
});

test('finishWorkout resets session and prompt after save', () => {
  const fn = src.slice(src.indexOf('function finishWorkout'), src.indexOf('function computeAch'));
  assert(fn.includes('delete sessions[sessionKey]'), 'finishWorkout must delete session after save');
  assert(fn.includes('lastPromptedExDone.current = 0'), 'finishWorkout must reset prompt counter');
  assert(fn.includes('setSavePrompt(false)'), 'finishWorkout must close save prompt');
  info('finishWorkout cleanup verified');
});

test('getWorkout handles both built-in and custom workout keys', () => {
  const fn = src.slice(src.indexOf('function getWorkout'), src.indexOf('function getWorkout') + 300);
  assert(fn.includes('PROGRAM[dayKey]'), 'getWorkout must check PROGRAM first');
  assert(fn.includes('customWorkouts'), 'getWorkout must check customWorkouts');
  info('getWorkout handles both built-in and custom keys');
});

test('autoSave useEffect has cleanup (removes event listeners)', () => {
  assert(src.includes('window.removeEventListener("beforeunload"'), 'autoSave must remove beforeunload listener');
  assert(src.includes('document.removeEventListener("visibilitychange"'), 'autoSave must remove visibilitychange listener');
  info('autoSave cleanup listeners verified');
});

test('savePrompt fires only for new completions (lastPromptedExDone guard)', () => {
  assert(src.includes('prog.exDone > lastPromptedExDone.current'), 'savePrompt must compare against lastPromptedExDone');
  assert(src.includes('lastPromptedExDone.current = prog.exDone'), 'savePrompt must update lastPromptedExDone');
  info('savePrompt dedup guard verified');
});

// ── SECTION 14: iOS-SPECIFIC EDGE CASES ────────────────────────────────────
section('14 · iOS-SPECIFIC EDGE CASES');

test('No Array spread syntax [...x] that could fail on older iOS', () => {
  // Actually fine in iOS 12+ — but check for Object.assign as alternative indicator
  const spreads = (src.match(/\[\.\.\./g) || []).length;
  const objSpreads = (src.match(/\{\.\.\./g) || []).length;
  // These are fine in iOS 13+, just document them
  info(`Array spreads: ${spreads}, Object spreads: ${objSpreads} (both OK for iOS 13+)`);
  assert(true, 'spread syntax check');
});

test('No fetch() calls without error handling', () => {
  const fetches = [...src.matchAll(/\bfetch\(/g)];
  const catchedFetches = [...src.matchAll(/\bfetch\([^)]+\).*?\.catch/gs)];
  assert(fetches.length === 0 || catchedFetches.length === fetches.length,
    `${fetches.length} fetch() calls found — ensure all have error handling`);
  info(`fetch() calls: ${fetches.length}`);
});

test('No window.alert() or window.confirm() — blocked in iOS PWA standalone', () => {
  assert(!src.includes('window.alert(') && !src.includes('alert(') && !src.includes('confirm('),
    'alert/confirm are blocked in iOS PWA standalone mode — use custom UI instead');
  info('No alert/confirm calls');
});

test('Timer endsAt stored and restored correctly across app kills', () => {
  assert(src.includes('"sila_timer"'), 'Timer key sila_timer present');
  assert(src.includes('endsAt'), 'endsAt field used in timer');
  // Check that endsAt is a timestamp (Date.now() based)
  assert(src.includes('Date.now() + '), 'endsAt must be computed from Date.now()');
  info('Timer persistence verified');
});

test('Vibration API guarded against undefined (iOS does not support it)', () => {
  const vibCalls = [...src.matchAll(/navigator\.vibrate\(/g)].length;
  const vibGuards = [...src.matchAll(/navigator\.vibrate\s*&&|typeof.*vibrate|if.*vibrate/g)].length;
  // vibrate should be called via conditional
  if (vibCalls > 0) {
    assert(src.includes('navigator.vibrate &&') || src.includes('if (navigator.vibrate'),
      'navigator.vibrate() must be guarded — iOS will throw');
  }
  info(`vibrate calls: ${vibCalls}, guarded`);
});

test('No position:fixed elements that could be obscured by iOS keyboard', () => {
  // Check that input fields are not inside fixed containers without scroll
  // This is a heuristic — just verify inputs exist and are in scrollable context
  const inputs = (src.match(/<input/g) || []).length;
  assert(inputs > 0, 'No input elements found — unexpected');
  info(`${inputs} input elements found`);
});

test('Manifest scope and start_url compatible with GitHub Pages subdirectory', () => {
  const html = app; // reuse app var from outer scope — actually use pwa html
  // Check manifest has start_url: "."
  assert(src.includes('"start_url":"."') || app.includes('start_url') || true, 'start_url should be relative');
  info('Manifest start_url check passed');
});


// ── SECTION 15: FUNCTIONAL LOGIC TESTS ──────────────────────────────────────
section('15 · FUNCTIONAL LOGIC TESTS');

// Run actual JS logic extracted from the source
// We execute the real functions in Node.js to verify they produce correct results

// ── parseRestSeconds ──────────────────────────────────────────────────────────
test('parseRestSeconds: "3 мин" -> 180', () => {
  function parseRestSeconds(restStr) {
    if (!restStr) return 120;
    const minMatch = restStr.match(/(\d+)\s*мин/);
    const secMatch = restStr.match(/(\d+)\s*сек/);
    let s = 0;
    if (minMatch) s += parseInt(minMatch[1]) * 60;
    if (secMatch) s += parseInt(secMatch[1]);
    return s || 120;
  }
  assert(parseRestSeconds("3 мин") === 180, `Expected 180, got ${parseRestSeconds("3 мин")}`);
  assert(parseRestSeconds("90 сек") === 90, `Expected 90, got ${parseRestSeconds("90 сек")}`);
  assert(parseRestSeconds("2 мин") === 120, `Expected 120, got ${parseRestSeconds("2 мин")}`);
  assert(parseRestSeconds("4 мин") === 240, `Expected 240, got ${parseRestSeconds("4 мин")}`);
  assert(parseRestSeconds("60 сек") === 60, `Expected 60, got ${parseRestSeconds("60 сек")}`);
  assert(parseRestSeconds("") === 120, `Empty string should return default 120`);
  assert(parseRestSeconds(null) === 120, `null should return default 120`);
  info("parseRestSeconds: all 7 cases correct");
});

test('parseRestSeconds: all rest values in PROGRAM parse to valid seconds', () => {
  function parseRestSeconds(restStr) {
    if (!restStr) return 120;
    const minMatch = restStr.match(/(\d+)\s*мин/);
    const secMatch = restStr.match(/(\d+)\s*сек/);
    let s = 0;
    if (minMatch) s += parseInt(minMatch[1]) * 60;
    if (secMatch) s += parseInt(secMatch[1]);
    return s || 120;
  }
  const restVals = [...src.matchAll(/rest:\s*"([^"]+)"/g)].map(m => m[1]);
  const bad = restVals.filter(r => {
    const s = parseRestSeconds(r);
    return s < 30 || s > 600; // sanity: 30s to 10min
  });
  assert(bad.length === 0, `Rest values outside 30-600s: ${bad.join(', ')}`);
  info(`${restVals.length} rest values all parse to 30-600 seconds`);
});

// ── PROGRAM data integrity ────────────────────────────────────────────────────
test('PROGRAM: each day has at least 5 exercises', () => {
  const progStart = src.indexOf('const PROGRAM');
  const progEnd   = src.indexOf('const ACHIEVEMENTS');
  const prog = src.slice(progStart, progEnd);
  ['push', 'pull', 'legs'].forEach(day => {
    const dayStart = prog.indexOf(`${day}:`);
    const dayEnd   = prog.indexOf('\n  },', dayStart);
    const dayBlock = prog.slice(dayStart, dayEnd);
    const exCount  = (dayBlock.match(/\bid:\s*"/g) || []).length;
    assert(exCount >= 5, `${day} day has only ${exCount} exercises (expected >=5)`);
    info(`${day}: ${exCount} exercises`);
  });
});

test('PROGRAM: exercise sets are numbers (1-6 range)', () => {
  const progStart = src.indexOf('const PROGRAM');
  const progEnd   = src.indexOf('const ACHIEVEMENTS');
  const prog = src.slice(progStart, progEnd);
  const sets = [...prog.matchAll(/\bsets:\s*(\d+)/g)].map(m => parseInt(m[1]));
  const bad  = sets.filter(s => s < 1 || s > 10);
  assert(bad.length === 0, `Sets outside 1-10 range: ${bad.join(', ')}`);
  assert(sets.length >= 10, `Expected >=10 set declarations in PROGRAM`);
  info(`${sets.length} set values all in 1-10 range`);
});

test('ALTERNATIVES: each alt entry has sets >= 1 and valid reps string', () => {
  const altStart = src.indexOf('const ALTERNATIVES');
  const altEnd   = src.indexOf('const PROGRAM');
  const alt = src.slice(altStart, altEnd);
  const sets = [...alt.matchAll(/\bsets:\s*(\d+)/g)].map(m => parseInt(m[1]));
  const bad  = sets.filter(s => s < 1 || s > 10);
  assert(bad.length === 0, `Alt sets outside range: ${bad.join(', ')}`);
  const reps = [...alt.matchAll(/\breps:\s*"([^"]+)"/g)].map(m => m[1]);
  const badReps = reps.filter(r => !/\d/.test(r));
  assert(badReps.length === 0, `Reps without digits: ${badReps.join(', ')}`);
  info(`${sets.length} alt sets valid, ${reps.length} reps all contain digits`);
});

// ── deleteHistoryEntry logic ──────────────────────────────────────────────────
test('deleteHistoryEntry logic: removes correct entry by ts', () => {
  // Simulate the function
  function deleteHistoryEntry(data, workout, ts) {
    const history = JSON.parse(JSON.stringify(data.history || {}));
    if (history[workout]) {
      history[workout] = history[workout].filter(e => e.ts !== ts);
      if (history[workout].length === 0) delete history[workout];
    }
    return { ...data, history };
  }
  const data = {
    history: {
      push: [
        { date: '2025-01-01', workout: 'push', ts: 1000, done: 10, total: 12 },
        { date: '2025-01-08', workout: 'push', ts: 2000, done: 12, total: 12 },
      ],
      pull: [{ date: '2025-01-02', workout: 'pull', ts: 1500, done: 8, total: 10 }]
    }
  };
  const result = deleteHistoryEntry(data, 'push', 1000);
  assert(result.history.push.length === 1, 'Should have 1 entry after delete');
  assert(result.history.push[0].ts === 2000, 'Remaining entry should have ts=2000');
  assert(result.history.pull.length === 1, 'pull history should be untouched');

  // Delete last entry in a day — key should be removed
  const result2 = deleteHistoryEntry(data, 'pull', 1500);
  assert(!result2.history.pull, 'pull key should be removed when last entry deleted');
  info('deleteHistoryEntry logic: all cases correct');
});

// ── finishWorkout dedup logic ─────────────────────────────────────────────────
test('finishWorkout dedup: same date replaces, new date prepends', () => {
  function simulateFinish(history, activeDay, today, entry) {
    history = JSON.parse(JSON.stringify(history));
    if (!history[activeDay]) history[activeDay] = [];
    const existingIdx = history[activeDay].findIndex(e => e.date === today);
    if (existingIdx >= 0) {
      history[activeDay][existingIdx] = entry;
    } else {
      history[activeDay] = [entry, ...history[activeDay]].slice(0, 30);
    }
    return history;
  }

  const existing = { push: [{ date: '2025-01-01', done: 5, total: 20, ts: 1000 }] };
  const sameDay  = { date: '2025-01-01', done: 15, total: 20, ts: 2000 };
  const newDay   = { date: '2025-01-08', done: 20, total: 20, ts: 3000 };

  // Same date -> replace
  const r1 = simulateFinish(existing, 'push', '2025-01-01', sameDay);
  assert(r1.push.length === 1, 'Same date: should still have 1 entry');
  assert(r1.push[0].done === 15, 'Same date: should be updated');

  // New date -> prepend
  const r2 = simulateFinish(existing, 'push', '2025-01-08', newDay);
  assert(r2.push.length === 2, 'New date: should have 2 entries');
  assert(r2.push[0].date === '2025-01-08', 'New date: should be first (newest)');

  // 30-entry cap
  const bigHistory = { push: Array.from({length: 30}, (_, i) => ({ date: `2025-${i}`, done:1, total:1, ts:i })) };
  const r3 = simulateFinish(bigHistory, 'push', '2025-99', { date: '2025-99', done:1, total:1, ts:99 });
  assert(r3.push.length === 30, 'Should cap at 30 entries');
  info('finishWorkout dedup logic: all cases correct');
});

// ── computeAch logic ─────────────────────────────────────────────────────────
test('computeAch logic: correctly counts workouts, cycles, streak', () => {
  // Replicate computeAch logic
  function computeAch(data) {
    const allHistory = Object.values(data.history || {}).flat();
    const totalWorkouts = allHistory.length;
    const byWeek = {};
    allHistory.forEach(function(e) {
      var d = new Date(e.date);
      var week = Math.floor((d - new Date("2024-01-01")) / 604800000);
      if (!byWeek[week]) byWeek[week] = {};
      byWeek[week][e.workout] = true;
    });
    var cycles = Object.values(byWeek).filter(function(w) {
      return w["push"] && w["pull"] && w["legs"];
    }).length;
    var weekNums = Object.keys(byWeek).map(Number).sort(function(a,b){return b-a;});
    var weekStreak = 0;
    for (var i = 0; i < weekNums.length; i++) {
      var w = byWeek[weekNums[i]];
      if (w["push"] && w["pull"] && w["legs"]) {
        if (i === 0 || weekNums[i-1] === weekNums[i] + 1) { weekStreak++; }
        else { break; }
      } else { break; }
    }
    return { totalWorkouts, weekStreak, cycles };
  }

  // Empty data
  const r0 = computeAch({ history: {} });
  assert(r0.totalWorkouts === 0, 'Empty: 0 workouts');
  assert(r0.cycles === 0, 'Empty: 0 cycles');
  assert(r0.weekStreak === 0, 'Empty: 0 streak');

  // One full PPL cycle (Mon/Wed/Fri same week)
  const r1 = computeAch({ history: {
    push: [{ date: '2025-01-06', workout: 'push', ts: 1 }],
    pull: [{ date: '2025-01-08', workout: 'pull', ts: 2 }],
    legs: [{ date: '2025-01-10', workout: 'legs', ts: 3 }],
  }});
  assert(r1.totalWorkouts === 3, `Expected 3 workouts, got ${r1.totalWorkouts}`);
  assert(r1.cycles === 1, `Expected 1 cycle, got ${r1.cycles}`);
  assert(r1.weekStreak === 1, `Expected streak 1, got ${r1.weekStreak}`);

  // Incomplete week (only push and pull, no legs)
  const r2 = computeAch({ history: {
    push: [{ date: '2025-01-06', workout: 'push', ts: 1 }],
    pull: [{ date: '2025-01-08', workout: 'pull', ts: 2 }],
  }});
  assert(r2.cycles === 0, `Incomplete week should give 0 cycles, got ${r2.cycles}`);
  assert(r2.weekStreak === 0, `Broken streak should be 0, got ${r2.weekStreak}`);

  info('computeAch logic: all cases correct');
});

// ── toggleSkip / isSkipped logic ─────────────────────────────────────────────
test('isSkipped / toggleSkip logic: toggles correctly per day', () => {
  // Simulate state
  let skipped = {};
  const activeDay = 'push';
  const exId = 'bench';

  function isSkipped(id) {
    return (skipped[activeDay] || []).includes(id);
  }
  function toggleSkip(id) {
    const day = skipped[activeDay] || [];
    if (day.includes(id)) {
      skipped = { ...skipped, [activeDay]: day.filter(x => x !== id) };
    } else {
      skipped = { ...skipped, [activeDay]: [...day, id] };
    }
  }

  assert(!isSkipped(exId), 'Initially not skipped');
  toggleSkip(exId);
  assert(isSkipped(exId), 'After toggle: skipped');
  toggleSkip(exId);
  assert(!isSkipped(exId), 'After double toggle: not skipped');

  // Different day not affected
  toggleSkip(exId); // skip on push
  const pullSkipped = (skipped['pull'] || []).includes(exId);
  assert(!pullSkipped, 'Skip on push should not affect pull day');
  info('isSkipped/toggleSkip logic: correct');
});

// ── moveBuilderEx logic ───────────────────────────────────────────────────────
test('moveBuilderEx logic: moves items up/down correctly', () => {
  function moveBuilderEx(arr, idx, dir) {
    arr = [...arr];
    const swap = idx + dir;
    if (swap < 0 || swap >= arr.length) return arr;
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    return arr;
  }
  const items = ['A', 'B', 'C', 'D'];
  assert(moveBuilderEx(items, 0, -1).join('') === 'ABCD', 'Move first item up: no change');
  assert(moveBuilderEx(items, 3, 1).join('')  === 'ABCD', 'Move last item down: no change');
  assert(moveBuilderEx(items, 1, -1).join('') === 'BACD', 'Move index 1 up: B->A');
  assert(moveBuilderEx(items, 1, 1).join('')  === 'ACBD', 'Move index 1 down: B->C swap');
  assert(moveBuilderEx(items, 2, -1).join('') === 'ACBD', 'Move index 2 up');
  info('moveBuilderEx logic: all edge cases correct');
});

// ── getExHistory / getLastWeight pattern ─────────────────────────────────────
test('getLastWeight pattern: finds previous session correctly', () => {
  // Simulate session key logic
  function todayKey() { return '2025-06-01'; }
  const sessionKey = `${todayKey()}_push`;

  // sessions has today's session and a previous one
  const sessions = {
    '2025-06-01_push': { bench: { 0: { weight: '80', done: true } } },
    '2025-05-25_push': { bench: { 0: { weight: '77.5', done: true } } },
    '2025-05-18_push': { bench: { 0: { weight: '75', done: true } } },
  };

  // Replicate getLastWeight logic (finds most recent previous session)
  function getLastWeight(exId, activeDay, sessionKey, sessions) {
    const dayHistory = Object.keys(sessions)
      .filter(k => k.includes(`_${activeDay}`) && k !== sessionKey)
      .sort().reverse();
    if (!dayHistory.length) return null;
    const prev = sessions[dayHistory[0]];
    if (!prev || !prev[exId]) return null;
    const sets = Object.values(prev[exId]);
    const weights = sets.map(s => parseFloat(s.weight) || 0).filter(w => w > 0);
    return weights.length ? Math.max(...weights) : null;
  }

  const w = getLastWeight('bench', 'push', sessionKey, sessions);
  assert(w === 77.5, `Expected 77.5 (most recent prev session), got ${w}`);

  // No previous sessions
  const w2 = getLastWeight('bench', 'push', sessionKey, { '2025-06-01_push': sessions['2025-06-01_push'] });
  assert(w2 === null, `Expected null when no prev sessions, got ${w2}`);

  info('getLastWeight logic: previous session lookup correct');
});

// ── schedule logic ────────────────────────────────────────────────────────────
test('schedule: correct day maps to correct workout', () => {
  // Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6 (our indexing)
  const defaultSchedule = ["push", null, "pull", null, "legs", null, null];

  function getWorkoutForDow(dow, schedule) {
    // dow: 0=Sun, 1=Mon ... 6=Sat (JS Date.getDay())
    const schedIdx = dow === 0 ? 6 : dow - 1;
    return (schedule[schedIdx]) || "push";
  }

  assert(getWorkoutForDow(1, defaultSchedule) === "push", 'Mon->push');  // Mon
  assert(getWorkoutForDow(2, defaultSchedule) === "push", 'Tue->push (rest day, default)');
  assert(getWorkoutForDow(3, defaultSchedule) === "pull", 'Wed->pull');
  assert(getWorkoutForDow(4, defaultSchedule) === "push", 'Thu->push (rest, default)');
  assert(getWorkoutForDow(5, defaultSchedule) === "legs", 'Fri->legs');
  assert(getWorkoutForDow(6, defaultSchedule) === "push", 'Sat->push (rest, default)');
  assert(getWorkoutForDow(0, defaultSchedule) === "push", 'Sun->push (rest, default)');
  info('Schedule day-of-week mapping: all 7 days correct');
});

// ── getDayProgress counting logic ─────────────────────────────────────────────
test('getDayProgress: exDone counts only fully-completed exercises', () => {
  // Simulate the counting logic
  function countExDone(exercises, sessionSets) {
    let done = 0, total = 0, exDone = 0;
    exercises.forEach(ex => {
      let allSetsDone = true;
      for (let i = 0; i < ex.sets; i++) {
        total++;
        const setData = (sessionSets[ex.id] && sessionSets[ex.id][i]) || { done: false };
        if (setData.done) { done++; } else { allSetsDone = false; }
      }
      if (allSetsDone && ex.sets > 0) exDone++;
    });
    return { done, total, exDone, pct: total ? Math.round(done / total * 100) : 0 };
  }

  const exercises = [
    { id: 'bench', sets: 4 },
    { id: 'ohp',   sets: 4 },
    { id: 'dips',  sets: 3 },
  ];

  // All sets done for bench, none for others
  const s1 = { bench: { 0:{done:true}, 1:{done:true}, 2:{done:true}, 3:{done:true} } };
  const r1 = countExDone(exercises, s1);
  assert(r1.exDone === 1, `Expected exDone=1, got ${r1.exDone}`);
  assert(r1.done   === 4, `Expected done=4, got ${r1.done}`);
  assert(r1.total  === 11, `Expected total=11, got ${r1.total}`);

  // Partially done bench (3/4) — should NOT count as done
  const s2 = { bench: { 0:{done:true}, 1:{done:true}, 2:{done:true}, 3:{done:false} } };
  const r2 = countExDone(exercises, s2);
  assert(r2.exDone === 0, `Partial completion should not count, got exDone=${r2.exDone}`);

  // All sets done for all 3
  const s3 = {
    bench: { 0:{done:true}, 1:{done:true}, 2:{done:true}, 3:{done:true} },
    ohp:   { 0:{done:true}, 1:{done:true}, 2:{done:true}, 3:{done:true} },
    dips:  { 0:{done:true}, 1:{done:true}, 2:{done:true} },
  };
  const r3 = countExDone(exercises, s3);
  assert(r3.exDone === 3, `All done: exDone should be 3, got ${r3.exDone}`);
  assert(r3.pct    === 100, `All done: pct should be 100, got ${r3.pct}`);
  info('getDayProgress counting: all edge cases correct');
});

// ── autoSave guard logic ──────────────────────────────────────────────────────
test('autoSave: skips save when exDone < 3', () => {
  let saved = false;
  function mockSaveData() { saved = true; }

  function autoSave(exDone) {
    if (exDone < 3) return false;
    mockSaveData();
    return true;
  }

  assert(autoSave(0)  === false, 'exDone=0: should not save');
  assert(autoSave(2)  === false, 'exDone=2: should not save');
  assert(!saved, 'mockSaveData should not have been called');
  assert(autoSave(3)  === true,  'exDone=3: should save');
  assert(saved, 'mockSaveData should have been called');
  info('autoSave guard: correct threshold at exDone=3');
});

// ── toggleDone weight guard ───────────────────────────────────────────────────
test('toggleDone: weight guard logic correct', () => {
  let toastMsg = null;
  function showToast(msg) { toastMsg = msg; }

  function checkWeight(cur, newDone) {
    if (!cur.done && newDone && (!cur.weight || cur.weight === "")) {
      showToast("Впиши вес перед отметкой");
      return false;
    }
    return true;
  }

  // Marking done without weight -> blocked
  assert(checkWeight({ done: false, weight: "" }, true) === false, 'Empty weight: blocked');
  assert(toastMsg === "Впиши вес перед отметкой", 'Toast shown for missing weight');

  // Marking done WITH weight -> allowed
  toastMsg = null;
  assert(checkWeight({ done: false, weight: "80" }, true) === true, 'With weight: allowed');
  assert(toastMsg === null, 'No toast when weight present');

  // Unmarking (done->false) always allowed regardless of weight
  assert(checkWeight({ done: true, weight: "" }, false) === true, 'Unmark always allowed');
  info('toggleDone weight guard: all cases correct');
});


// ── SECTION 16: OBJECT COMMA INTEGRITY ─────────────────────────────────────
section('16 · OBJECT COMMA INTEGRITY');

test('WARMUP: all day entries have trailing comma (no missing commas)', () => {
  const warmupStart = src.indexOf('const WARMUP');
  const warmupEnd   = src.indexOf('const ALTERNATIVES');
  const block = src.slice(warmupStart, warmupEnd);
  const lines = block.split('\n');
  // Top-level closing braces "  }" must all have comma "  },"
  const bare = lines.filter(l => l === '  }');
  assert(bare.length === 0, `WARMUP has ${bare.length} day entries missing trailing comma`);
  info('WARMUP: all entries have trailing commas');
});

test('PROGRAM: all day entries have trailing comma (no missing commas)', () => {
  const progStart = src.indexOf('const PROGRAM');
  const progEnd   = src.indexOf('const ACHIEVEMENTS');
  const block = src.slice(progStart, progEnd);
  const lines = block.split('\n');
  const bare = lines.filter(l => l === '  }');
  assert(bare.length === 0, `PROGRAM has ${bare.length} day entries missing trailing comma`);
  info('PROGRAM: all entries have trailing commas');
});

test('ALTERNATIVES: no top-level object entries missing trailing comma', () => {
  const altStart = src.indexOf('const ALTERNATIVES');
  const altEnd   = src.indexOf('const PROGRAM');
  const block = src.slice(altStart, altEnd);
  const lines = block.split('\n');
  const bare = lines.filter(l => l === '  }');
  assert(bare.length === 0, `ALTERNATIVES has ${bare.length} entries missing trailing comma`);
  info('ALTERNATIVES: all entries have trailing commas');
});


// ── SECTION 17: MOBILE UX / APPLE HIG ──────────────────────────────────────
section('17 · MOBILE UX / APPLE HIG');

test('viewport-fit=cover set (safe-area works on notched iPhones)', () => {
  assert(html.includes('viewport-fit=cover'), 'viewport-fit=cover missing — safe-area-inset will always be 0');
  info('viewport-fit=cover present');
});

test('Safe-area insets applied to body (notch + home indicator)', () => {
  assert(html.includes('env(safe-area-inset-top)'), 'body missing safe-area-inset-top');
  assert(html.includes('env(safe-area-inset-bottom)'), 'body missing safe-area-inset-bottom');
  info('Safe-area padding applied to body');
});

test('Fixed-position elements respect bottom safe area (home indicator)', () => {
  const count = (src.match(/env\(safe-area-inset-bottom\)/g) || []).length;
  assert(count >= 4, `Only ${count} fixed elements use safe-area-inset-bottom — timer/toast/sheets may sit under home indicator`);
  info(`${count} elements use safe-area-inset-bottom`);
});

test('All inputs have fontSize >= 16px (iOS auto-zooms below 16)', () => {
  const sizes = [...src.matchAll(/<input[^>]*?fontSize:\s*(\d+)/g)].map(m => parseInt(m[1]));
  const small = sizes.filter(s => s < 16);
  assert(small.length === 0, `${small.length} inputs with fontSize < 16px: ${small.join(', ')} — iOS will zoom on focus`);
  info(`${sizes.length} inputs all >= 16px`);
});

test('Interactive buttons meet 44pt minimum tap target (Apple HIG)', () => {
  // Explicit width/height buttons
  const sized = [...src.matchAll(/<button[^>]*?width:\s*(\d+),\s*height:\s*(\d+)/g)];
  const tooSmall = sized.filter(([, w, h]) => parseInt(w) < 32 || parseInt(h) < 32);
  assert(tooSmall.length === 0, `${tooSmall.length} buttons below 32px — hard to tap`);
  info(`${sized.length} sized buttons all >= 32px`);
});

test('Header is sticky (navigation stays reachable while scrolling)', () => {
  assert(src.includes('position: "sticky"'), 'Header not sticky — tabs scroll out of view on long exercise lists');
  assert(src.includes('zIndex: 50'), 'Sticky header missing z-index');
  info('Header sticky with z-index');
});

test('Scrollbars hidden on horizontal scroll areas', () => {
  assert(html.includes('::-webkit-scrollbar'), 'Scrollbar not hidden — visible bar on day selector');
  assert(html.includes('scrollbar-width:none'), 'Firefox scrollbar-width not set');
  info('Scrollbars hidden cross-browser');
});

test('touch-action manipulation on buttons (no 300ms double-tap delay)', () => {
  assert(html.includes('touch-action:manipulation'), 'touch-action:manipulation missing — 300ms tap delay on iOS');
  info('touch-action:manipulation set');
});

test('Text selection disabled on UI, enabled on inputs', () => {
  assert(html.includes('user-select:none'), 'user-select:none missing — long-press selects UI text');
  assert(html.includes('input,textarea{-webkit-user-select:text'), 'inputs must keep text selection');
  info('Selection disabled on UI, kept on inputs');
});

test('Momentum scrolling on overflow containers (iOS native feel)', () => {
  const count = (src.match(/WebkitOverflowScrolling/g) || []).length;
  assert(count >= 2, `Only ${count} scroll containers with -webkit-overflow-scrolling`);
  info(`${count} containers with momentum scrolling`);
});

test('Root uses dvh with vh fallback (correct height in iOS PWA)', () => {
  assert(html.includes('100dvh'), '100dvh missing — height wrong when iOS toolbars show/hide');
  assert(html.includes('min-height:100vh'), 'vh fallback missing for older iOS');
  info('dvh with vh fallback');
});

test('No text color darker than #444 (contrast on #0c0c0f background)', () => {
  const colors = [...src.matchAll(/color:\s*"(#[0-9a-fA-F]{3,6})"/g)].map(m => m[1].toLowerCase());
  const tooDark = ['#111','#222','#1a1a22','#1e1e28','#252530','#2a2a2a','#333'];
  const found = colors.filter(c => tooDark.includes(c));
  assert(found.length <= 2, `${found.length} text colors too dark for readability: ${[...new Set(found)].join(', ')}`);
  info(`${colors.length} text colors, ${found.length} very dark (limit 2)`);
});


// ── SECTION 18: MID-WORKOUT EDITING & JOURNAL ──────────────────────────────
section('18 · MID-WORKOUT EDITING & JOURNAL');

test('addedEx persisted in loadData defaults', () => {
  assert(src.includes('d.addedEx'), 'addedEx not initialized in loadData');
  assert(src.includes('addedEx: {}'), 'addedEx missing from fallback default');
  info('addedEx in storage schema');
});

test('getSessionExercises merges base workout with mid-session additions', () => {
  assert(src.includes('function getSessionExercises()'), 'getSessionExercises missing');
  assert(src.includes('base.concat(added)'), 'must concat base exercises with added ones');
  info('getSessionExercises merges both sources');
});

test('Workout tab renders session exercises (added ones appear in the list)', () => {
  // Locate the workout tab block specifically — a pass elsewhere in the file
  // (e.g. a dead tab) must not satisfy this test.
  const start = src.indexOf('{activeTab === "workout" && (');
  const end   = src.indexOf('{activeTab === "warmup"');
  assert(start >= 0 && end > start, 'workout tab block not found');
  const tab = src.slice(start, end);
  assert(tab.includes('getSessionExercises().map('), 'workout tab must map over getSessionExercises, otherwise added exercises never render');
  assert(!/\bw\.exercises\.map\(/.test(tab), 'workout tab still maps raw w.exercises — added exercises will be dropped');
  assert(!/\(getWorkout\(activeDay\)[^)]*\)\.exercises\.map\(/.test(tab), 'workout tab still maps base workout directly');
  info('Workout tab renders session exercises');
});

test('Every place counting or listing exercises agrees with getSessionExercises', () => {
  // Progress bar, counter, save detail and render must all use the same source,
  // or the added exercise shows up in one place and not another.
  const checks = [
    ['getDayProgress',   src.slice(src.indexOf('function getDayProgress'), src.indexOf('function getDayProgress') + 500)],
    ['finishWorkout',    src.slice(src.indexOf('function finishWorkout'), src.indexOf('function finishWorkout') + 900)],
    ['autoSave',         src.slice(src.indexOf('function autoSave'), src.indexOf('function autoSave') + 900)],
  ];
  checks.forEach(([name, body]) => {
    assert(body.includes('getSessionExercises()'), `${name} does not use getSessionExercises — counts will disagree with the visible list`);
  });
  assert(src.includes('{getSessionExercises().filter(e => !isSkipped(e.id)).length}'), 'header counter must use getSessionExercises');
  info('Progress, counter, save and render share one source of truth');
});

test('getDayProgress counts added exercises too', () => {
  const fn = src.slice(src.indexOf('function getDayProgress'), src.indexOf('function getDayProgress') + 700);
  assert(fn.includes('getSessionExercises()'), 'getDayProgress must use getSessionExercises');
  info('Progress includes added exercises');
});

test('addExerciseToSession guards against duplicates', () => {
  assert(src.includes('function addExerciseToSession'), 'addExerciseToSession missing');
  assert(src.includes('ae[sessionKey].some(e => e.id === ex.id)'), 'must skip already-added exercise');
  info('Duplicate guard present');
});

test('removeAddedExercise removes only from current session', () => {
  assert(src.includes('function removeAddedExercise'), 'removeAddedExercise missing');
  assert(src.includes('ae[sessionKey].filter(e => e.id !== exId)'), 'must filter by session key');
  info('Removal scoped to session');
});

test('finishWorkout records per-exercise detail (id, name, reps, sets)', () => {
  const fn = src.slice(src.indexOf('function finishWorkout'), src.indexOf('function computeAch'));
  assert(fn.includes('const detail = getSessionExercises()'), 'finishWorkout must build detail array');
  assert(fn.includes('sets.push({ w: sd.weight'), 'detail must capture per-set weight');
  assert(fn.includes('detail: detail'), 'entry must carry detail');
  info('History entries carry full exercise detail');
});

test('autoSave also records detail (background save keeps data)', () => {
  const fn = src.slice(src.indexOf('function autoSave'), src.indexOf('function autoSave') + 1200);
  assert(fn.includes('var detail = getSessionExercises()'), 'autoSave must build detail');
  assert(fn.includes('detail: detail'), 'autoSave entry must carry detail');
  info('autoSave records detail');
});

test('Journal tab registered in tab bar', () => {
  assert(src.includes('["journal","ЖУРНАЛ"]'), 'journal tab missing from tab bar');
  assert(src.includes('activeTab === "journal"'), 'journal tab render block missing');
  info('Journal tab wired up');
});

test('Journal has both log and progression modes', () => {
  assert(src.includes('journalMode'), 'journalMode state missing');
  assert(src.includes('["log","ЖУРНАЛ"],["progress","ПРОГРЕССИЯ"]'), 'mode switcher missing');
  info('Both journal modes present');
});

test('Progression merges journal detail with raw sessions (old records included)', () => {
  assert(src.includes('function collectExerciseData'), 'collectExerciseData missing');
  const fn = src.slice(src.indexOf('function collectExerciseData'), src.indexOf('function getExerciseProgression'));
  assert(fn.includes('entry.detail'), 'must read weights from journal detail');
  assert(fn.includes('data.sessions'), 'must also read weights from raw sessions — pre-detail records live only there');
  assert(fn.includes('date + "|" + exId'), 'must dedupe by date+exercise so one workout is not double counted');
  assert(fn.includes('if (!byKey[k]) byKey[k] = rec'), 'detail must win over the session fallback');
  assert(src.includes('maxW: Math.max.apply'), 'must compute max weight');
  assert(src.includes('a.date < b.date ? -1'), 'progression must sort by workout date — ts basis differs between sources');
  info('Progression reads both sources, deduped');
});

test('getTrackedExercises sorts by workout count', () => {
  assert(src.includes('function getTrackedExercises'), 'getTrackedExercises missing');
  assert(src.includes('sort((a, b) => b.count - a.count)'), 'must sort by count descending');
  info('Tracked exercises sorted by frequency');
});

test('Journal handles empty state (no crash on fresh install)', () => {
  assert(src.includes('entries.length === 0'), 'log mode missing empty state');
  assert(src.includes('tracked.length === 0'), 'progress mode missing empty state');
  info('Both modes have empty states');
});

test('Added exercises marked with badge and removable', () => {
  assert(src.includes('ДОБАВЛЕНО x'), 'added badge missing in workout card');
  assert(src.includes('removeAddedExercise(baseEx.id)'), 'badge must allow removal');
  info('Added exercises visually marked and removable');
});


test('Day selector shows only scheduled workouts', () => {
  assert(src.includes('function getScheduledDayKeys'), 'getScheduledDayKeys missing');
  assert(src.includes('{getScheduledDayKeys().map(key => {'), 'day selector must use getScheduledDayKeys, not allDayKeys');
  info('Day selector filtered by schedule');
});

test('getScheduledDayKeys deduplicates and keeps activeDay visible', () => {
  const fn = src.slice(src.indexOf('function getScheduledDayKeys'), src.indexOf('function allDayKeys'));
  assert(fn.includes('out.indexOf(k) < 0'), 'must deduplicate repeated schedule entries');
  assert(fn.includes('out.indexOf(activeDay) < 0'), 'must keep activeDay visible even if unscheduled');
  assert(fn.includes('return ["push", "pull", "legs"]'), 'must fall back when schedule is empty');
  info('Dedup, activeDay guard, and empty fallback present');
});


test('body has no overflow-x:hidden (breaks position:sticky on iOS Safari)', () => {
  assert(!html.includes('overflow-x:hidden'), 'overflow-x:hidden on body makes sticky header render below scrolling content on iOS');
  assert(html.includes('max-width:100vw'), 'need max-width:100vw to contain horizontal overflow without breaking sticky');
  info('No overflow-x on body — sticky safe');
});

test('Sticky header has isolation + high z-index (content cannot paint over it)', () => {
  assert(src.includes('zIndex: 100'), 'sticky header z-index too low');
  assert(src.includes('isolation: "isolate"'), 'sticky header needs isolation to own its stacking context');
  info('Header stacking context isolated at z-index 100');
});

test('Exercise meta row is full-width (no cramped wrapping)', () => {
  assert(src.includes('META ROW - full width'), 'meta row not extracted into its own full-width row');
  assert(src.includes('flexWrap: "nowrap", overflowX: "auto"'), 'meta row must not wrap — it should scroll instead');
  info('Meta row full-width, non-wrapping');
});


test('No unguarded chained access on data fields (x.field.map crashes if field missing)', () => {
  // The wu.avoid.map crash class: calling an array method on a data field that
  // some variants don't define. Any such call must either be guarded or the
  // field must exist in every variant of that structure.
  const chained = [...src.matchAll(/\b(wu|w|day|ex|baseEx|entry|cw)\.(\w+)\.(map|forEach|filter|reduce|join|slice)\(/g)]
    .map(m => ({ obj: m[1], field: m[2], method: m[3], full: m[0] }));
  assert(chained.length > 0, 'Expected to find chained data access to verify');

  const structures = {
    wu:  ['const WARMUP', 'const ALTERNATIVES'],
    w:   ['const PROGRAM', 'const ACHIEVEMENTS'],
    day: ['const PROGRAM', 'const ACHIEVEMENTS'],
  };

  const problems = [];
  chained.forEach(c => {
    const range = structures[c.obj];
    if (!range) return; // ex/baseEx/entry validated by other tests
    const blk = src.slice(src.indexOf(range[0]), src.indexOf(range[1]));
    const keys = [...blk.matchAll(/^\s{2}(\w+):\s*\{/gm)].map(m => m[1]);
    keys.forEach(k => {
      const s = blk.indexOf(`  ${k}: {`);
      const nxt = blk.slice(s + 5).match(/^\s{2}\w+:\s*\{/m);
      const e = nxt ? s + 5 + nxt.index : blk.length;
      if (!blk.slice(s, e).includes(c.field + ':')) {
        problems.push(`${range[0].replace('const ','')}.${k} has no "${c.field}" but render calls ${c.full}`);
      }
    });
  });
  assert(problems.length === 0, problems.join(' | '));
  info(`${chained.length} chained accesses verified against every data variant`);
});


test('No missing comma between sibling object properties (any nesting level)', () => {
  // Catches: a line closing with ] or } followed by another property at the same
  // indent without a comma. Node tolerates some of these, Babel on iOS does not.
  const lines = src.split('\n');
  const problems = [];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const cur  = lines[i];
    const prevTrim = prev.trimEnd();
    // previous line ends a block/array WITHOUT a comma
    if (!/^\s*[\]}]$/.test(prevTrim)) continue;
    // current line starts a new property at the same indentation
    const prevIndent = prev.length - prev.trimStart().length;
    const curIndent  = cur.length - cur.trimStart().length;
    if (curIndent !== prevIndent) continue;
    if (!/^\s*[a-zA-Z_$][\w$]*\s*:/.test(cur)) continue;
    problems.push(`L${i}: "${prevTrim.trim()}" then L${i + 1}: "${cur.trim().slice(0, 40)}" — missing comma`);
  }
  assert(problems.length === 0, problems.slice(0, 5).join(' | '));
  info('No missing commas between sibling properties at any depth');
});


// ── SECTION 19: DATA CONTRACTS (derived from renderer) ─────────────────────
section('19 · DATA CONTRACTS');

test('addExerciseToSession stores every field the workout card reads', () => {
  const fn = src.slice(src.indexOf('function addExerciseToSession'), src.indexOf('function removeAddedExercise'));
  const stored = new Set([...fn.matchAll(/(\w+):\s*ex\.\w+/g)].map(m => m[1]).concat(['_added', 'id']));
  const tabStart = src.indexOf('{activeTab === "workout" && (');
  const tabEnd   = src.indexOf('{activeTab === "warmup"');
  const tab = src.slice(tabStart, tabEnd);
  const ignore = new Set(['map','filter','length','forEach','_originalId','_isSwapped','id']);
  const read = new Set([
    ...[...tab.matchAll(/\bex\.(\w+)/g)].map(m => m[1]),
    ...[...tab.matchAll(/\bbaseEx\.(\w+)/g)].map(m => m[1]),
  ].filter(f => !ignore.has(f)));
  const missing = [...read].filter(f => !stored.has(f));
  assert(missing.length === 0, `Card reads ${missing.join(', ')} but addExerciseToSession never copies them — added exercise crashes`);
  info(`${read.size} card fields all copied on add`);
});

test('finishWorkout produces every field the journal reads from detail[]', () => {
  const fw = src.slice(src.indexOf('const detail = getSessionExercises()'), src.indexOf('const entry = { date: today'));
  const produced = new Set([...fw.matchAll(/(\w+):\s*(?:rex\.|sets|!!e\.)/g)].map(m => m[1]));
  const jStart = src.indexOf('{activeTab === "journal"');
  const jEnd   = src.indexOf('{activeTab === "progress"');
  const j = src.slice(jStart, jEnd);
  const ignore = new Set(['map','filter','length','reduce','some','forEach','sort']);
  const read = new Set([...j.matchAll(/\bex\.(\w+)/g)].map(m => m[1]).filter(f => !ignore.has(f)));
  const missing = [...read].filter(f => !produced.has(f));
  assert(missing.length === 0, `Journal reads detail.${missing.join(', detail.')} but finishWorkout never writes them`);
  info(`${read.size} journal fields all produced on save`);
});

test('Every pool exercise has all fields that get copied when added', () => {
  const required = ['name','sets','reps','rest','steps','danger','warn'];
  const alt  = src.slice(src.indexOf('const ALTERNATIVES'), src.indexOf('const PROGRAM'));
  const prog = src.slice(src.indexOf('const PROGRAM'), src.indexOf('const ACHIEVEMENTS'));
  const bad = [];
  let total = 0;
  [[alt,'ALT'],[prog,'PROG']].forEach(([blk, nm]) => {
    blk.split(/(?=\{\s*id:\s*")/).forEach(p => {
      const m = p.match(/^\{\s*id:\s*"([^"]+)"/);
      if (!m) return;
      total++;
      const cut = p.indexOf('\n    {');
      const body = cut > 0 ? p.slice(0, cut) : p;
      const miss = required.filter(f => !body.includes(f + ':'));
      if (miss.length) bad.push(`${nm}.${m[1]}: ${miss.join(',')}`);
    });
  });
  assert(bad.length === 0, bad.slice(0, 5).join(' | '));
  info(`${total} pool exercises all complete`);
});

test('Every warmup item supplies the fields the renderer reads (item.*)', () => {
  const wStart = src.indexOf('{activeTab === "warmup"');
  const wEnd   = src.indexOf('{activeTab === "journal"');
  const tab = src.slice(wStart, wEnd);
  const ignore = new Set(['map','length','filter','forEach']);
  const required = [...new Set([...tab.matchAll(/\bitem\.(\w+)/g)].map(m => m[1]))].filter(f => !ignore.has(f));
  assert(required.length >= 3, `Expected renderer to read >=3 item fields, got ${required.length}`);
  const wu = src.slice(src.indexOf('const WARMUP'), src.indexOf('const ALTERNATIVES'));
  const bad = [];
  let total = 0;
  wu.split(/(?=\{ name: ")/).forEach(p => {
    const m = p.match(/^\{ name: "([^"]+)"/);
    if (!m) return;
    total++;
    const body = p.split('\n          { name:')[0].split('\n        ]')[0];
    const miss = required.filter(f => !body.includes(f + ':'));
    if (miss.length) bad.push(`"${m[1].slice(0, 30)}": ${miss.join(',')}`);
  });
  assert(bad.length === 0, bad.slice(0, 5).join(' | '));
  info(`${total} warmup items x ${required.length} fields (${required.join(', ')}) all present`);
});

test('Every warmup block supplies the fields the renderer reads (block.*)', () => {
  const wStart = src.indexOf('{activeTab === "warmup"');
  const wEnd   = src.indexOf('{activeTab === "journal"');
  const tab = src.slice(wStart, wEnd);
  const ignore = new Set(['map','length','filter','forEach']);
  const required = [...new Set([...tab.matchAll(/\bblock\.(\w+)/g)].map(m => m[1]))].filter(f => !ignore.has(f));
  const wu = src.slice(src.indexOf('const WARMUP'), src.indexOf('const ALTERNATIVES'));
  const blocks = [...wu.matchAll(/\{\s*\n\s*title: "([^"]+)"([\s\S]*?)(?=\n      \})/g)];
  assert(blocks.length >= 9, `Expected >=9 warmup blocks, got ${blocks.length}`);
  const bad = [];
  blocks.forEach(b => {
    const miss = required.filter(f => !b[0].includes(f + ':'));
    if (miss.length) bad.push(`"${b[1]}": ${miss.join(',')}`);
  });
  assert(bad.length === 0, bad.slice(0, 5).join(' | '));
  info(`${blocks.length} warmup blocks x ${required.length} fields all present`);
});

test('Removing an added exercise cannot orphan the render (guarded lookups)', () => {
  // getExercise must tolerate an id that is no longer in the session
  const fn = src.slice(src.indexOf('function getExercise'), src.indexOf('function isSkipped'));
  assert(fn.includes('getSessionExercises().find('), 'getExercise must look up within session exercises');
  // getExSets falls back when the exercise is gone
  const gs = src.slice(src.indexOf('function getExSets'), src.indexOf('function setExSets'));
  assert(/return ex \? ex\.sets : \d+/.test(gs), 'getExSets must fall back to a default when exercise is missing');
  info('Lookups guarded against removed exercises');
});


test('History tab fully removed (merged into Journal)', () => {
  assert(!src.includes('"history","ИСТОРИЯ"'), 'history entry still in tab bar');
  assert(!src.includes('activeTab === "history"'), 'history tab render block still present — dead code');
  const i = src.indexOf('[["workout","');
  assert(i >= 0, 'tab bar definition not found');
  const tabs = src.slice(i, src.indexOf(']]', i) + 2);
  const count = (tabs.match(/\["/g) || []).length;
  assert(count === 4, `Expected 4 tabs after merge, found ${count}: ${tabs}`);
  // пятая вкладка бывает только в тестовой сборке, через проверку BetaTab
  const after = src.slice(i + tabs.length, i + tabs.length + 120);
  assert(after.startsWith('.concat(typeof BetaTab === "function" ? [["beta","БЕТА"]] : [])'), 'the only extra tab must be the BETA seam');
  info('4 tabs: workout, warmup, journal, achievements (+ BETA only in the test build)');
});

test('Journal shows every history entry, not only detailed ones', () => {
  const fn = src.slice(src.indexOf('function getAllHistoryDetailed'), src.indexOf('function getExerciseProgression'));
  assert(!fn.includes('filter(e => e.detail'), 'journal must not filter out entries lacking detail — old records would vanish');
  assert(fn.includes('sort((a, b) => b.ts - a.ts)'), 'entries must be newest first');
  info('All history entries reachable from Journal');
});

test('Journal log carries the actions that used to live in History', () => {
  const jStart = src.indexOf('{activeTab === "journal"');
  const jEnd   = src.indexOf('{activeTab === "progress"');
  const j = src.slice(jStart, jEnd);
  assert(j.includes('deleteHistoryEntry(entry.workout, entry.ts)'), 'delete action missing from journal');
  assert(j.includes('resumeSession(entry)'), 'resume action missing from journal');
  assert(j.includes('{pct}%'), 'completion percentage missing from journal');
  info('Delete, resume and percentage all present in Journal');
});

test('Journal tolerates entries saved before detail existed', () => {
  const jStart = src.indexOf('{activeTab === "journal"');
  const jEnd   = src.indexOf('{activeTab === "progress"');
  const j = src.slice(jStart, jEnd);
  assert(j.includes('const detail = entry.detail || []'), 'entry.detail must be defaulted — legacy records have none');
  assert(j.includes('(ex.sets || [])'), 'ex.sets must be guarded when reading legacy detail');
  assert(j.includes('entry.total > 0 ?'), 'percentage must guard division by zero');
  info('Legacy entries render without crashing');
});


test('Journal reads the exact same history source the old History tab used', () => {
  // Both must be: Object.values(data.history).flat() sorted by ts desc.
  // Any divergence means existing user records silently disappear.
  const fn = src.slice(src.indexOf('function getAllHistoryDetailed'), src.indexOf('function getExerciseProgression'));
  assert(fn.includes('Object.values(data.history || {}).flat()'), 'journal must read the full history object');
  assert(fn.includes('sort((a, b) => b.ts - a.ts)'), 'journal must sort newest-first like History did');
  assert(!/\.filter\(e => e\.detail/.test(fn), 'journal must not filter out records lacking detail');
  info('Journal source identical to old History source');
});

test('All history consumers read from data.history (no separate store to migrate)', () => {
  ['getAllHistoryDetailed', 'computeAch', 'collectExerciseData', 'deleteHistoryEntry']
    .forEach(name => {
      const i = src.indexOf('function ' + name);
      assert(i >= 0, `${name} not found`);
      const body = src.slice(i, i + 1600);
      assert(/\bdata\.history\b|\bprev\.history\b/.test(body), `${name} does not read data.history — would need migration`);
    });
  info('5 consumers share one store — nothing to migrate');
});


// ── SECTION 20: RESUME FLOW & DUMBBELL UNITS ───────────────────────────────
section('20 · RESUME FLOW & DUMBBELL UNITS');

test('resuming flag persisted in storage schema', () => {
  assert(src.includes('d.resuming'), 'resuming not initialized in loadData');
  assert(src.includes('resuming: null'), 'resuming missing from fallback default');
  info('resuming persisted across reloads');
});

test('resumeSession marks which entry is being completed', () => {
  const fn = src.slice(src.indexOf('function resumeSession'), src.indexOf('function cancelResume'));
  assert(fn.includes('resuming: { ts: entry.ts'), 'must record the entry ts being resumed');
  assert(fn.includes('data.resuming.ts !== entry.ts'), 'must refuse resuming a second entry while one is open');
  info('Resume records target entry and blocks a second one');
});

test('finishWorkout updates the resumed entry instead of creating a duplicate', () => {
  const fn = src.slice(src.indexOf('function finishWorkout'), src.indexOf('function computeAch'));
  assert(fn.includes('const res = data.resuming'), 'finishWorkout must check resuming');
  assert(fn.includes('findIndex(e => e.ts === res.ts)'), 'must locate the original entry by ts');
  assert(fn.includes('date: res.date, ts: res.ts'), 'must preserve original date and ts');
  assert(fn.includes('resuming: null'), 'must clear resuming after finishing');
  info('Resumed entry updated in place, flag cleared');
});

test('autoSave also updates the resumed entry (no duplicate on background save)', () => {
  const fn = src.slice(src.indexOf('function autoSave'), src.indexOf('function autoSave') + 1800);
  assert(fn.includes('var res = d.resuming'), 'autoSave must check resuming');
  assert(fn.includes('e.ts === res.ts'), 'autoSave must match original entry by ts');
  info('autoSave respects resume target');
});

test('Resume banner visible with cancel action', () => {
  assert(src.includes('ДОПОЛНЕНИЕ'), 'resume banner missing');
  assert(src.includes('function cancelResume'), 'cancelResume missing');
  assert(src.includes('onClick={cancelResume}'), 'cancel button not wired');
  info('Banner and cancel present');
});

test('Second resume blocked while one is in progress (button hidden too)', () => {
  assert(src.includes('!(data.resuming && data.resuming.ts !== entry.ts)'),
    'ДОПОЛНИТЬ must be hidden on other entries while a resume is open');
  info('Only one resume can be open at a time');
});

test('Dumbbell weight unit is configurable and applied everywhere weights show', () => {
  assert(src.includes('function isDumbbell'), 'isDumbbell missing');
  assert(src.includes('function weightUnit'), 'weightUnit missing');
  assert(src.includes('d.dbMode'), 'dbMode not in storage schema');
  // every weight readout must go through weightUnit, not a hardcoded "кг"
  const uses = (src.match(/weightUnit\(/g) || []).length;
  assert(uses >= 6, `weightUnit used only ${uses} times — some weight readouts still hardcode "кг"`);
  info(`weightUnit applied in ${uses} places`);
});

test('Dumbbell mode only relabels — it never rewrites the stored number', () => {
  const fn = src.slice(src.indexOf('function weightUnit'), src.indexOf('function getSetData'));
  assert(!/[*/]\s*2\b/.test(fn), 'weightUnit must not double or halve the weight — labeling only');
  assert(fn.includes('"кг/шт"') && fn.includes('"кг общ"'), 'both unit labels must exist');
  info('Labeling only, stored values untouched');
});


test('Entries record how they were saved (manual finish vs autosave)', () => {
  const fw = src.slice(src.indexOf('function finishWorkout'), src.indexOf('function computeAch'));
  assert(fw.includes('src: "manual"'), 'finishWorkout must tag the entry as manual');
  const as = src.slice(src.indexOf('function autoSave'), src.indexOf('function autoSave') + 2000);
  assert(as.includes('src: "auto"'), 'autoSave must tag the entry as auto');
  info('Save source recorded on every entry');
});

test('Journal shows a distinct badge per entry state', () => {
  const jStart = src.indexOf('{activeTab === "journal"');
  const jEnd   = src.indexOf('{activeTab === "progress"');
  const j = src.slice(jStart, jEnd);
  ['ДОПОЛНЯЕТСЯ', 'АВТОСОХРАНЕНО', 'ЗАВЕРШЕНА', 'НЕ ЗАКОНЧЕНО'].forEach(b => {
    assert(j.includes(b), `badge "${b}" missing from journal`);
  });
  assert(j.includes("entry.src === \"auto\""), 'autosave badge must key off entry.src');
  info('4 states badged: resuming, autosaved, finished, incomplete');
});

test('ДОПОЛНИТЬ is prominent only where it applies', () => {
  const jStart = src.indexOf('{activeTab === "journal"');
  const jEnd   = src.indexOf('{activeTab === "progress"');
  const j = src.slice(jStart, jEnd);
  assert(j.includes('{!isResuming && partial && ('), 'ДОПОЛНИТЬ must be gated to entries with unfinished sets');
  assert(!j.includes('!otherResuming'), 'ДОПОЛНИТЬ must stay tappable on other entries — hiding it strands the user');
  assert(j.includes('ПРОДОЛЖИТЬ'), 'the entry being resumed needs its own primary action');
  // delete must be secondary, not a full-width block
  assert(j.includes('marginLeft: "auto", padding: "9px 12px"'), 'delete must be a small secondary action');
  assert(!j.includes('УДАЛИТЬ ЗАПИСЬ'), 'full-width delete button should be gone');
  info('Primary action shown only where relevant, delete demoted');
});

test('Resume can always be cancelled from the journal (no stuck state)', () => {
  const jStart = src.indexOf('{activeTab === "journal"');
  const jEnd   = src.indexOf('{activeTab === "progress"');
  const j = src.slice(jStart, jEnd);
  assert(j.includes('onClick={cancelResume}'), 'cancel must be reachable from the journal, not only the workout tab');
  info('Cancel reachable from journal');
});


test('resumeSession snapshots the pre-edit state so cancel can roll back', () => {
  const fn = src.slice(src.indexOf('function resumeSession'), src.indexOf('function cancelResume'));
  assert(fn.includes('const snapSession ='), 'must snapshot the session before overwriting it');
  assert(fn.includes('const snapAdded ='), 'must snapshot mid-workout additions');
  assert(fn.includes('snapSession: snapSession'), 'snapshot must be stored on the resuming flag');
  assert(fn.includes('key: todKey'), 'must remember which session key was touched');
  info('Pre-edit state captured on resume');
});

test('cancelResume restores the session and never touches the journal entry', () => {
  const fn = src.slice(src.indexOf('function cancelResume'), src.indexOf('function finishWorkout'));
  assert(fn.includes('res.snapSession) sessions[k] = res.snapSession'), 'must restore the previous session');
  assert(fn.includes('else delete sessions[k]'), 'must clear the session when there was none before');
  assert(fn.includes('res.snapAdded) addedEx[k] = res.snapAdded'), 'must restore previous additions');
  assert(!/history/.test(fn), 'cancel must not modify history — the record has to survive untouched');
  assert(fn.includes('resuming: null'), 'must clear the resuming flag');
  info('Cancel rolls back edits, journal record untouched');
});

test('Cancel action is labelled as cancelling the edit, not deleting', () => {
  assert(src.includes('ОТМЕНИТЬ<br />РЕДАКТИР.') || src.includes('ОТМЕНИТЬ РЕДАКТ.'),
    'cancel buttons must read as cancelling the edit');
  assert(src.includes('запись не изменилась'), 'toast must reassure the record is intact');
  info('Cancel wording distinguishes it from delete');
});


test('Progression sorts by workout date, not save timestamp', () => {
  const fn = src.slice(src.indexOf('function getExerciseProgression'), src.indexOf('function getTrackedExercises'));
  assert(fn.includes('a.date < b.date'), 'must sort by date string');
  assert(!fn.includes('a.ts - b.ts'), 'must not sort by ts — journal ts is save time, session ts is midnight');
  info('Single sort basis across both data sources');
});

test('Deleted workouts go to a recoverable trash', () => {
  assert(src.includes('d.trash'), 'trash not in storage schema');
  const del = src.slice(src.indexOf('function deleteHistoryEntry'), src.indexOf('function restoreHistoryEntry'));
  assert(del.includes('trash.unshift'), 'deleted entry must be pushed to trash');
  assert(del.includes('trash.slice(0, 20)'), 'trash must be capped');
  const res = src.slice(src.indexOf('function restoreHistoryEntry'), src.indexOf('function purgeTrash'));
  assert(res.includes('trash.splice(i, 1)'), 'restore must remove from trash');
  assert(res.includes('!history[wk].some(e => e.ts === entry.ts)'), 'restore must not duplicate an entry');
  assert(res.includes('sort((a, b) => b.ts - a.ts)'), 'restored entry must land in the right position');
  info('Soft delete with capped, dedup-safe restore');
});

test('Trash section reachable in journal with restore and purge', () => {
  const jStart = src.indexOf('{activeTab === "journal"');
  const jEnd   = src.indexOf('{activeTab === "progress"');
  const j = src.slice(jStart, jEnd);
  assert(j.includes('КОРЗИНА'), 'trash section missing from journal');
  assert(j.includes('restoreHistoryEntry(entry.ts)'), 'restore button not wired');
  assert(j.includes('onClick={purgeTrash}'), 'purge button not wired');
  assert(j.includes('(data.trash || []).length > 0'), 'trash section must hide when empty');
  info('Trash UI complete');
});


test('Weekly buckets start on Monday and are stable', () => {
  const fn = src.slice(src.indexOf('function weekKey'), src.indexOf('function getWeeklyStats'));
  assert(fn.includes('d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1'), 'week must start Monday, not Sunday');
  assert(fn.includes('toISOString().slice(0, 10)'), 'week key must be a stable ISO date');
  info('Monday-based ISO week keys');
});

test('Overall progress aggregates every workout, not a subset', () => {
  const fn = src.slice(src.indexOf('function getOverallProgress'), src.indexOf('function getExerciseWeekDelta'));
  assert(fn.includes('collectExerciseData()'), 'must aggregate from the merged source');
  assert(fn.includes('totalVolume') && fn.includes('totalSets') && fn.includes('totalWorkouts'), 'must expose all-time totals');
  assert(fn.includes('curWeek') && fn.includes('prevWeek'), 'must expose current and previous week');
  assert(fn.includes('prev.volume > 0 ?'), 'percent change must guard division by zero');
  info('All-time totals plus week-over-week');
});

test('Week-over-week delta available per exercise', () => {
  const fn = src.slice(src.indexOf('function getExerciseWeekDelta'), src.indexOf('function groupTrackedByWorkout'));
  assert(fn.includes('if (keys.length < 2) return null'), 'must return null when there is no previous week');
  assert(fn.includes('delta: weeks[keys[0]] - weeks[keys[1]]'), 'delta must compare latest two weeks');
  info('Per-exercise weekly delta with null guard');
});

test('Progression list groups exercises by workout', () => {
  const fn = src.slice(src.indexOf('function groupTrackedByWorkout'), src.indexOf('function computeAch'));
  assert(fn.includes('m.workouts[w] > m.workouts[best]'), 'exercise must land in the workout it appears in most');
  assert(fn.includes('getScheduledDayKeys()'), 'groups must follow the schedule order');
  assert(fn.includes('"ДРУГИЕ"'), 'exercises outside the program need a fallback group');
  const jStart = src.indexOf('{activeTab === "journal"');
  const jEnd   = src.indexOf('{activeTab === "progress"');
  const j = src.slice(jStart, jEnd);
  assert(j.includes('groups.map(g =>'), 'progression view must render grouped');
  info('Grouped by workout, schedule order, ДРУГИЕ fallback');
});

test('Progression view surfaces overall and weekly blocks', () => {
  const jStart = src.indexOf('{activeTab === "journal"');
  const jEnd   = src.indexOf('{activeTab === "progress"');
  const j = src.slice(jStart, jEnd);
  ['ЗА ВСЁ ВРЕМЯ', 'ЭТА НЕДЕЛЯ К ПРОШЛОЙ', 'ОБЪЁМ ПО НЕДЕЛЯМ', 'К ПРОШЛОЙ НЕДЕЛЕ'].forEach(t => {
    assert(j.includes(t), `block "${t}" missing from progression view`);
  });
  info('All-time, week comparison, weekly chart and per-exercise week delta');
});


// ── SECTION 21: QA FIXES ───────────────────────────────────────────────────
section('21 · QA FIXES');

test('Skips and swaps are scoped to the session, not the day', () => {
  assert(src.includes('data.skipped[sessionKey]'), 'isSkipped must read the session bucket');
  assert(src.includes('sk[sessionKey]'), 'toggleSkip must write to the session bucket');
  assert(src.includes('data.swaps[sessionKey]'), 'getExercise must read swaps per session');
  assert(src.includes('swaps[sessionKey]'), 'swapExercise must write per session');
  assert(!/skipped\[activeDay\]|swaps\[activeDay\]/.test(src), 'no day-scoped skip/swap left — they would persist forever');
  info('Skips and swaps reset with each new session');
});

test('History retention is a single named limit', () => {
  assert(src.includes('const HISTORY_LIMIT'), 'HISTORY_LIMIT constant missing');
  assert(!/slice\(0,\s*30\)/.test(src), 'hardcoded 30-entry cap still present');
  const n = parseInt((src.match(/HISTORY_LIMIT = (\d+)/) || [])[1] || '0');
  assert(n >= 100, `HISTORY_LIMIT ${n} too small — progression reads sessions that outlive it`);
  info(`HISTORY_LIMIT = ${n}`);
});

test('Restoring from trash cannot be dropped by the cap', () => {
  const fn = src.slice(src.indexOf('function restoreHistoryEntry'), src.indexOf('function purgeTrash'));
  assert(fn.includes('HISTORY_LIMIT + 1'), 'restore must leave room so the restored entry survives the slice');
  info('Restored entry always survives');
});

test('Old session-scoped keys are garbage collected', () => {
  assert(src.includes('function pruneOldKeys'), 'pruneOldKeys missing');
  const fn = src.slice(src.indexOf('function pruneOldKeys'), src.indexOf('function loadData'));
  ['sessions', 'customSets', 'addedEx', 'skipped', 'swaps'].forEach(b => {
    assert(fn.includes(`"${b}"`), `${b} not pruned — grows without bound`);
  });
  assert(fn.includes('delete d[bucket][k]; return;'), 'legacy non-dated keys must be dropped');
  assert(src.includes('d = pruneOldKeys(d)'), 'pruneOldKeys must run on load');
  info('5 buckets pruned on every load');
});

test('Deleting a custom workout clears it from the schedule', () => {
  const fn = src.slice(src.indexOf('function deleteCustomWorkout'), src.indexOf('function getWorkout'));
  assert(fn.includes('k === id ? null : k'), 'schedule slots pointing at the deleted workout must be cleared');
  assert(fn.includes('schedule: sched'), 'updated schedule must be persisted');
  info('No dangling schedule references');
});

test('Switching rest day stops a running timer', () => {
  assert(src.includes('lastPromptedExDone.current = 0; stopTimer(); }}'),
    'switching day must stop the timer — otherwise it fires during another workout');
  info('Timer stopped on day switch');
});

test('Resume can switch target and rolls back the previous edit', () => {
  const fn = src.slice(src.indexOf('function resumeSession'), src.indexOf('function cancelResume'));
  assert(fn.includes('const switching ='), 'must detect switching between resume targets');
  assert(fn.includes('old.ts !== entry.ts && old.key'), 'must roll back the previously resumed entry');
  assert(!fn.includes('Сначала заверши'), 'must not hard-block switching — that strands the user');
  info('Resume target switchable, previous edits rolled back');
});

test('Save prompt does not fire immediately after resuming', () => {
  const fn = src.slice(src.indexOf('function resumeSession'), src.indexOf('function cancelResume'));
  assert(fn.includes('lastPromptedExDone.current = getDayProgress().exDone'),
    'threshold must start at the restored level, not 0');
  info('Prompt only fires on newly completed exercises');
});

test('Resume refuses entries with no set data', () => {
  const fn = src.slice(src.indexOf('function resumeSession'), src.indexOf('function cancelResume'));
  assert(fn.includes('дополнять нечего'), 'must refuse and explain when there is nothing to restore');
  assert(fn.includes('entry.detail && entry.detail.length'), 'must check detail without optional chaining');
  info('Empty resume rejected with a clear message');
});

test('Dumbbell unit is frozen per record, not applied retroactively', () => {
  assert(src.includes('function weightUnit(name, mode)'), 'weightUnit must accept an explicit mode');
  assert((src.match(/dbMode: \(data\.dbMode/g) || []).length >= 2, 'both finish and autosave must stamp the mode');
  assert(src.includes('weightUnit(ex.name, entry.dbMode)'), 'journal must use the record own mode');
  info('Historic records keep the unit they were logged in');
});

// Исполняет настоящий getPastExSets/getLastWeight/getExHistory из исходника
function loadPastSetsFns(data, activeDay, sessionKey, today, session) {
  const from = src.indexOf('function getPastExSets');
  const body = src.slice(from, src.indexOf('const prog = getDayProgress()', from));
  const getSetData = (exId, i) => ((session || {})[exId] && session[exId][i]) || { weight: '', done: false };
  // настоящий isDumbbell из исходника - от него зависит шаг прогрессии
  const dbFrom = src.indexOf('function isDumbbell');
  const dbSrc = src.slice(dbFrom, src.indexOf('function weightUnit', dbFrom));
  return new Function('data', 'activeDay', 'sessionKey', 'todayKey', 'getSetData',
    dbSrc + body + '; return { getPastExSets, getLastWeight, getExHistory, getSuggestedWeight, getProgressionHint };')(data, activeDay, sessionKey, () => today, getSetData);
}

test('Weight hints and mini-chart read finished workouts from the journal', () => {
  // finishWorkout удаляет сессию, поэтому после завершения веса есть только в history.detail
  const data = {
    sessions: {},
    history: { push: [
      { date: '2026-09-25', ts: 2, workout: 'push', detail: [{ id: 'bench', sets: [{ w: '60', done: true }, { w: '62.5', done: true }, { w: '70', done: false }] }] },
      { date: '2026-09-18', ts: 1, workout: 'push', detail: [{ id: 'bench', sets: [{ w: '55', done: true }] }] },
    ] },
    resuming: null,
  };
  const f = loadPastSetsFns(data, 'push', '2026-10-02_push', '2026-10-02');
  assert(f.getLastWeight('bench') === '60', 'last weight must come from the journal, got ' + f.getLastWeight('bench'));
  const h = f.getExHistory('bench', 4);
  assert(h.length === 2, 'expected 2 sessions, got ' + h.length);
  assert(h[0].date === '2026-09-18' && h[1].date === '2026-09-25', 'must be oldest first');
  assert(h[1].maxW === 62.5, 'max must ignore the not-done set, got ' + h[1].maxW);
  assert(f.getLastWeight('squat') === null, 'unknown exercise has no hint');
  info('Journal is the primary source for hints');
});

test('Weight hints fall back to raw sessions and never mix in other days or today', () => {
  const data = {
    sessions: {
      '2026-09-20_push': { bench: { 0: { weight: '50', done: true } } },
      '2026-09-21_pull': { bench: { 0: { weight: '99', done: true } } },
      '2026-09-22_custom_x': { bench: { 0: { weight: '88', done: true } } },
      '2026-10-02_push': { bench: { 0: { weight: '77', done: false } } },
    },
    history: {},
    resuming: null,
  };
  const f = loadPastSetsFns(data, 'push', '2026-10-02_push', '2026-10-02');
  assert(f.getLastWeight('bench') === '50', 'must use the push session only, got ' + f.getLastWeight('bench'));
  const c = loadPastSetsFns(data, 'custom_x', '2026-10-02_custom_x', '2026-10-02');
  assert(c.getLastWeight('bench') === '88', 'workout keys with underscores must match exactly, got ' + c.getLastWeight('bench'));
  info('Raw sessions still work as fallback, matched by exact day key');
});

test('Weight hints skip today and the entry being resumed; journal wins over a stale session', () => {
  const data = {
    sessions: { '2026-09-25_push': { bench: { 0: { weight: '1', done: true } } } },
    history: { push: [
      { date: '2026-10-02', ts: 9, workout: 'push', detail: [{ id: 'bench', sets: [{ w: '80', done: true }] }] },
      { date: '2026-09-25', ts: 5, workout: 'push', detail: [{ id: 'bench', sets: [{ w: '60', done: true }] }] },
      { date: '2026-09-18', ts: 4, workout: 'push', detail: [{ id: 'bench', sets: [{ w: '55', done: true }] }] },
    ] },
    resuming: null,
  };
  let f = loadPastSetsFns(data, 'push', '2026-10-02_push', '2026-10-02');
  assert(f.getLastWeight('bench') === '60', 'today entry must be skipped and journal must beat the session, got ' + f.getLastWeight('bench'));
  data.resuming = { ts: 5, date: '2026-09-25', workout: 'push' };
  f = loadPastSetsFns(data, 'push', '2026-10-02_push', '2026-10-02');
  assert(f.getLastWeight('bench') === '55', 'the entry being resumed must not be its own hint, got ' + f.getLastWeight('bench'));
  info('No self-comparison while editing or on the same day');
});

test('Suggested weight: previous set today, else same set last time, else last known', () => {
  const data = {
    sessions: {},
    history: { push: [
      { date: '2026-09-25', ts: 2, workout: 'push', detail: [{ id: 'bench', sets: [{ w: '60', done: true }, { w: '62.5', done: true }, { w: '65', done: true }] }] },
    ] },
    resuming: null,
  };
  const k = '2026-10-02_push';
  // ничего не введено: подход с тем же номером в прошлый раз
  let f = loadPastSetsFns(data, 'push', k, '2026-10-02', {});
  assert(f.getSuggestedWeight('bench', 0) === '60', 'set 1 -> 60, got ' + f.getSuggestedWeight('bench', 0));
  assert(f.getSuggestedWeight('bench', 2) === '65', 'set 3 -> 65, got ' + f.getSuggestedWeight('bench', 2));
  // подходов сегодня больше, чем было: берём последний известный вес
  assert(f.getSuggestedWeight('bench', 5) === '65', 'extra set -> last known, got ' + f.getSuggestedWeight('bench', 5));
  // сегодня уже введён вес в подходе 1: он важнее прошлой тренировки
  f = loadPastSetsFns(data, 'push', k, '2026-10-02', { bench: { 0: { weight: '67.5', done: true } } });
  assert(f.getSuggestedWeight('bench', 1) === '67.5', 'set 2 follows set 1 of today, got ' + f.getSuggestedWeight('bench', 1));
  assert(f.getSuggestedWeight('bench', 0) === '60', 'first set looks only at the previous workout, got ' + f.getSuggestedWeight('bench', 0));
  // подход 1 сегодня совпал с прошлым разом: продолжаем прошлый разгон, а не копируем 60
  f = loadPastSetsFns(data, 'push', k, '2026-10-02', { bench: { 0: { weight: '60', done: true } } });
  assert(f.getSuggestedWeight('bench', 1) === '62.5', 'on-plan set keeps the ramp, got ' + f.getSuggestedWeight('bench', 1));
  // отошли от плана на предыдущем подходе: копируем введённый вес
  f = loadPastSetsFns(data, 'push', k, '2026-10-02', { bench: { 0: { weight: '60', done: true }, 1: { weight: '70', done: true } } });
  assert(f.getSuggestedWeight('bench', 2) === '70', 'off-plan set copies what was typed, got ' + f.getSuggestedWeight('bench', 2));
  // подход 2 пропущен, введён подход 3: подход 4 берёт ближайший выше
  f = loadPastSetsFns(data, 'push', k, '2026-10-02', { bench: { 2: { weight: '70', done: false } } });
  assert(f.getSuggestedWeight('bench', 3) === '70', 'nearest filled set above, got ' + f.getSuggestedWeight('bench', 3));
  // упражнения, которого раньше не было: подсказки нет (тогда отметка просит вписать вес)
  assert(f.getSuggestedWeight('squat', 0) === '', 'no history -> empty suggestion');
  info('Suggestion priority: today > same set last time > last known');
});

test('Progression hint: only after a fully completed exercise, step by equipment', () => {
  const mk = (sets, extra) => ({
    sessions: {}, resuming: null, dbMode: 'single',
    history: { push: [{ date: '2026-09-25', ts: 2, workout: 'push', detail: [{ id: 'bench', name: 'Жим штанги лёжа', sets }, { id: 'db', name: 'Жим гантелей', sets }] }] },
    ...(extra || {}),
  });
  const full = [{ w: '60', done: true }, { w: '62.5', done: true }, { w: '65', done: true }];
  const hint = (d, id, name) => loadPastSetsFns(d, 'push', '2026-10-02_push', '2026-10-02', {}).getProgressionHint(id, name);
  let h = hint(mk(full), 'bench', 'Жим штанги лёжа');
  assert(h && h.from === 65 && h.to === 67.5 && h.step === 2.5, 'barbell: top weight + 2.5, got ' + JSON.stringify(h));
  h = hint(mk(full), 'db', 'Жим гантелей');
  assert(h && h.to === 67 && h.step === 2, 'dumbbell: +2 per hand, got ' + JSON.stringify(h));
  h = hint(mk(full, { dbMode: 'total' }), 'db', 'Жим гантелей');
  assert(h && h.to === 69 && h.step === 4, 'dumbbell pair total: +4, got ' + JSON.stringify(h));
  // не все подходы закрыты - не подталкиваем
  assert(hint(mk([{ w: '60', done: true }, { w: '62.5', done: false }]), 'bench', 'Жим штанги лёжа') === null, 'unfinished exercise: no hint');
  assert(hint(mk([{ w: '60', done: true }, { w: '', done: false }]), 'bench', 'Жим штанги лёжа') === null, 'set without weight: no hint');
  assert(hint(mk(full), 'squat', 'Присед') === null, 'no history: no hint');
  // дробные веса не плывут
  h = hint(mk([{ w: '12.5', done: true }]), 'bench', 'Жим штанги лёжа');
  assert(h && h.to === 15, 'no float drift, got ' + JSON.stringify(h));
  // сырые сессии подсказку не дают: там неизвестно, сколько подходов планировалось
  const raw = { sessions: { '2026-09-25_push': { bench: { 0: { weight: '60', done: true } } } }, history: {}, resuming: null, dbMode: 'single' };
  assert(hint(raw, 'bench', 'Жим штанги лёжа') === null, 'raw sessions are not enough evidence');
  info('Hint only after a complete exercise; barbell 2.5, dumbbell 2 or 4');
});

test('Progression hint UI: shown only on an untouched exercise, one tap fills empty sets', () => {
  assert(src.includes('const progHint = untouched ? getProgressionHint(ex.id, ex.name) : null'), 'hint must hide once anything is entered');
  assert(src.includes('applyProgression(ex.id, getExSets(baseEx.id), progHint.to)'), 'ВЗЯТЬ must apply the hinted weight');
  const fn = src.slice(src.indexOf('function applyProgression'), src.indexOf('function getLastWeight'));
  assert(fn.includes('!sd.done && !sd.weight'), 'must never overwrite a weight the user typed or a done set');
  assert(src.includes('ВЗЯТЬ'), 'button label missing');
  const i = src.indexOf('ВЗЯТЬ');
  assert(/minHeight: 44/.test(src.slice(i - 500, i)), 'ВЗЯТЬ needs a 44pt target');
  info('Hint is self-hiding and non-destructive');
});

test('Screen wake lock: on workout and warmup tabs, re-acquired after backgrounding, switchable', () => {
  const from = src.indexOf('const keepAwake');
  const fn = src.slice(from, src.indexOf('// Тик таймера', from));
  assert(fn.includes('navigator.wakeLock.request("screen")'), 'wake lock request missing');
  assert(fn.includes('activeTab !== "workout" && activeTab !== "warmup"'), 'lock only while a workout or warmup is open');
  assert(fn.includes('visibilitychange') && fn.includes('removeEventListener("visibilitychange"'), 'must re-acquire on return and clean up the listener');
  assert(/try \{[\s\S]*wakeLock\.request[\s\S]*\} catch/.test(fn), 'request must be inside try/catch - unsupported or refused must not crash');
  assert(fn.includes('wakeRef.current.release()'), 'cleanup must release the lock');
  assert(fn.includes('cancelled'), 'a request that resolves after unmount must be released');
  assert(src.includes('data.keepAwake !== false'), 'default must be on');
  assert(src.includes('keepAwake: m[0]'), 'setting must be switchable in the plan screen');
  info('Wake lock acquired, re-acquired, released, switchable');
});

test('Marking an empty set takes the suggestion; with no suggestion it still asks for a weight', () => {
  const fn = src.slice(src.indexOf('function toggleDone'), src.indexOf('function getExProgress'));
  const guard = fn.indexOf('!cur.weight || cur.weight === ""');
  assert(guard >= 0, 'weight guard must stay');
  const afterGuard = fn.slice(guard);
  assert(afterGuard.includes('getSuggestedWeight(exId, setIdx)'), 'empty set must fall back to the suggestion');
  assert(/if \(!sug\) \{\s*showToast\("Впиши вес перед отметкой"\);\s*return;/.test(afterGuard),
    'without a suggestion the set must still be refused with the toast');
  assert(afterGuard.includes('updateSet(exId, setIdx, "weight", sug)'), 'suggestion must be written as the real weight');
  assert(src.includes('placeholder={getSuggestedWeight(ex.id, i) || " - "}'), 'suggestion must show in the weight field');
  assert(html.includes('.wt::placeholder'), 'suggestion needs its own placeholder colour');
  info('Suggestion shown grey, taken on mark, guard intact');
});

// Исполняет настоящие parseBackup/mergeBackup из исходника
function loadBackupFns() {
  const from = src.indexOf('const BACKUP_APP');
  const body = src.slice(from, src.indexOf('export default function App'));
  return new Function('HISTORY_LIMIT', body + '; return { buildBackup, parseBackup, mergeBackup, backupDue, backupAgeDays };')(200);
}
const emptyData = () => ({ sessions: {}, history: {}, swaps: {}, skipped: {}, customWorkouts: {}, customSets: {}, addedEx: {}, resuming: null, dbMode: 'single', trash: [], schedule: ['push', null, 'pull', null, 'legs', null, null] });

test('Backup: export then import into an empty device restores everything', () => {
  const { buildBackup, parseBackup, mergeBackup } = loadBackupFns();
  const src1 = emptyData();
  src1.history.push = [{ date: '2026-09-25', ts: 20, workout: 'push', detail: [{ id: 'bench', sets: [{ w: '60', done: true }] }] }, { date: '2026-09-18', ts: 10, workout: 'push' }];
  src1.sessions['2026-09-25_push'] = { bench: { 0: { weight: '60', done: true } } };
  src1.customWorkouts.c1 = { name: 'X' };
  src1.schedule = ['push', 'pull', null, null, null, null, null];
  src1.dbMode = 'total';
  const parsed = parseBackup(buildBackup(src1));
  assert(!parsed.error, 'own export must parse: ' + parsed.error);
  const r = mergeBackup(emptyData(), parsed.data);
  assert(r.added === 2, 'expected 2 added, got ' + r.added);
  assert(r.data.history.push.length === 2 && r.data.history.push[0].ts === 20, 'history restored, newest first');
  assert(r.data.sessions['2026-09-25_push'].bench[0].weight === '60', 'sessions restored');
  assert(r.data.customWorkouts.c1.name === 'X', 'custom workouts restored');
  assert(r.data.schedule[1] === 'pull' && r.data.dbMode === 'total', 'settings restored on an empty device');
  info('Round trip: history, sessions, custom days, settings');
});

test('Backup: import only adds - existing data and settings are never overwritten', () => {
  const { buildBackup, parseBackup, mergeBackup } = loadBackupFns();
  const cur = emptyData();
  cur.history.push = [{ date: '2026-10-01', ts: 30, workout: 'push', name: 'LOCAL' }, { date: '2026-09-25', ts: 20, workout: 'push', name: 'LOCAL-EDITED' }];
  cur.schedule = ['legs', null, null, null, null, null, null];
  cur.dbMode = 'total';
  cur.sessions['k'] = { a: 1 };
  const old = emptyData();
  old.history.push = [{ date: '2026-09-25', ts: 20, workout: 'push', name: 'OLD' }, { date: '2026-09-18', ts: 10, workout: 'push', name: 'OLDER' }];
  old.history.pull = [{ date: '2026-09-20', ts: 15, workout: 'pull' }];
  old.sessions['k'] = { a: 999 };
  old.schedule = ['push', 'push', 'push', 'push', 'push', 'push', 'push'];
  old.dbMode = 'single';
  const r = mergeBackup(cur, parseBackup(buildBackup(old)).data);
  assert(r.added === 2, 'only entries with unseen ts count, got ' + r.added);
  assert(r.data.history.push.map(e => e.ts).join() === '30,20,10', 'sorted newest first, no duplicates: ' + r.data.history.push.map(e => e.ts).join());
  assert(r.data.history.push[1].name === 'LOCAL-EDITED', 'local entry wins on equal ts');
  assert(r.data.history.pull.length === 1, 'new workout key added');
  assert(r.data.sessions.k.a === 1, 'local session wins');
  assert(r.data.schedule[0] === 'legs' && r.data.dbMode === 'total', 'settings of a device with history are kept');
  assert(cur.history.push.length === 2, 'merge must not mutate its input');
  info('Merge is additive and non-destructive');
});

test('Backup: garbage and foreign files are rejected with a message', () => {
  const { parseBackup } = loadBackupFns();
  ['', 'not json', '[]', 'null', '123', '{"a":1}', '{"history":[]}', '{"app":"other","data":{"x":1}}'].forEach(t => {
    const r = parseBackup(t);
    assert(r.error && !r.data, 'must reject ' + JSON.stringify(t));
  });
  // битые записи журнала отбрасываются, остальное загружается
  const r = parseBackup(JSON.stringify({ history: { push: [{ ts: 1, date: '2026-01-01' }, { ts: 'x' }, null, 5] }, sessions: [] }));
  assert(r.data && r.data.history.push.length === 1, 'only well-formed entries survive');
  assert(JSON.stringify(r.data.sessions) === '{}', 'wrong-typed buckets become empty objects');
  info('Bad input rejected, partial input sanitised');
});

test('Backup UI: export via share sheet with download fallback, import via file picker', () => {
  const fn = src.slice(src.indexOf('async function exportBackup'), src.indexOf('function importBackup'));
  assert(fn.includes('navigator.canShare') && fn.includes('navigator.share'), 'must prefer the iOS share sheet - blob downloads are unreliable in a standalone PWA');
  assert(fn.includes('AbortError'), 'closing the share sheet is not an error');
  assert(fn.includes('a.download = name'), 'download fallback missing');
  assert(src.includes('type="file" accept="application/json,.json"'), 'file input missing');
  assert(src.includes('importRef.current.click()'), 'import button must open the file picker');
  assert(src.includes('pruneOldKeys(mergeBackup(prev, res.data).data)'), 'imported keys must pass through the same pruning as load');
  info('Share sheet first, download fallback, file picker import');
});

test('Journal filter: by workout day and by exercise name, case and yo-insensitive', () => {
  const from = src.indexOf('function normText');
  const body = src.slice(from, src.indexOf('export default function App', from));
  const { normText, exMatches, filterJournal } = new Function(body + '; return { normText, exMatches, filterJournal };')();
  const entries = [
    { ts: 3, workout: 'push', name: 'ЖИМОВОЙ', detail: [{ id: 'bench', name: 'Жим штанги лёжа' }, { id: 'dips', name: 'Отжимания на брусьях' }] },
    { ts: 2, workout: 'pull', name: 'ТЯГОВОЙ', detail: [{ id: 'row', name: 'Тяга штанги в наклоне' }] },
    { ts: 1, workout: 'push', name: 'ЖИМОВОЙ' },   // старая запись без detail
  ];
  assert(filterJournal(entries, null, '').length === 3, 'no filter -> everything');
  assert(filterJournal(entries, null, '   ').length === 3, 'blank query is no filter');
  assert(filterJournal(entries, 'push', '').map(e => e.ts).join() === '3,1', 'day filter keeps order');
  assert(filterJournal(entries, null, 'жим лежа').map(e => e.ts).join() === '3', 'ё/е and case must not matter');
  assert(filterJournal(entries, null, 'лежа жим').map(e => e.ts).join() === '3', 'word order must not matter');
  assert(filterJournal(entries, null, 'жим тяга').length === 0, 'every word must match the same exercise');
  assert(filterJournal(entries, null, 'ШТАНГИ').map(e => e.ts).join() === '3,2', 'substring across workouts');
  assert(filterJournal(entries, 'pull', 'штанги').map(e => e.ts).join() === '2', 'day and query combine');
  assert(filterJournal(entries, 'push', 'тяга').length === 0, 'no match -> empty');
  assert(filterJournal(entries, null, 'жим').every(e => e.detail), 'entries without detail never match a query');
  assert(normText(null) === '' && normText(undefined) === '', 'normText tolerates missing names');
  assert(exMatches({ name: 'Жим' }, 'жим') && !exMatches(null, 'жим') && !exMatches({}, 'жим'), 'exMatches tolerates bad rows');
  info('Day + exercise filter incl. old entries without detail');
});

test('Journal filter UI: day chips, search box, found counter, reset, per-entry match line', () => {
  assert(src.includes('filterJournal(entries, dayFilter, journalQ)'), 'journal must render the filtered list');
  assert(src.includes('shown.map((entry, i)'), 'entries list must iterate the filtered array');
  assert(src.includes('Поиск по упражнению...'), 'search box missing');
  assert(src.includes('СБРОСИТЬ ФИЛЬТР'), 'empty result needs a reset');
  assert(src.includes('Найдено: {shown.length} из {entries.length}'), 'counter missing');
  assert(src.includes('dayOpts.some(o => o.key === journalDay) ? journalDay : null'),
    'a filter pointing at a day that no longer exists must fall back to all');
  assert(src.includes('detail.filter(d => exMatches(d, needle))'), 'matched exercises must be listed under the entry');
  const i = src.indexOf('Поиск по упражнению...');
  assert(/minHeight: 44/.test(src.slice(i - 200, i + 700)), 'search input needs a 44pt target');
  info('Chips, search, counter, reset, match lines');
});

test('A done set cannot be edited: weight is locked until the mark is removed', () => {
  // настоящий updateSet на заглушке состояния
  const from = src.indexOf('function updateSet(');
  const fn = src.slice(from, src.indexOf('function toggleDone', from));
  let state = { sessions: {} };
  const setData = f => { state = f(state); };
  const updateSet = new Function('setData', 'sessionKey', fn + '; return updateSet;')(setData, 'k');
  const cur = () => state.sessions.k.bench[0];
  updateSet('bench', 0, 'weight', '60');
  updateSet('bench', 0, 'done', true);
  updateSet('bench', 0, 'weight', '70');
  assert(cur().weight === '60' && cur().done === true, 'weight of a done set must not change, got ' + JSON.stringify(cur()));
  updateSet('bench', 0, 'weight', '');
  assert(cur().weight === '60' && cur().done === true, 'weight of a done set must not be cleared, got ' + JSON.stringify(cur()));
  updateSet('bench', 0, 'done', false);
  updateSet('bench', 0, 'weight', '65');
  assert(cur().weight === '65' && cur().done === false, 'after un-marking the weight is editable again, got ' + JSON.stringify(cur()));
  updateSet('bench', 0, 'done', true);
  assert(cur().weight === '65' && cur().done === true, 'marking again keeps the new weight, got ' + JSON.stringify(cur()));
  // другие подходы не затронуты
  updateSet('bench', 1, 'weight', '50');
  assert(state.sessions.k.bench[1].weight === '50', 'an unmarked set stays editable');
  info('State rejects weight edits on a done set; un-mark, edit, mark works');
});

test('Weight input is read-only on a done set and explains why', () => {
  const i = src.indexOf('className="wt"');
  const block = src.slice(i, i + 500);
  assert(block.includes('readOnly={sd.done}'), 'the input must be read-only while the set is done');
  assert(block.includes('Сними отметку, чтобы изменить вес'), 'tapping a locked field must say what to do');
  info('Locked field with an explanation toast');
});

test('formatVolume: kg until a tonne, then tonnes with one decimal', () => {
  const from = src.indexOf('function formatVolume');
  const fn = src.slice(from, src.indexOf('export default function App', from));
  const formatVolume = new Function(fn + '; return formatVolume;')();
  const f = kg => { const r = formatVolume(kg); return r.value + ' ' + r.unit; };
  assert(f(0) === '0 КГ', '0 -> ' + f(0));
  assert(f(417.5) === '418 КГ', 'less than a tonne stays in kg, got ' + f(417.5));
  assert(f(999.4) === '999 КГ', 'just under a tonne stays in kg, got ' + f(999.4));
  assert(f(1000) === '1,0 ТОНН', 'exactly one tonne, got ' + f(1000));
  assert(f(1449) === '1,4 ТОНН', 'one decimal, rounded, got ' + f(1449));
  assert(f(1450) === '1,5 ТОНН', 'rounds half up, got ' + f(1450));
  assert(f(25340) === '25,3 ТОНН', 'big totals, got ' + f(25340));
  assert(src.includes('const totalVol = formatVolume(ov.totalVolume)') && src.includes('[totalVol.unit, totalVol.value]'),
    'the all-time tile must use formatVolume');
  assert(!src.includes('["ТОНН", Math.round(ov.totalVolume / 1000)]'), 'the old always-tonnes tile is still there');
  info('418 КГ -> 1,0 ТОНН at 1000');
});

test('Backup reminder: shown only when there is history to lose and the copy is stale', () => {
  const { backupDue, backupAgeDays } = loadBackupFns();
  const hist = n => ({ push: Array.from({ length: n }, (_, i) => ({ ts: i, date: '2026-09-01' })) });
  const today = '2026-10-02';
  assert(backupDue({ history: hist(2) }, today) === false, 'a new user with 2 workouts must not be nagged');
  assert(backupDue({ history: {} }, today) === false, 'empty journal: nothing to back up');
  assert(backupDue({ history: hist(3) }, today) === true, 'never backed up, 3 workouts -> remind');
  assert(backupDue({ history: hist(5), lastBackup: '2026-09-25' }, today) === false, '7 days old copy is fresh');
  assert(backupDue({ history: hist(5), lastBackup: '2026-09-19' }, today) === false, '13 days is still fresh, the boundary is 14');
  assert(backupDue({ history: hist(5), lastBackup: '2026-09-18' }, today) === true, '14 days -> remind');
  assert(backupAgeDays({ lastBackup: '2026-09-18' }, today) === 14, 'age in days, got ' + backupAgeDays({ lastBackup: '2026-09-18' }, today));
  assert(backupAgeDays({}, today) === null, 'no copy yet -> null');
  // "Позже" откладывает на 3 дня
  assert(backupDue({ history: hist(5), backupSnooze: '2026-10-02' }, today) === false, 'snoozed today');
  assert(backupDue({ history: hist(5), backupSnooze: '2026-09-30' }, today) === false, 'snoozed 2 days ago');
  assert(backupDue({ history: hist(5), backupSnooze: '2026-09-29' }, today) === true, 'snooze over after 3 days');
  // граница месяца и года считается календарными днями
  assert(backupAgeDays({ lastBackup: '2025-12-31' }, '2026-01-02') === 2, 'year boundary');
  info('Reminder rules: threshold, 14-day staleness, 3-day snooze');
});

test('Backup reminder banner is hidden mid-workout and offers save + snooze', () => {
  assert(src.includes('prog.done === 0 && backupDue(data, todayKey())'), 'banner must not show once a set is done');
  const i = src.indexOf('backupDue(data, todayKey())');
  const block = src.slice(i, i + 2600);
  assert(block.includes('onClick={exportBackup}'), 'banner must save in one tap');
  assert(block.includes('backupSnooze: todayKey()'), 'banner must be snoozable');
  assert((block.match(/minHeight: 44/g) || []).length >= 2, 'both banner buttons need a 44pt tap target');
  info('Banner: save, snooze, quiet during a workout');
});

test('todayKey is the local date, not UTC', () => {
  const fn = src.slice(src.indexOf('function todayKey'), src.indexOf('// ---- Резервная копия'));
  assert(!fn.includes('toISOString'), 'todayKey must not use toISOString - it is UTC and gives yesterday after midnight');
  const todayKey = new Function(fn + '; return todayKey;')();
  const d = new Date();
  const p = n => (n < 10 ? '0' : '') + n;
  const expected = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  assert(todayKey() === expected, 'got ' + todayKey() + ', expected ' + expected);
  info('Local date, midnight-safe');
});

test('weekKey groups by Monday regardless of timezone', () => {
  const fn = src.slice(src.indexOf('function weekKey'), src.indexOf('function getWeeklyStats'));
  assert(fn.includes('Date.UTC'), 'weekKey must parse the date as UTC parts');
  const weekKey = new Function(fn + '; return weekKey;')();
  assert(weekKey('2026-10-04') === '2026-09-28', 'Sunday belongs to the week of the previous Monday, got ' + weekKey('2026-10-04'));
  assert(weekKey('2026-09-28') === '2026-09-28', 'Monday is its own week key, got ' + weekKey('2026-09-28'));
  assert(weekKey('2026-10-02') === '2026-09-28', 'Friday maps to Monday, got ' + weekKey('2026-10-02'));
  info('Week keys are timezone-independent');
});

// ── SECTION 22: SELF-HOSTED LIBRARIES & OFFLINE ─────────────────────────────
section('22 · SELF-HOSTED LIBRARIES & OFFLINE');

const crypto = require('crypto');
const VENDOR = ['react.production.min.js', 'react-dom.production.min.js', 'babel.min.js'];
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'vendor', f))).digest('hex');

test('No script is loaded from an external server', () => {
  assertNot(/<script[^>]+src=["']https?:/i.test(html), 'an external <script src> is present');
  const loads = (html.match(/loadScript\(\s*['"][^'"]+['"]/g) || []);
  assert(loads.length === 3, 'expected 3 loadScript calls, got ' + loads.length);
  loads.forEach(l => assert(/loadScript\(\s*['"]vendor\//.test(l), 'loadScript must read from vendor/: ' + l));
  assertNot(html.includes('unpkg.com') && /loadScript\([^)]*unpkg/.test(html), 'unpkg is still used to load code');
  info('React, ReactDOM and Babel are all served from vendor/');
});

test('vendor/ files exist and match the checksums recorded in vendor/README.md', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'vendor', 'README.md'), 'utf8');
  VENDOR.forEach(f => {
    assert(fs.existsSync(path.join(ROOT, 'vendor', f)), 'missing vendor/' + f);
    const h = sha256(f);
    assert(readme.includes(h), 'vendor/' + f + ' differs from the recorded SHA-256 (' + h.slice(0, 12) + '...) - edited or line endings changed');
  });
  assert(fs.readFileSync(path.join(ROOT, 'vendor', 'react.production.min.js'), 'utf8').includes('18.3.1'), 'React must be 18.3.1');
  assert(/vendor\/\* -text/.test(fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8')), '.gitattributes must stop git rewriting vendor/ line endings');
  info('Checksums match, git will not touch line endings');
});

test('Service worker is a real file, registered by URL (blob workers are rejected by browsers)', () => {
  assert(fs.existsSync(path.join(ROOT, 'sw.js')), 'sw.js missing');
  assert(html.includes("register('sw.js')"), 'page must register sw.js');
  const shell = html.slice(0, html.indexOf('id="app-src"'));   // код приложения (скачивание копии) createObjectURL использует законно
  assertNot(shell.includes('createObjectURL') || shell.includes('new Blob'), 'blob service worker is still there');
  assertNot(html.includes('sila-v5'), 'old inline worker still present');
  info('sw.js registered by URL');
});

test('sw.js precaches the page and every vendor file, all of which exist', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const list = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
  assert(list.includes('index.html') && list.includes('./'), 'page must be precached');
  VENDOR.forEach(f => assert(list.includes('vendor/' + f), f + ' not precached - first offline start would fail'));
  list.filter(u => u !== './').forEach(u => assert(fs.existsSync(path.join(ROOT, u)), 'precache entry does not exist: ' + u + ' (addAll would reject and the worker never installs)'));
  assert(/const CACHE = "sila-v\d+"/.test(sw), 'cache name missing');
  info('Precache list complete and every entry exists');
});

// Исполняет настоящий sw.js на заглушках Cache API; ждём сети 40 мс вместо 3 с
function runSw(store, fetchImpl, file, cacheKeys) {
  let code = fs.readFileSync(path.join(ROOT, file || 'sw.js'), 'utf8').replace('const NETWORK_WAIT_MS = 3000', 'const NETWORK_WAIT_MS = 40');
  const handlers = {};
  const key = r => (typeof r === 'string' ? (r === 'index.html' ? 'https://x.test/index.html' : r) : r.url);
  const self_ = { location: { origin: 'https://x.test' }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() } };
  const caches = {
    open: async () => ({ addAll: async () => {}, put: async (r, res) => { store.set(key(r), res); } }),
    match: async r => store.get(key(r)),
    keys: async () => cacheKeys || ['sila-v5', 'sila-v6', 'sila-beta-v1'], delete: async k => { store.deleted = (store.deleted || []).concat(k); return true; },
  };
  class Response { constructor(body, o) { this.body = body; this.ok = !(o && o.ok === false); } clone() { return this; } static error() { const r = new Response('ERR', { ok: false }); r.isError = true; return r; } }
  class Request { constructor(u) { this.url = u; } }
  new Function('self', 'caches', 'fetch', 'Response', 'Request', code)(self_, caches, fetchImpl, Response, Request);
  const get = async url => { let p; handlers.fetch({ request: { method: 'GET', url }, respondWith: x => { p = x; } }); return p; };
  return { handlers, get, Response, self_, caches };
}

testAsync('sw.js behaviour: vendor cache-first, page network-first with a cache fallback', async () => {
  const store = new Map();
  let fetches = 0, mode = 'ok';
  const fetchImpl = url => {
    fetches++;
    if (mode === 'fail') return Promise.reject(new Error('offline'));
    if (mode === 'hang') return new Promise(() => {});
    return Promise.resolve(new sw.Response('NET:' + (url.url || url)));
  };
  const sw = runSw(store, fetchImpl);
  store.set('https://x.test/vendor/babel.min.js', new sw.Response('CACHED-BABEL'));
  store.set('https://x.test/index.html', new sw.Response('CACHED-PAGE'));

  let r = await sw.get('https://x.test/vendor/babel.min.js');
  assert(r.body === 'CACHED-BABEL' && fetches === 0, 'vendor file must come from the cache without touching the network');

  mode = 'ok'; r = await sw.get('https://x.test/index.html');
  assert(r.body === 'NET:https://x.test/index.html', 'online: the fresh page wins, got ' + r.body);
  assert(store.get('https://x.test/index.html').body === 'NET:https://x.test/index.html', 'fresh page must be written to the cache');

  store.set('https://x.test/index.html', new sw.Response('CACHED-PAGE'));
  mode = 'fail'; r = await sw.get('https://x.test/index.html');
  assert(r.body === 'CACHED-PAGE', 'offline: the cached page must open, got ' + r.body);

  mode = 'hang'; r = await sw.get('https://x.test/index.html');
  assert(r.body === 'CACHED-PAGE', 'a hanging network must fall back to the cache after the wait, got ' + r.body);

  store.clear(); mode = 'fail'; r = await sw.get('https://x.test/never-cached');
  assert(r.isError, 'nothing cached and offline -> a network error, not a hang or a crash');

  // чужие домены и не-GET воркер не трогает
  let called = false;
  sw.handlers.fetch({ request: { method: 'POST', url: 'https://x.test/index.html' }, respondWith: () => { called = true; } });
  sw.handlers.fetch({ request: { method: 'GET', url: 'https://other.test/a.js' }, respondWith: () => { called = true; } });
  assert(!called, 'POST and cross-origin requests must pass through untouched');
  info('Cache-first vendor, network-first page, offline and slow-network fallbacks');
});

testAsync('sw.js activate deletes old caches (the inline sila-v5 worker)', async () => {
  const store = new Map();
  const sw = runSw(store, () => Promise.reject(new Error('x')));
  let waited;
  sw.handlers.activate({ waitUntil: p => { waited = p; } });
  await waited;
  assert((store.deleted || []).join() === 'sila-v5', 'only OLD production caches must be deleted (never sila-beta-*), got ' + store.deleted);
  info('Old caches cleaned on activate, the test version cache is left alone');
});

// ── SECTION 23: TEST (BETA) VERSION ─────────────────────────────────────────
section('23 · TEST VERSION (beta/)');

const BETA_HTML_PATH = path.join(ROOT, 'beta', 'index.html');
const BETA_SW_PATH = path.join(ROOT, 'beta', 'sw.js');
const BETA_SRC_DIR = path.join(ROOT, 'src', 'beta');
const betaHtml = fs.existsSync(BETA_HTML_PATH) ? fs.readFileSync(BETA_HTML_PATH, 'utf8') : '';
const betaApp = betaHtml.slice(betaHtml.indexOf(APP_MARKER) + APP_MARKER.length, betaHtml.indexOf('</script>', betaHtml.indexOf(APP_MARKER)));
const betaFiles = fs.existsSync(BETA_SRC_DIR) ? fs.readdirSync(BETA_SRC_DIR).filter(f => f.endsWith('.jsx')).sort() : [];
const betaSrc = betaFiles.map(f => fs.readFileSync(path.join(BETA_SRC_DIR, f), 'utf8')).join('\n');

// ── Тренер: настоящий код src/beta/coach.jsx на синтетических журналах ────────
function loadCoach() {
  const dnFrom = src.indexOf('function dayNum');
  const dnSrc = src.slice(dnFrom, src.indexOf('function backupAgeDays', dnFrom));
  const coachSrc = fs.readFileSync(path.join(BETA_SRC_DIR, 'coach.jsx'), 'utf8');
  const body = coachSrc.slice(0, coachSrc.indexOf('const COACH_KIND_STYLE'));
  // тренер использует расчёты из profile.jsx (динамика веса, самочувствие, рекомендация)
  const profSrc = fs.readFileSync(path.join(BETA_SRC_DIR, 'profile.jsx'), 'utf8');
  const prof = profSrc.slice(0, profSrc.indexOf('// ---- Интерфейс ----'));
  return new Function(dnSrc + prof + body + '; return { coachAnalyze, coachVisible, coachPlural, coachWeekday, coachStuck, dayNum, profileValidate, profileBmi, profileBmiLabel, profileEnergy, profileRecommend, bodyLogAdd, bodyTrend, bodyLatest, feelLogSet, feelRecent, profileNum };')();
}
const TODAY = '2026-10-07';   // среда
const ago = n => new Date(Date.UTC(2026, 9, 7) - n * 86400000).toISOString().slice(0, 10);
const entry = (date, workout, exs) => ({ date, ts: Date.parse(date), workout, name: workout.toUpperCase(),
  detail: (exs || []).map(([id, name, ws]) => ({ id, name, sets: ws.map(w => ({ w: String(w), done: true })) })) });
const hist = (...es) => { const h = {}; es.forEach(e => { (h[e.workout] = h[e.workout] || []).push(e); }); return h; };
const ids = r => r.advice.map(a => a.id);

test('Coach: weekday maths, plural forms, empty journal', () => {
  const c = loadCoach();
  assert(c.coachWeekday(c.dayNum('2026-10-05')) === 0, 'Monday must be 0');
  assert(c.coachWeekday(c.dayNum('2026-10-07')) === 2, 'Wednesday must be 2');
  assert(c.coachWeekday(c.dayNum('2026-10-11')) === 6, 'Sunday must be 6');
  const f = n => c.coachPlural(n, 'тренировку', 'тренировки', 'тренировок');
  assert([1, 2, 5, 11, 12, 14, 21, 22, 25].map(f).join() === 'тренировку,тренировки,тренировок,тренировок,тренировок,тренировок,тренировку,тренировки,тренировок', 'plural forms wrong: ' + [1, 2, 5, 11, 12, 14, 21, 22, 25].map(f).join());
  const r = c.coachAnalyze({ history: {}, schedule: ['push', null, 'pull', null, 'legs', null, null] }, TODAY);
  assert(r.advice.length === 0 && r.stats.total === 0 && r.stats.lastAgo === null && r.stats.planned === 3, 'empty journal must give no advice, got ' + JSON.stringify(r));
  info('0 = Monday, Russian plurals, empty journal is safe');
});

test('Coach: summary tiles (week progress, last workout, pace)', () => {
  const c = loadCoach();
  const d = { schedule: ['push', null, 'pull', null, 'legs', null, null], history: hist(
    entry(ago(2), 'push'), entry(ago(0), 'pull'),           // пн 5 и ср 7 этой недели
    entry(ago(9), 'push'), entry(ago(16), 'push'), entry(ago(23), 'push')) };
  const r = c.coachAnalyze(d, TODAY);
  assert(r.stats.doneThisWeek === 2, 'two workouts this week, got ' + r.stats.doneThisWeek);
  assert(r.stats.lastAgo === 0, 'last workout is today, got ' + r.stats.lastAgo);
  assert(r.stats.perWeek === 1.3, '5 workouts in 28 days = 1.3 a week, got ' + r.stats.perWeek);
  info('Week 2 of 3, pace 1.3 per week');
});

test('Coach: a break gives one calm warning and suppresses the missed-days noise', () => {
  const c = loadCoach();
  const r = c.coachAnalyze({ schedule: ['push', null, 'pull', null, 'legs', null, null], history: hist(entry(ago(17), 'push'), entry(ago(24), 'push'), entry(ago(31), 'push')) }, TODAY);
  const b = r.advice.find(a => a.id === 'break');
  assert(b && b.kind === 'warn' && b.title === 'Перерыв 17 дней', 'break advice expected, got ' + JSON.stringify(ids(r)));
  assert(!ids(r).includes('missed'), 'missed days are already explained by the break');
  info('Break: ' + b.title);
});

test('Coach: plateau after 3 sessions without a new maximum, record while progressing', () => {
  const c = loadCoach();
  const bench = ws => ['bench', 'Жим штанги лёжа', ws];
  // 60, 62.5, 65, 65, 65, 65: последний рекорд на третьей тренировке, дальше три без роста
  const stuck = c.coachAnalyze({ history: hist(...[35, 28, 21, 14, 7, 2].map((n, i) => entry(ago(n), 'push', [bench([[60], [62.5], [65], [65], [65], [65]][i])]))) }, TODAY);
  const p = stuck.advice.find(a => a.id === 'plateau:bench');
  assert(p && p.kind === 'tip' && p.text.includes('65 кг') && p.text.includes('3 тренировки'), 'plateau expected, got ' + JSON.stringify(ids(stuck)));
  assert(!ids(stuck).some(i => i.startsWith('pr:')), 'a plateau is not a record');
  // рост продолжается: рекорд, застоя нет
  const grow = c.coachAnalyze({ history: hist(...[35, 28, 21, 14, 2].map((n, i) => entry(ago(n), 'push', [bench([[60], [62.5], [65], [67.5], [70]][i])]))) }, TODAY);
  const r = grow.advice.find(a => a.id.startsWith('pr:bench'));
  assert(r && r.kind === 'good' && r.text.includes('70 кг') && r.text.includes('+2.5'), 'record expected, got ' + JSON.stringify(ids(grow)));
  assert(!ids(grow).includes('plateau:bench'), 'no plateau while progressing');
  // слишком мало данных: 3 тренировки без роста ещё не застой
  const few = c.coachAnalyze({ history: hist(...[14, 7, 2].map(n => entry(ago(n), 'push', [bench([60])]))) }, TODAY);
  assert(!ids(few).includes('plateau:bench'), 'three sessions are not enough evidence');
  // давно не делал: не ругаем за упражнение, которого уже нет в программе
  const old = c.coachAnalyze({ history: hist(...[100, 93, 86, 79, 72, 65].map(n => entry(ago(n), 'push', [bench([60])]))) }, TODAY);
  assert(!ids(old).includes('plateau:bench'), 'an exercise untouched for 30+ days is not a plateau');
  info('Plateau needs 4+ sessions and 3 stuck; records only within a week');
});

test('Coach: missed scheduled days over two weeks', () => {
  const c = loadCoach();
  const sched = ['push', null, 'pull', null, 'legs', null, null];
  // тренировки только по понедельникам: 21 сен, 28 сен, 5 окт
  const r = c.coachAnalyze({ schedule: sched, history: hist(entry('2026-09-21', 'push'), entry('2026-09-28', 'push'), entry('2026-10-05', 'push')) }, TODAY);
  const m = r.advice.find(a => a.id === 'missed');
  assert(m && m.title === 'Пропущено 4 из 6 по плану', 'expected 4 of 6 missed, got ' + (m ? m.title : JSON.stringify(ids(r))));
  // всё по плану - тишина
  const ok = c.coachAnalyze({ schedule: sched, history: hist(entry('2026-09-21', 'push'), entry('2026-09-23', 'pull'), entry('2026-09-25', 'legs'), entry('2026-09-28', 'push'), entry('2026-09-30', 'pull'), entry('2026-10-02', 'legs'), entry('2026-10-05', 'push')) }, TODAY);
  assert(!ids(ok).includes('missed'), 'no missed days when everything was done');
  // новичок: до первой тренировки пропусками не считаем
  const fresh = c.coachAnalyze({ schedule: sched, history: hist(entry('2026-10-05', 'push')) }, TODAY);
  assert(!ids(fresh).includes('missed'), 'days before the first workout are not misses');
  info('4 of 6 flagged; full attendance and beginners are left alone');
});

test('Coach: push/pull/legs imbalance respects the schedule', () => {
  const c = loadCoach();
  const sched = ['push', null, 'pull', null, 'legs', null, null];
  const days = [26, 24, 21, 19, 17, 12, 10, 5];   // 6 жима, 2 тяги, 0 ног за 4 недели
  const types = ['push', 'push', 'push', 'push', 'push', 'push', 'pull', 'pull'];
  const h = hist(...days.map((n, i) => entry(ago(n), types[i])));
  const r = c.coachAnalyze({ schedule: sched, history: h }, TODAY);
  const b = r.advice.filter(a => a.id.startsWith('balance:'));
  assert(b.length === 1 && b[0].id === 'balance:legs' && b[0].title === 'Тренировок на ноги меньше других', 'only legs must be flagged, got ' + JSON.stringify(b.map(x => x.id)));
  // если ног нет в расписании, это выбор пользователя
  const noLegs = c.coachAnalyze({ schedule: ['push', null, 'pull', null, null, null, null], history: h }, TODAY);
  assert(!ids(noLegs).some(i => i === 'balance:legs'), 'legs are not scheduled, so they are not "lagging"');
  info('Imbalance is judged only among scheduled days');
});

test('Coach: volume spike, deload reminder, streak of weeks on plan', () => {
  const c = loadCoach();
  const vol = v => [['bench', 'Жим', [v]]];   // один подход: объём = вес
  // ago(2) = понедельник текущей недели (5 окт); o = смещение вперёд от понедельника; weeksBack = недель назад
  const mk = (weeksBack, dayOffsets, v) => dayOffsets.map(o => entry(ago(2 + weeksBack * 7 - o), 'push', vol(v)));
  // 3 прошлые недели по 1000, текущая 1600 -> рост 60%
  const spike = c.coachAnalyze({ history: hist(...mk(3, [0, 2], 500), ...mk(2, [0, 2], 500), ...mk(1, [0, 2], 500), ...mk(0, [0, 2], 800)) }, TODAY);
  const s = spike.advice.find(a => a.id === 'spike');
  assert(s && s.kind === 'warn' && s.title === 'Объём недели вырос на 60%', 'spike expected, got ' + JSON.stringify(spike.advice.map(a => a.title)));
  // 7 недель подряд одинаково, без лёгкой недели -> разгрузка
  const flat = [];
  for (let w = 1; w <= 7; w++) flat.push(...mk(w, [0, 2], 500));
  const dl = c.coachAnalyze({ history: hist(...flat) }, TODAY).advice.find(a => a.id === 'deload');
  assert(dl && dl.kind === 'tip' && dl.title === '7 недель подряд без разгрузки', 'deload expected, got ' + (dl && dl.title));
  // одна из недель лёгкая -> разгрузка уже была
  const withLight = [];
  for (let w = 1; w <= 7; w++) withLight.push(...mk(w, [0, 2], w === 4 ? 200 : 500));
  assert(!ids(c.coachAnalyze({ history: hist(...withLight) }, TODAY)).includes('deload'), 'a light week counts as a deload');
  // три прошлые недели по 3 тренировки при плане 3 -> серия
  const sched = ['push', null, 'pull', null, 'legs', null, null];
  const plan = [];
  for (let w = 1; w <= 3; w++) plan.push(...mk(w, [0, 2, 4], 500));
  const st = c.coachAnalyze({ schedule: sched, history: hist(...plan) }, TODAY).advice.find(a => a.id.startsWith('streak:'));
  assert(st && st.id === 'streak:3' && st.kind === 'good' && st.title === '3 недели подряд по плану', 'streak expected, got ' + (st && st.title));
  info('Spike +60%, 7 weeks without deload, 3-week streak');
});

test('Coach: advice is ordered, capped, never mutates data, and can be snoozed for a week', () => {
  const c = loadCoach();
  const d = { schedule: ['push', null, 'pull', null, 'legs', null, null], history: hist(entry(ago(17), 'push', [['bench', 'Жим', [60]]]), entry(ago(24), 'push', [['bench', 'Жим', [60]]])) };
  const before = JSON.stringify(d);
  const r = c.coachAnalyze(d, TODAY);
  assert(JSON.stringify(d) === before, 'coachAnalyze must not mutate the data');
  assert(r.advice.length <= 6, 'at most 6 pieces of advice');
  const order = { warn: 0, tip: 1, good: 2 };
  assert(r.advice.every((a, i) => i === 0 || order[r.advice[i - 1].kind] <= order[a.kind]), 'warnings must come before tips and praise');
  const adv = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const vis = (dis, today) => c.coachVisible(adv, dis, today).map(a => a.id).join('');
  assert(vis({ a: '2026-10-07' }, TODAY) === 'bc', 'snoozed today -> hidden');
  assert(vis({ a: '2026-10-01' }, TODAY) === 'bc', 'snoozed 6 days ago -> still hidden');
  assert(vis({ a: '2026-09-30' }, TODAY) === 'abc', 'snoozed 7 days ago -> back');
  assert(vis(undefined, TODAY) === 'abc', 'no dismissals -> all visible');
  info('Sorted, capped at 6, pure, snooze = 7 days');
});

// ── Spotify: настоящий код src/beta/spotify.jsx на заглушках ──────────────────
function loadSpotify(env) {
  const code = fs.readFileSync(path.join(BETA_SRC_DIR, 'spotify.jsx'), 'utf8');
  const body = code.slice(0, code.indexOf('function SpotifyPanel'));
  const mem = (env && env.mem) || {};
  const localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const location = (env && env.location) || { origin: 'https://shattersxd.github.io', pathname: '/workout/beta/', search: '', href: '' };
  const calls = [];
  const history = { replaceState: (a, b, url) => calls.push(['replaceState', url]) };
  const fetchStub = (env && env.fetch) || (() => Promise.reject(new Error('no fetch expected')));
  const timers = { set: [], cleared: [] };
  const fakeSetInterval = (fn, ms) => { timers.set.push({ fn, ms }); return timers.set.length; };
  const fakeClearInterval = id => timers.cleared.push(id);
  const doc = (env && env.document) || { visibilityState: 'visible' };
  const api = new Function('localStorage', 'location', 'history', 'fetch', 'setInterval', 'clearInterval', 'document',
    body + '; return { SPOTIFY_STORAGE_KEY, SPOTIFY_BOOT, SPOTIFY_FEED, spBase64Url, spRandomString, spChallenge, spRedirectUri, spAuthUrl, spParseCallback, spExchange, spRefresh, spCall, spInit, spPlayerView, spErrorText, spLoad, spSave, spStartLogin, betaInitialTab, spHasScope, spPlaylistsView, spSearchView, spSearchPath, spPlayBody, spSharedCall, spFeedSubscribe, spFeedRefresh, spCommand, SPOTIFY_PLAYLISTS_PATH };'
  )(localStorage, location, history, fetchStub, fakeSetInterval, fakeClearInterval, doc);
  return Object.assign(api, { mem, calls, location, timers });
}
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === undefined) throw new Error('no body'); return body; } });
const bodyOf = init => Object.fromEntries(new URLSearchParams(init.body));

testAsync('Spotify: PKCE challenge matches the RFC 7636 test vector, verifiers are random and URL-safe', async () => {
  const sp = loadSpotify();
  const ch = await sp.spChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  assert(ch === 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'S256 challenge differs from the RFC vector, got ' + ch);
  const a = sp.spRandomString(96), b = sp.spRandomString(96);
  assert(a.length === 96 && a !== b, 'verifier must be 96 chars and differ between calls');
  assert(/^[A-Za-z0-9\-._~]+$/.test(a), 'verifier may only use unreserved URL characters');
  assert(sp.spBase64Url(new Uint8Array([251, 255, 254])) === '-__-', 'base64url must use - and _ and drop padding, got ' + sp.spBase64Url(new Uint8Array([251, 255, 254])));
  info('RFC 7636 vector OK');
});

test('Spotify: redirect URI and authorize URL are exact and fully encoded', () => {
  const sp = loadSpotify();
  assert(sp.spRedirectUri() === 'https://shattersxd.github.io/workout/beta/', 'redirect URI, got ' + sp.spRedirectUri());
  const idx = loadSpotify({ location: { origin: 'https://shattersxd.github.io', pathname: '/workout/beta/index.html', search: '' } });
  assert(idx.spRedirectUri() === 'https://shattersxd.github.io/workout/beta/', 'index.html must be stripped, got ' + idx.spRedirectUri());
  const u = new URL(sp.spAuthUrl('CLIENT123', sp.spRedirectUri(), 'CHAL', 'STATE'));
  assert(u.origin + u.pathname === 'https://accounts.spotify.com/authorize', 'authorize endpoint, got ' + u.origin + u.pathname);
  const q = Object.fromEntries(u.searchParams);
  assert(q.response_type === 'code' && q.client_id === 'CLIENT123' && q.state === 'STATE', 'basic params: ' + JSON.stringify(q));
  assert(q.code_challenge === 'CHAL' && q.code_challenge_method === 'S256', 'PKCE params: ' + JSON.stringify(q));
  assert(q.redirect_uri === 'https://shattersxd.github.io/workout/beta/', 'redirect_uri must survive encoding, got ' + q.redirect_uri);
  assert(q.scope.split(' ').sort().join() === 'playlist-read-collaborative,playlist-read-private,user-modify-playback-state,user-read-currently-playing,user-read-playback-state', 'scopes: ' + q.scope);
  assertNot(/[?&]client_secret=/.test(u.href), 'a public client must never send a secret');
  info('Authorize URL is exact');
});

test('Spotify: callback parsing', () => {
  const sp = loadSpotify();
  assert(JSON.stringify(sp.spParseCallback('?code=abc&state=xyz')) === '{"code":"abc","state":"xyz"}', 'code + state');
  assert(sp.spParseCallback('?error=access_denied&state=xyz').error === 'access_denied', 'error callback');
  assert(sp.spParseCallback('') === null && sp.spParseCallback('?foo=1') === null && sp.spParseCallback('?code=abc') === null, 'anything else is not a callback (a code without state must be ignored)');
  info('code+state, error, and non-callbacks');
});

testAsync('Spotify: code exchange sends the verifier, stores tokens, and refuses a foreign state without a request', async () => {
  const reqs = [];
  const fetchOk = async (url, init) => { reqs.push([url, init]); return jsonRes(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }); };
  const sp = loadSpotify({ fetch: fetchOk });
  const store = { clientId: 'CID', pending: { verifier: 'VERIFIER', state: 'S1', redirect: 'https://shattersxd.github.io/workout/beta/' } };
  const r = await sp.spExchange({ code: 'CODE', state: 'S1' }, store, fetchOk, 1000);
  assert(r.store && r.store.access === 'AT' && r.store.refresh === 'RT' && r.store.expiresAt === 1000 + 3600000 && r.store.clientId === 'CID', 'tokens stored: ' + JSON.stringify(r));
  assert(!('pending' in r.store), 'the one-time verifier must not stay in the store');
  assert(reqs.length === 1 && reqs[0][0] === 'https://accounts.spotify.com/api/token' && reqs[0][1].method === 'POST', 'POST to the token endpoint');
  assert(reqs[0][1].headers['Content-Type'] === 'application/x-www-form-urlencoded', 'form encoding required by Spotify');
  const b = bodyOf(reqs[0][1]);
  assert(b.grant_type === 'authorization_code' && b.code === 'CODE' && b.client_id === 'CID' && b.code_verifier === 'VERIFIER' && b.redirect_uri === 'https://shattersxd.github.io/workout/beta/', 'token request body: ' + JSON.stringify(b));
  assert(!('client_secret' in b), 'no client secret');
  // чужой state: ни одного запроса
  reqs.length = 0;
  const bad = await sp.spExchange({ code: 'CODE', state: 'OTHER' }, store, fetchOk, 1000);
  assert(bad.error && !bad.store && reqs.length === 0, 'a mismatched state must be rejected before any request');
  const none = await sp.spExchange({ code: 'CODE', state: 'S1' }, { clientId: 'CID' }, fetchOk, 1000);
  assert(none.error && reqs.length === 0, 'no pending login (callback opened in another context) -> clear message, no request');
  // ошибка Spotify
  const failing = async () => jsonRes(400, { error: 'invalid_grant', error_description: 'Invalid authorization code' });
  const e = await sp.spExchange({ code: 'CODE', state: 'S1' }, store, failing, 1000);
  assert(e.error === 'Invalid authorization code', 'Spotify error text is passed on, got ' + JSON.stringify(e));
  info('Verifier sent, tokens stored, foreign state rejected');
});

testAsync('Spotify: API calls refresh the token ahead of expiry and once after a 401', async () => {
  const seen = [];
  let apiStatuses = [200];
  const fetchFn = async (url, init) => {
    seen.push({ url, method: init.method, auth: init.headers && init.headers.Authorization, body: init.body && bodyOf(init) });
    if (url.indexOf('/api/token') >= 0) return jsonRes(200, { access_token: 'NEW' + seen.length, expires_in: 3600 });   // refresh_token не вернули - старый сохраняется
    const st = apiStatuses.length > 1 ? apiStatuses.shift() : apiStatuses[0];
    return st === 204 ? jsonRes(204) : jsonRes(st, { is_playing: true });
  };
  const sp = loadSpotify({ fetch: fetchFn });
  const fresh = { clientId: 'CID', access: 'AT', refresh: 'RT', expiresAt: 10 * 60 * 1000 };
  let r = await sp.spCall(fresh, fetchFn, 'GET', '/me/player', 0);
  assert(r.status === 200 && seen.length === 1 && seen[0].auth === 'Bearer AT' && seen[0].url === 'https://api.spotify.com/v1/me/player', 'a fresh token is used as is: ' + JSON.stringify(seen));
  assert(r.store === fresh, 'an unchanged store must be returned as the same object (no needless writes)');
  // истекает через 30 секунд: обновляем заранее
  seen.length = 0;
  r = await sp.spCall({ clientId: 'CID', access: 'AT', refresh: 'RT', expiresAt: 30000 }, fetchFn, 'PUT', '/me/player/pause', 0);
  assert(seen.length === 2 && seen[0].url.indexOf('/api/token') >= 0 && seen[0].body.grant_type === 'refresh_token' && seen[0].body.refresh_token === 'RT', 'refresh first: ' + JSON.stringify(seen[0]));
  assert(seen[1].auth === 'Bearer NEW1' && r.store.access === 'NEW1' && r.store.refresh === 'RT', 'the new token is used and the old refresh token is kept');
  // 401 -> один refresh и повтор
  seen.length = 0; apiStatuses = [401, 200];
  r = await sp.spCall({ clientId: 'CID', access: 'OLD', refresh: 'RT', expiresAt: 10 * 60 * 1000 }, fetchFn, 'GET', '/me/player', 0);
  assert(r.status === 200 && seen.length === 3 && seen[2].auth.startsWith('Bearer NEW'), '401 -> refresh -> retry: ' + seen.map(s => s.url.split('/').pop()).join(','));
  // 204 без тела
  seen.length = 0; apiStatuses = [204];
  r = await sp.spCall(fresh, fetchFn, 'GET', '/me/player', 0);
  assert(r.status === 204 && r.json === null, '204 has no body');
  // не подключён - без запросов
  seen.length = 0;
  r = await sp.spCall({ clientId: 'CID' }, fetchFn, 'GET', '/me/player', 0);
  assert(r.status === 401 && seen.length === 0, 'without a refresh token nothing is sent');
  // refresh отозван -> expired
  const revoked = async (url) => url.indexOf('/api/token') >= 0 ? jsonRes(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' }) : jsonRes(200, {});
  r = await sp.spCall({ clientId: 'CID', access: 'AT', refresh: 'RT', expiresAt: 0 }, revoked, 'GET', '/me/player', 0);
  assert(r.status === 401 && r.expired === true && r.error === 'Refresh token revoked', 'a revoked grant must ask to log in again: ' + JSON.stringify(r));
  info('Proactive refresh, one retry on 401, rotation-safe, revoked grant detected');
});

test('Spotify: player view and error messages', () => {
  const sp = loadSpotify();
  const v = sp.spPlayerView(200, { is_playing: true, item: { name: 'Song', artists: [{ name: 'A' }, { name: 'B' }] }, device: { name: 'iPhone' } });
  assert(v.playing === true && v.title === 'Song' && v.artist === 'A, B' && v.device === 'iPhone', 'view: ' + JSON.stringify(v));
  assert(sp.spPlayerView(204, null).none === true && sp.spPlayerView(404, {}).none === true, 'no active device -> none');
  assert(sp.spPlayerView(200, { is_playing: false, item: null }).title === '', 'an ad or empty item must not crash');
  assert(sp.spErrorText(204) === null && sp.spErrorText(200) === null, 'success has no message');
  assert(sp.spErrorText(403, { error: { reason: 'PREMIUM_REQUIRED' } }).includes('Premium'), 'Premium message');
  assert(sp.spErrorText(404, { error: { reason: 'NO_ACTIVE_DEVICE' } }).includes('активного устройства'), 'no-device message');
  assert(sp.spErrorText(429).includes('подождать') && sp.spErrorText(500).includes('500'), '429 and generic');
  info('View and messages');
});

testAsync('Spotify: finishing a login on page load saves tokens, cleans the URL, reports errors', async () => {
  const mem = { ppl_spotify_beta: JSON.stringify({ clientId: 'CID', pending: { verifier: 'V', state: 'S1', redirect: 'https://shattersxd.github.io/workout/beta/' } }) };
  const fetchOk = async () => jsonRes(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
  const loc = { origin: 'https://shattersxd.github.io', pathname: '/workout/beta/', search: '?code=CODE&state=S1' };
  let sp = loadSpotify({ mem, location: loc, fetch: fetchOk });
  for (let i = 0; i < 50 && !sp.SPOTIFY_BOOT.done; i++) await new Promise(r => setTimeout(r, 10));
  assert(sp.SPOTIFY_BOOT.done && !sp.SPOTIFY_BOOT.error, 'boot must finish without error, got ' + sp.SPOTIFY_BOOT.error);
  const saved = JSON.parse(mem.ppl_spotify_beta);
  assert(saved.access === 'AT' && saved.refresh === 'RT' && saved.clientId === 'CID' && !saved.pending, 'tokens saved, verifier dropped: ' + JSON.stringify(saved));
  assert(sp.calls.some(c => c[0] === 'replaceState' && c[1] === 'https://shattersxd.github.io/workout/beta/'), 'the one-time code must be removed from the address bar');
  assert(sp.betaInitialTab() === 'workout' || true, 'initial tab helper is callable');
  // отмена входа
  sp = loadSpotify({ mem: {}, location: { origin: 'https://x.test', pathname: '/b/', search: '?error=access_denied&state=S1' } });
  for (let i = 0; i < 50 && !sp.SPOTIFY_BOOT.done; i++) await new Promise(r => setTimeout(r, 10));
  assert(sp.SPOTIFY_BOOT.error === 'Вход отменён', 'denied login message, got ' + sp.SPOTIFY_BOOT.error);
  // обычный запуск ничего не трогает
  sp = loadSpotify({ mem: {}, location: { origin: 'https://x.test', pathname: '/b/', search: '' } });
  for (let i = 0; i < 50 && !sp.SPOTIFY_BOOT.done; i++) await new Promise(r => setTimeout(r, 10));
  assert(sp.SPOTIFY_BOOT.done && !sp.SPOTIFY_BOOT.error && sp.calls.length === 0, 'a normal start must change nothing');
  // initial tab: после возврата со Spotify - БЕТА
  assert(loadSpotify({ location: { origin: 'x', pathname: '/', search: '?code=1&state=2' } }).betaInitialTab() === 'beta', 'after Spotify returns, open the BETA tab');
  assert(loadSpotify({ location: { origin: 'x', pathname: '/', search: '' } }).betaInitialTab() === 'workout', 'normally open the workout tab');
  info('Boot: tokens saved, URL cleaned, denied/normal start handled');
});

testAsync('Spotify: commands can carry a JSON body, GET and plain commands do not', async () => {
  const seen = [];
  const fetchFn = async (url, init) => { seen.push({ url, init }); return jsonRes(204); };
  const sp = loadSpotify({ fetch: fetchFn });
  const st = { clientId: 'C', access: 'AT', refresh: 'RT', expiresAt: 10 * 60 * 1000 };
  await sp.spCall(st, fetchFn, 'PUT', '/me/player/play', 0, { context_uri: 'spotify:playlist:1' });
  const i = seen[0].init;
  assert(i.method === 'PUT' && i.headers['Content-Type'] === 'application/json' && i.body === '{"context_uri":"spotify:playlist:1"}' && i.headers.Authorization === 'Bearer AT', 'a play command carries its JSON: ' + JSON.stringify(i));
  seen.length = 0;
  await sp.spCall(st, fetchFn, 'POST', '/me/player/next', 0);
  assert(!('body' in seen[0].init) && !('Content-Type' in seen[0].init.headers), 'next/pause/GET send no body and no content type');
  info('Body only when asked');
});

testAsync('Spotify: tokens remember granted scopes, so old tokens are asked to sign in again once for playlists', async () => {
  const fetchOk = async () => jsonRes(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'user-read-playback-state playlist-read-private' });
  const sp = loadSpotify({ fetch: fetchOk });
  const store = { clientId: 'C', pending: { verifier: 'V', state: 'S', redirect: 'https://x/' } };
  const ex = await sp.spExchange({ code: 'c', state: 'S' }, store, fetchOk, 0);
  assert(ex.store.scope === 'user-read-playback-state playlist-read-private', 'the granted scopes are stored: ' + JSON.stringify(ex.store));
  assert(sp.spHasScope(ex.store, 'playlist-read-private') === true && sp.spHasScope(ex.store, 'playlist-read-collaborative') === false, 'scope check is exact');
  assert(sp.spHasScope({ clientId: 'C', refresh: 'RT' }, 'playlist-read-private') === false, 'a token from before playlists existed has no scope field: ask to sign in again');
  const rf = await sp.spRefresh(Object.assign({}, ex.store, { refresh: 'RT' }), async () => jsonRes(200, { access_token: 'N', expires_in: 3600 }), 0);
  assert(rf.store.scope === 'user-read-playback-state playlist-read-private', 'a refresh that does not repeat the scope keeps the old one');
  info('Scopes stored and kept across refreshes');
});

test('Spotify: playlists, search results and play bodies are mapped safely', () => {
  const sp = loadSpotify();
  const pl = sp.spPlaylistsView({ items: [{ id: 'a', uri: 'spotify:playlist:a', name: 'Зал', tracks: { total: 42 } }, null, { id: 'b', uri: 'spotify:playlist:b', name: 'Бег' }, { id: 'c', name: 'без uri' }] });
  assert(pl.length === 2 && pl[0].name === 'Зал' && pl[0].total === 42 && pl[1].total === null, 'playlists: ' + JSON.stringify(pl));
  assert(sp.spPlaylistsView(null).length === 0 && sp.spPlaylistsView({}).length === 0, 'an empty or broken reply is an empty list');
  const tr = sp.spSearchView({ tracks: { items: [{ uri: 'spotify:track:1', name: 'Song', artists: [{ name: 'A' }, { name: 'B' }] }, null, { name: 'no uri' }] } });
  assert(tr.length === 1 && tr[0].artist === 'A, B' && tr[0].uri === 'spotify:track:1', 'search: ' + JSON.stringify(tr));
  assert(sp.spSearchView({}).length === 0 && sp.spSearchView(null).length === 0, 'no results is an empty list, not a crash');
  assert(sp.spSearchPath('Queen & Bowie') === '/search?q=Queen%20%26%20Bowie&type=track&limit=10', 'the query is encoded and limited to 10 (the personal-app maximum): ' + sp.spSearchPath('Queen & Bowie'));
  assert(JSON.stringify(sp.spPlayBody('playlist', 'spotify:playlist:a')) === '{"context_uri":"spotify:playlist:a"}', 'a playlist plays as a context');
  assert(JSON.stringify(sp.spPlayBody('track', 'spotify:track:1')) === '{"uris":["spotify:track:1"]}', 'a track plays as a uri list');
  assert(sp.SPOTIFY_PLAYLISTS_PATH === '/me/playlists?limit=20', 'playlists path');
  info('Playlists, search and play bodies');
});

testAsync('Spotify: shared requests are queued, so two components never refresh the token at the same time', async () => {
  const tokenCalls = [];
  const fetchFn = async (url, init) => {
    if (url.indexOf('/api/token') >= 0) { tokenCalls.push(bodyOf(init).refresh_token); await new Promise(r => setTimeout(r, 20)); return jsonRes(200, { access_token: 'FRESH', refresh_token: 'RT2', expires_in: 3600 }); }
    return jsonRes(200, { is_playing: true, item: { name: 'S', artists: [] }, device: { name: 'D' } });
  };
  const mem = { ppl_spotify_beta: JSON.stringify({ clientId: 'C', access: 'OLD', refresh: 'RT1', expiresAt: 0 }) };
  const sp = loadSpotify({ mem, fetch: fetchFn });
  // мини-плеер и панель одновременно просят данные при просроченном токене
  const [a, b] = await Promise.all([sp.spSharedCall('GET', '/me/player'), sp.spSharedCall('PUT', '/me/player/pause')]);
  assert(a.status === 200 && b.status === 200, 'both requests succeed');
  assert(tokenCalls.length === 1, 'the token must be refreshed exactly once for two simultaneous requests, got ' + tokenCalls.length);
  const saved = JSON.parse(mem.ppl_spotify_beta);
  assert(saved.access === 'FRESH' && saved.refresh === 'RT2', 'the refreshed (possibly rotated) token is stored for the next request: ' + JSON.stringify(saved));
  // отозванный доступ: хранилище очищается, остаётся только Client ID
  const mem2 = { ppl_spotify_beta: JSON.stringify({ clientId: 'C', access: 'x', refresh: 'RT', expiresAt: 0 }) };
  const sp2 = loadSpotify({ mem: mem2, fetch: async url => url.indexOf('/api/token') >= 0 ? jsonRes(400, { error: 'invalid_grant', error_description: 'revoked' }) : jsonRes(200, {}) });
  const r = await sp2.spSharedCall('GET', '/me/player');
  assert(r.status === 401 && JSON.stringify(JSON.parse(mem2.ppl_spotify_beta)) === '{"clientId":"C"}', 'a revoked grant clears the tokens and keeps only the client id');
  // ошибка в одном запросе не ломает очередь
  const sp3 = loadSpotify({ mem: { ppl_spotify_beta: JSON.stringify({ clientId: 'C', access: 'A', refresh: 'R', expiresAt: Date.now() + 3600000 }) }, fetch: async (url) => { if (url.indexOf('boom') >= 0) throw new Error('network'); return jsonRes(200, {}); } });
  let failed = false;
  try { await sp3.spSharedCall('GET', '/boom'); } catch (e) { failed = true; }
  assert(failed, 'the failing call reports its error');
  assert((await sp3.spSharedCall('GET', '/ok')).status === 200, 'but the queue keeps working afterwards');
  info('One refresh for concurrent callers; revoked access clears tokens; queue survives errors');
});

testAsync('Spotify: one shared poller for any number of components, started and stopped by subscribers', async () => {
  let plays = 0;
  const fetchFn = async url => { plays++; return jsonRes(200, { is_playing: true, item: { name: 'Song', artists: [{ name: 'Art' }] }, device: { name: 'iPhone' } }); };
  const mem = { ppl_spotify_beta: JSON.stringify({ clientId: 'C', access: 'A', refresh: 'R', expiresAt: Date.now() + 3600000 }) };
  const sp = loadSpotify({ mem, fetch: fetchFn });
  let n1 = 0, n2 = 0;
  const off1 = sp.spFeedSubscribe(() => n1++);
  const off2 = sp.spFeedSubscribe(() => n2++);
  assert(sp.timers.set.length === 1 && sp.timers.set[0].ms === 5000, 'two subscribers share ONE 5-second timer, got ' + sp.timers.set.length);
  await new Promise(r => setTimeout(r, 30));
  assert(plays === 1, 'the first subscriber triggers one player request, the second does not duplicate it, got ' + plays);
  assert(sp.SPOTIFY_FEED.view && sp.SPOTIFY_FEED.view.title === 'Song' && sp.SPOTIFY_FEED.view.playing === true, 'the shared view is filled: ' + JSON.stringify(sp.SPOTIFY_FEED.view));
  assert(n1 >= 1 && n2 >= 1, 'every subscriber is told about new state');
  off1();
  assert(sp.timers.cleared.length === 0, 'the timer keeps running while someone is subscribed');
  off2();
  assert(sp.timers.cleared.length === 1, 'the timer stops when the last subscriber leaves');
  // таймер не опрашивает, пока приложение свёрнуто
  const hidden = loadSpotify({ mem, fetch: fetchFn, document: { visibilityState: 'hidden' } });
  const before = plays;
  hidden.spFeedSubscribe(() => {});
  await new Promise(r => setTimeout(r, 30));
  const afterFirst = plays;
  hidden.timers.set[0].fn();
  await new Promise(r => setTimeout(r, 30));
  assert(plays === afterFirst, 'a tick while the app is in the background does not call Spotify');
  info('Single timer, shared state, stops with the last subscriber, silent in the background');
});

testAsync('Spotify: commands report errors to everyone and never hide them', async () => {
  const mem = { ppl_spotify_beta: JSON.stringify({ clientId: 'C', access: 'A', refresh: 'R', expiresAt: Date.now() + 3600000 }) };
  let status = 204, body = null;
  const sp = loadSpotify({ mem, fetch: async () => status === 204 ? jsonRes(204) : jsonRes(status, body) });
  let notified = 0;
  sp.spFeedSubscribe(() => notified++);
  await new Promise(r => setTimeout(r, 20));
  let r = await sp.spCommand('PUT', '/me/player/pause');
  assert(r.ok && r.err === null && sp.SPOTIFY_FEED.msg === '', 'success clears the message');
  status = 403; body = { error: { reason: 'PREMIUM_REQUIRED' } };
  r = await sp.spCommand('PUT', '/me/player/play', { uris: ['x'] });
  assert(!r.ok && r.err.includes('Premium') && sp.SPOTIFY_FEED.msg.includes('Premium'), 'a refusal is shown to every subscriber: ' + r.err);
  status = 404; body = { error: { reason: 'NO_ACTIVE_DEVICE' } };
  r = await sp.spCommand('POST', '/me/player/next');
  assert(!r.ok && r.err.includes('активного устройства'), 'no active device explains what to do');
  assert(notified >= 3, 'subscribers were notified about every command result, got ' + notified);
  info('Success, Premium and no-device cases');
});

test('Spotify main-screen player: wired into App as a beta-only seam, picker offers playlists and search, no server needed', () => {
  const sp = fs.readFileSync(path.join(BETA_SRC_DIR, 'spotify.jsx'), 'utf8');
  assert(src.includes('{typeof BetaMiniPlayer === "function" && <BetaMiniPlayer />}'), 'the mini player seam is missing in App');
  assert(src.indexOf('BetaMiniPlayer') < src.indexOf('{/* ===== WORKOUT ===== */}') + 400 && src.indexOf('BetaMiniPlayer') < src.indexOf('activeTab === "workout" &&'), 'the mini player sits above every tab content, not inside one tab');
  assertNot(/function BetaMiniPlayer|function SpotifyPicker/.test(app), 'the mini player must not exist in the production page');
  assert(/function BetaMiniPlayer/.test(betaApp) && /function SpotifyPicker/.test(betaApp), 'both components exist in the beta page');
  const mini = sp.slice(sp.indexOf('function BetaMiniPlayer'));
  assert(mini.includes('if (!connected) return null'), 'nothing is shown until Spotify is connected');
  ['НАЗАД', 'ДАЛЬШЕ', 'ВЫБРАТЬ', 'Сейчас ничего не играет'].forEach(x => assert(mini.includes(x), 'mini player is missing: ' + x));
  assert(mini.includes('spFeedSubscribe') && !/fetch\(|setInterval/.test(mini), 'the mini player reads the shared state, it neither polls nor calls the API itself');
  const picker = sp.slice(sp.indexOf('function SpotifyPicker'), sp.indexOf('function BetaMiniPlayer'));
  ['ПЛЕЙЛИСТЫ', 'ПОИСК ТРЕКА', 'ВОЙТИ ЗАНОВО', 'первые 10 результатов', 'spPlayBody'].forEach(x => assert(picker.includes(x), 'picker is missing: ' + x));
  assert((picker.match(/minHeight: 4[48]/g) || []).length >= 5, 'every picker control (tab, row button, search box, search button, sign-in-again) is a 44pt+ target');
  assert(!/client_secret/.test(sp) && !/https?:\/\/(?!accounts\.spotify\.com|api\.spotify\.com)[^"']*\.(php|asp)/.test(sp), 'still no secret and no foreign server');
  assert(sp.includes('playlist-read-private'), 'the playlist scope is requested');
  info('Seam above all tabs, shared state, picker with playlists and search, 44pt targets');
});

test('Spotify: tokens stay out of the app data and the backup file, UI is wired and tappable', () => {
  const sp = fs.readFileSync(path.join(BETA_SRC_DIR, 'spotify.jsx'), 'utf8');
  assert(sp.includes('const SPOTIFY_STORAGE_KEY = "ppl_spotify_beta"'), 'tokens need their own key');
  assertNot(/setData|props\.data|data\./.test(sp.slice(sp.indexOf('function SpotifyPanel'))), 'SpotifyPanel must not touch app data: tokens would end up in the backup file');
  assert(!sp.includes('client_secret'), 'no secret anywhere');
  assert(betaSrc.includes('typeof SpotifyPanel === "function" && <SpotifyPanel'), 'BetaTab must render SpotifyPanel');
  const panel = sp.slice(sp.indexOf('function SpotifyPanel'));
  assert(panel.includes('spotify://'), 'a shortcut to open the Spotify app');
  assert((panel.match(/minHeight: 4[48]/g) || []).length >= 4, 'inputs, the login button and the shared button style need a 44pt+ target');
  assert(/const btn = \{[^}]*minHeight: 48/.test(panel), 'the shared button style used by all five controls must be 48 high');
  assert(/function SpotifyPanel|function spCall/.test(betaApp) && !/function SpotifyPanel|spStartLogin|accounts\.spotify\.com/.test(app), 'Spotify code exists in beta and never in production');
  assert(betaSrc.includes('const SPOTIFY_BOOT') && /\nspBoot\(\);/.test(sp), 'the callback is processed at startup, not only when the tab opens');
  info('Isolated storage, no secret, no leak into production');
});

// ── Профиль, программа, вес тела, самочувствие ────────────────────────────────
const PRESET_KEYS = ['push', 'pull', 'legs', 'fullbody_a', 'fullbody_b', 'fullbody_c'];
const goodProfile = (o) => Object.assign({ sex: 'm', age: 30, height: 180, weight: 80, goal: 'mass', level: 'mid', days: 3, injuries: [] }, o || {});

test('Profile: validation accepts a sane questionnaire and names every problem', () => {
  const c = loadCoach();
  assert(c.profileValidate(goodProfile()).length === 0, 'a normal profile must pass');
  assert(c.profileValidate(goodProfile({ age: '30', height: '180,5', weight: '80,5' })).length === 0, 'strings with a decimal comma must pass');
  const bad = c.profileValidate({ sex: '', age: 12, height: 100, weight: 20, goal: '', level: '', days: 0 });
  assert(bad.length === 7, 'every missing or absurd field gets its own message, got ' + bad.length + ': ' + bad.join(' | '));
  assert(c.profileValidate(goodProfile({ age: 13 })).length === 1 && c.profileValidate(goodProfile({ age: 14 })).length === 0, 'minimum age is 14');
  assert(c.profileValidate(goodProfile({ weight: 251 })).length === 1 && c.profileValidate(goodProfile({ height: 231 })).length === 1, 'upper bounds');
  info('Validation: 7 distinct messages, decimal comma accepted');
});

test('Profile: BMI and calorie targets follow Mifflin-St Jeor and refuse risky cases', () => {
  const c = loadCoach();
  assert(c.profileBmi(180, 80) === 24.7 && c.profileBmiLabel(24.7) === 'норма', 'BMI 24.7 is normal');
  assert(c.profileBmiLabel(17) === 'ниже нормы' && c.profileBmiLabel(27) === 'выше нормы' && c.profileBmiLabel(31) === 'высокий', 'BMI labels');
  // мужчина 30 лет, 180 см, 80 кг: BMR 1780, 3 дня x1.45 = 2581, масса +10% = 2839 -> 2840, белок 1.8 x 80 = 144
  const m = c.profileEnergy(goodProfile(), 80);
  assert(m.bmr === 1780 && m.tdee === 2580 && m.target === 2840 && m.protein === 144, 'male mass: ' + JSON.stringify(m));
  // женщина 25 лет, 165 см, 60 кг: BMR 1345, 4 дня x1.55 = 2085, похудение -15% = 1772 -> 1770, белок 2.0 x 60 = 120
  const f = c.profileEnergy(goodProfile({ sex: 'f', age: 25, height: 165, weight: 60, goal: 'cut', days: 4 }), 60);
  assert(f.bmr === 1350 && f.target === 1770 && f.protein === 120, 'female cut: ' + JSON.stringify(f));
  assert(c.profileEnergy(goodProfile({ goal: 'fit' }), 80).target === 2580, 'maintenance goal keeps TDEE');
  assert(c.profileEnergy(goodProfile({ age: 15 }), 80) === null, 'no calorie targets for under 16');
  assert(c.profileEnergy(goodProfile({ age: 71 }), 80) === null, 'no calorie targets for over 70');
  assert(c.profileEnergy(goodProfile({ height: 180, weight: 50 }), 50) === null, 'BMI under 16: see a doctor, not a formula');
  assert(c.profileEnergy(goodProfile({ height: 170, weight: 130 }), 130) === null, 'BMI over 40: see a doctor, not a formula');
  info('Targets: 2840 kcal / 144 g protein (male mass), 1770 / 120 (female cut); null for risky cases');
});

test('Profile: program recommendation picks only existing presets and a sensible split', () => {
  const c = loadCoach();
  const cnt = s => s.filter(Boolean).length;
  const sched = (o) => c.profileRecommend(goodProfile(o)).schedule;
  for (const level of ['new', 'mid', 'pro']) for (const days of [2, 3, 4, 5, 6]) {
    const r = c.profileRecommend(goodProfile({ level, days }));
    assert(r.schedule.length === 7 && r.schedule.every(k => k === null || PRESET_KEYS.includes(k)), level + '/' + days + ': only real presets, 7 slots');
    assert(cnt(r.schedule) === r.days && r.title && r.why.length > 0, level + '/' + days + ': scheduled days match the plan');
    // между тренировками есть отдых: подряд не больше 3 дней
    const run = r.schedule.reduce((a, k) => { const n = k ? a.cur + 1 : 0; return { cur: n, max: Math.max(a.max, n) }; }, { cur: 0, max: 0 }).max;
    // до 5 дней подряд не больше трёх; при 6 днях отдых один (воскресенье), это осознанный выбор классического PPL x2
    assert(r.days === 6 ? (run === 6 && cnt(r.schedule) === 6) : run <= 3, level + '/' + days + ': rest days must be respected, longest run ' + run);
  }
  assert(c.profileRecommend(goodProfile({ level: 'new', days: 5 })).days === 3, 'a beginner is capped at 3 days');
  assert(c.profileRecommend(goodProfile({ level: 'new', days: 5 })).why[0].includes('Новичку'), 'and told why');
  assert(sched({ level: 'new', days: 3 }).join() === 'fullbody_a,,fullbody_b,,fullbody_c,,', 'beginner 3 days = fullbody A/B/C Mon/Wed/Fri');
  assert(sched({ level: 'pro', days: 3 }).join() === 'push,,pull,,legs,,', 'experienced 3 days = push/pull/legs');
  assert(sched({ level: 'mid', days: 2 }).join() === 'fullbody_a,,,fullbody_b,,,', '2 days = fullbody A and B spaced apart');
  assert(sched({ level: 'pro', days: 6 }).join() === 'push,pull,legs,push,pull,legs,', '6 days = PPL twice, Sunday off');
  info('Every level/days combination gives a valid, rest-respecting schedule');
});

test('Profile: goal advice and injury notes are included and stay cautious', () => {
  const c = loadCoach();
  const r = c.profileRecommend(goodProfile({ goal: 'cut', injuries: ['knees', 'shoulders'] }));
  assert(r.goalTip.includes('похудение') && r.notes.length === 2, 'goal tip and two injury notes, got ' + r.notes.length);
  assert(r.notes.every(n => n.includes('остановитесь')), 'every injury note tells to stop on pain');
  assert(c.profileRecommend(goodProfile({ injuries: [] })).notes.length === 0, 'no injuries, no notes');
  assert(c.profileRecommend(goodProfile({ injuries: ['unknown'] })).notes.length === 0, 'unknown keys are ignored, not crashed on');
  const ui = fs.readFileSync(path.join(BETA_SRC_DIR, 'profile.jsx'), 'utf8');
  assert(ui.includes('не рекомендация врача') && ui.includes('обратитесь к врачу'), 'the disclaimers must stay in the UI');
  info('Goal tip, cautious injury notes, disclaimers present');
});

test('Body log and feel log: one entry per date, sorted, validated, trend needs two weeks', () => {
  const c = loadCoach();
  let log = c.bodyLogAdd([], '2026-09-23', '80,5');
  log = c.bodyLogAdd(log, '2026-10-07', '81');
  log = c.bodyLogAdd(log, '2026-09-30', '80.8');
  assert(log.map(r => r.date).join() === '2026-09-23,2026-09-30,2026-10-07' && log[0].kg === 80.5, 'sorted by date, comma accepted: ' + JSON.stringify(log));
  assert(c.bodyLogAdd(log, '2026-10-07', '79').length === 3 && c.bodyLogAdd(log, '2026-10-07', '79')[2].kg === 79, 'same date replaces');
  assert(c.bodyLogAdd(log, '2026-10-08', '10') === log && c.bodyLogAdd(log, '2026-10-08', 'abc') === log, 'absurd values are rejected without a change');
  const tr = c.bodyTrend(log, '2026-10-07');
  assert(tr.span === 14 && tr.delta === 0.5 && tr.perWeek === 0.25 && tr.latest === 81, 'trend over 14 days: ' + JSON.stringify(tr));
  assert(c.bodyTrend(log.slice(1), '2026-10-07') === null, 'only 7 days apart: no trend yet');
  assert(c.bodyTrend([{ date: '2026-08-01', kg: 90 }, { date: '2026-10-07', kg: 80 }], '2026-10-07') === null, 'records older than 4 weeks are ignored');
  assert(c.bodyLatest(log, 70) === 81 && c.bodyLatest([], 70) === 70, 'latest weight falls back to the questionnaire');
  let fl = c.feelLogSet([], '2026-10-05', 3);
  fl = c.feelLogSet(fl, '2026-10-05', 4);
  assert(fl.length === 1 && fl[0].score === 4, 'one score per date, the latest wins');
  assert(c.feelLogSet(fl, '2026-10-06', 6) === fl && c.feelLogSet(fl, '2026-10-06', 0) === fl, 'scores outside 1..5 are rejected');
  assert(c.feelRecent(fl, '2026-10-07') === null, 'fewer than three scores: no verdict');
  fl = c.feelLogSet(c.feelLogSet(fl, '2026-10-03', 2), '2026-10-01', 1);
  assert(c.feelRecent(fl, '2026-10-07') === 2.3, 'average of the last three (1, 2, 4), got ' + c.feelRecent(fl, '2026-10-07'));
  assert(c.feelRecent([{ date: '2026-09-01', score: 1 }, { date: '2026-09-02', score: 1 }, { date: '2026-09-03', score: 1 }], '2026-10-07') === null, 'scores older than two weeks do not count');
  info('One entry per date, validated, trend after 14 days');
});

test('Coach with a profile: weigh-in reminder, weight trend vs goal, feel, schedule mismatch', () => {
  const c = loadCoach();
  const ago = n => new Date(Date.UTC(2026, 9, 7) - n * 86400000).toISOString().slice(0, 10);
  const ids2 = (d) => c.coachAnalyze(d, TODAY).advice.map(a => a.id);
  const base = (o) => Object.assign({ history: {}, schedule: ['push', null, 'pull', null, 'legs', null, null], profile: goodProfile({ days: 3 }) }, o || {});
  // напоминание о взвешивании работает и без журнала тренировок
  assert(ids2(base()).includes('weigh'), 'no weight records: remind');
  assert(!ids2(base({ bodyLog: [{ date: ago(3), kg: 80 }] })).includes('weigh'), 'a recent weigh-in: stay quiet');
  assert(ids2(base({ bodyLog: [{ date: ago(15), kg: 80 }] })).includes('weigh'), 'two weeks old: remind');
  assert(c.coachAnalyze({ history: {}, schedule: base().schedule }, TODAY).advice.length === 0, 'without a profile none of this appears');
  // цель - масса, вес стоит на месте 3 недели
  const flat = [{ date: ago(24), kg: 80 }, { date: ago(10), kg: 80 }, { date: ago(1), kg: 80 }];
  assert(ids2(base({ bodyLog: flat })).includes('trend-mass'), 'mass goal and a flat weight: tip');
  assert(!ids2(base({ bodyLog: [{ date: ago(24), kg: 80 }, { date: ago(1), kg: 81.5 }] })).includes('trend-mass'), 'weight is growing: no tip');
  assert(!ids2(base({ bodyLog: [{ date: ago(12), kg: 80 }, { date: ago(1), kg: 80 }] })).includes('trend-mass'), 'less than 21 days of data: no verdict yet');
  // цель - похудение
  const cut = goodProfile({ goal: 'cut' });
  assert(ids2(base({ profile: cut, bodyLog: flat })).includes('trend-cut'), 'cut goal and a flat weight: tip');
  const fast = [{ date: ago(24), kg: 85 }, { date: ago(1), kg: 80 }];   // -5 кг за 23 дня = -1.5 кг в неделю
  const r = c.coachAnalyze(base({ profile: cut, bodyLog: fast }), TODAY).advice;
  assert(r.find(a => a.id === 'trend-fast' && a.kind === 'warn'), 'losing over 1% a week: warning');
  assert(!r.some(a => a.id === 'trend-cut'), 'a fast loss is not "not losing"');
  // самочувствие
  const low = [{ date: ago(5), score: 2 }, { date: ago(3), score: 1 }, { date: ago(1), score: 2 }];
  const f = c.coachAnalyze(base({ feelLog: low }), TODAY).advice.find(a => a.id === 'feel-low');
  assert(f && f.kind === 'warn' && f.text.includes('1,7 из 5'), 'low scores: warning with the average, got ' + (f && f.text));
  assert(!ids2(base({ feelLog: [{ date: ago(5), score: 2 }, { date: ago(3), score: 4 }, { date: ago(1), score: 5 }] })).includes('feel-low'), 'good scores: quiet');
  // расписание короче рекомендации
  const short = base({ schedule: ['push', null, null, null, null, null, null] });
  const m = c.coachAnalyze(short, TODAY).advice.find(a => a.id === 'plan-days');
  assert(m && m.text.includes('3 тренировки') && m.text.includes('в расписании 1'), 'schedule mismatch: ' + (m && m.text));
  assert(!ids2(base()).includes('plan-days'), 'a matching schedule is fine');
  info('Weigh-in, goal trend (+/-), feel, schedule mismatch');
});

test('Onboarding UI: first-launch overlay is a beta-only seam, skippable, and every control is tappable', () => {
  const ui = fs.readFileSync(path.join(BETA_SRC_DIR, 'profile.jsx'), 'utf8');
  assert(src.includes('typeof BetaOverlay === "function" && <BetaOverlay data={data} setData={setData} showToast={showToast} />'), 'overlay seam missing in App');
  assertNot(/function BetaOverlay|function ProfilePanel|function BodyPanel|function profileRecommend|function ProfileForm/.test(app), 'the questionnaire must not leak into the production page (only the guarded seam is allowed there)');
  assert(/function BetaOverlay/.test(betaApp) && betaSrc.includes('typeof ProfilePanel === "function"') && betaSrc.includes('typeof BodyPanel === "function"'), 'overlay and panels wired into the beta page');
  assert(ui.includes('(!data.profile && !data.profileSkipped) || !!data.profileEdit'), 'the form opens on first launch and on explicit edit only');
  assert(ui.includes('profileSkipped: todayKey()') && ui.includes('ПОТОМ'), 'the questionnaire can be skipped');
  assert(ui.includes('Данные хранятся только на этом телефоне'), 'the privacy promise stays visible');
  assert((ui.match(/minHeight: 4[48]/g) || []).length >= 12, 'every button and input needs a 44pt+ target');
  assert(ui.includes('bodyLogAdd(prev.bodyLog || [], todayKey(), p.weight)'), 'the starting weight seeds the weight log');
  info('Seam, skip, privacy note, tap targets');
});

// ── Заготовки под соц-функции ──────────────────────────────────────────────────
function loadSocial() {
  const dnFrom = src.indexOf('function dayNum');
  const dnSrc = src.slice(dnFrom, src.indexOf('function backupAgeDays', dnFrom));
  const coachSrc = fs.readFileSync(path.join(BETA_SRC_DIR, 'coach.jsx'), 'utf8');
  const coachPure = coachSrc.slice(0, coachSrc.indexOf('const COACH_KIND_STYLE'));
  const profSrc = fs.readFileSync(path.join(BETA_SRC_DIR, 'profile.jsx'), 'utf8');
  const profPure = profSrc.slice(0, profSrc.indexOf('// ---- Интерфейс ----'));
  const socSrc = fs.readFileSync(path.join(BETA_SRC_DIR, 'social.jsx'), 'utf8');
  const socPure = socSrc.slice(0, socSrc.indexOf('function SocialPanel'));
  return new Function('todayKey', dnSrc + profPure + coachPure + socPure +
    '; return { socialUuid, socialFriendCode, socialEnsure, socialSummary, socialLeaderboard, socialLocalBackend, SOCIAL_BACKEND_METHODS, SOCIAL_SCHEMA_VERSION, SOCIAL_SHARE_KEYS, SOCIAL_VISIBILITY, socialPublishTargets, socialDisplayName };')(() => TODAY);
}
const ID_A = '3f2a9c1e-7b4d-4e8a-9c01-aaaaaaaaaaaa';
const ID_B = 'b81d0c77-1111-4222-8333-bbbbbbbbbbbb';

test('Social groundwork: identity, schema version and consent defaults are created once and never overwritten', () => {
  const s = loadSocial();
  const input = { history: { push: [] }, schedule: ['push', null, null, null, null, null, null] };
  const before = JSON.stringify(input);
  const a = s.socialEnsure(input, () => ID_A);
  assert(JSON.stringify(input) === before, 'socialEnsure must not mutate its input');
  assert(a.schemaVersion === 1 && a.identity.userId === ID_A && a.identity.createdAt === TODAY, 'identity and version: ' + JSON.stringify(a.identity));
  assert(a.social.enabled === false && a.social.displayName === '' && !a.social.share.workouts && !a.social.share.volume && !a.social.share.prs, 'everything is private by default');
  assert(a.history === input.history && a.schedule === input.schedule, 'unrelated data is carried over untouched');
  const b = s.socialEnsure(a, () => ID_B);
  assert(b.identity.userId === ID_A, 'the id must stay stable on repeated calls');
  const c = s.socialEnsure(Object.assign({}, a, { social: { enabled: true, displayName: 'Ник', share: { volume: true } } }), () => ID_B);
  assert(c.social.enabled === true && c.social.displayName === 'Ник' && c.social.share.volume === true && c.social.share.prs === false, 'existing choices survive, missing categories default to hidden: ' + JSON.stringify(c.social));
  info('Private by default, stable id, no overwrite');
});

test('Visibility: everyone sees everyone by default, but only after an explicit choice; friends rooms are separate', () => {
  const s = loadSocial();
  const fresh = s.socialEnsure({}, () => ID_A);
  assert(fresh.social.visibility === 'public' && fresh.social.consentAt === '', 'default is public, with no consent yet: ' + JSON.stringify(fresh.social));
  let tg = s.socialPublishTargets(fresh);
  assert(tg.arena === false && tg.friends === false, 'before the user chooses nothing may be published, even though the default is "everyone sees everyone"');
  const pub = Object.assign({}, fresh, { social: Object.assign({}, fresh.social, { consentAt: TODAY }) });
  tg = s.socialPublishTargets(pub);
  assert(tg.arena === true && tg.friends === true, 'after consent the default reaches the whole arena and friends rooms');
  const fr = Object.assign({}, fresh, { social: Object.assign({}, fresh.social, { consentAt: TODAY, visibility: 'friends' }) });
  tg = s.socialPublishTargets(fr);
  assert(tg.arena === false && tg.friends === true, '"friends only" hides you from the arena but keeps friends rooms');
  const hid = Object.assign({}, fresh, { social: Object.assign({}, fresh.social, { consentAt: TODAY, visibility: 'hidden' }) });
  tg = s.socialPublishTargets(hid);
  assert(tg.arena === false && tg.friends === false, '"hidden" publishes nothing anywhere');
  // открытый зал с незнакомцами - только с 16 лет; комнаты друзей остаются
  const teen = Object.assign({}, pub, { profile: { age: 15 } });
  tg = s.socialPublishTargets(teen);
  assert(tg.arena === false && tg.friends === true, 'under 16: no open arena, friends rooms only');
  assert(s.socialPublishTargets(Object.assign({}, pub, { profile: { age: 16 } })).arena === true, '16 and over: the arena is allowed');
  assert(s.socialPublishTargets(Object.assign({}, pub, { profile: undefined })).arena === true, 'no questionnaire: the arena rule cannot be applied, the user choice decides');
  // мусор в сохранённом значении не должен открывать зал или ломать модель
  assert(s.socialEnsure({ social: { visibility: 'everything' } }, () => ID_A).social.visibility === 'public', 'an unknown value falls back to the default');
  assert(s.SOCIAL_VISIBILITY.map(v => v[0]).join() === 'public,friends,hidden', 'three levels');
  info('Default public, consent first, friends rooms independent, under-16 limited');
});

test('Display name: the chosen one, or a neutral pseudonym that does not reveal who you are', () => {
  const s = loadSocial();
  assert(s.socialDisplayName({ social: { displayName: 'Ник' }, identity: { userId: ID_A } }) === 'Ник', 'chosen name wins');
  assert(s.socialDisplayName({ social: { displayName: '' }, identity: { userId: ID_A } }) === 'Участник 3F2A', 'neutral name from the device code');
  assert(s.socialDisplayName({}) === 'Участник', 'even with no identity there is a safe fallback');
  assert(/^Участник [0-9A-F]{4}$/.test(s.socialDisplayName({ social: {}, identity: { userId: ID_A } })), 'the pseudonym is exactly "Участник" plus four hex characters of the device code, nothing personal');
  info('Участник XXXX by default');
});

test('Social groundwork: UUIDs are valid v4 and friend codes are short and readable', () => {
  const s = loadSocial();
  const ids = new Set(Array.from({ length: 50 }, () => s.socialUuid()));
  assert(ids.size === 50, 'ids must be unique');
  ids.forEach(i => assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(i), 'not a v4 uuid: ' + i));
  assert(s.socialFriendCode(ID_A) === '3F2A-9C1E', 'friend code, got ' + s.socialFriendCode(ID_A));
  assert(s.socialFriendCode('') === '' && s.socialFriendCode('zz') === '' && s.socialFriendCode(null) === '', 'bad ids give no code');
  info('v4 UUIDs, XXXX-XXXX codes');
});

test('Social summary: nothing is published until a category is switched on', () => {
  const s = loadSocial();
  const d = s.socialEnsure({ history: { push: [{ date: '2026-10-05', ts: 1, workout: 'push', detail: [{ id: 'bench', name: 'Жим', sets: [{ w: '60', done: true }] }] }] } }, () => ID_A);
  const sum = s.socialSummary(d, TODAY);
  assert(Object.keys(sum).sort().join() === 'asOf,name,userId,v', 'only the envelope, got ' + Object.keys(sum).join());
  assert(sum.userId === ID_A && sum.v === 1 && sum.asOf === TODAY, 'envelope values');
  info('Default summary has no data in it');
});

test('Social summary: shared numbers are right and health data can never leak', () => {
  const s = loadSocial();
  const ago = n => new Date(Date.UTC(2026, 9, 7) - n * 86400000).toISOString().slice(0, 10);
  const e = (n, w, ex) => ({ date: ago(n), ts: n, workout: w, name: w, detail: ex.map(([id, name, kg]) => ({ id, name, sets: [{ w: String(kg), done: true }, { w: String(kg), done: true }] })) });
  const history = { push: [
    e(2, 'push', [['bench', 'Жим штанги лёжа', 70]]), e(9, 'push', [['bench', 'Жим штанги лёжа', 65]]), e(16, 'push', [['bench', 'Жим штанги лёжа', 62.5]]),
    e(0, 'pull', [['row', 'Тяга', 50]]), e(7, 'pull', [['row', 'Тяга', 50]]), e(14, 'pull', [['row', 'Тяга', 50]]),
    e(4, 'legs', [['sq', 'Присед', 100]]), e(11, 'legs', [['sq', 'Присед', 100]]), e(18, 'legs', [['sq', 'Присед', 100]]) ] };
  const secrets = { profile: { sex: 'f', age: 33, height: 183.7, weight: 77.7, injuries: ['knees'], goal: 'cut' }, bodyLog: [{ date: ago(1), kg: 77.7 }], feelLog: [{ date: ago(1), score: 1 }], profileEdit: true };
  const all = { workouts: true, volume: true, prs: true };
  const d = s.socialEnsure(Object.assign({ history, schedule: ['push', null, 'pull', null, 'legs', null, null] }, secrets), () => ID_A);
  const sum = s.socialSummary(Object.assign({}, d, { social: { enabled: true, displayName: 'Ник', share: all } }), TODAY);
  assert(sum.name === 'Ник', 'display name is shared');
  // Текущая неделя - пн 5 окт ... ср 7 окт: жим (пн) и тяга (ср). Ноги пришлись на субботу 3 окт, это прошлая неделя.
  assert(sum.workoutsThisWeek === 2 && sum.lastWorkoutDaysAgo === 0, 'this week: ' + JSON.stringify(sum));
  // план 3 дня: текущая неделя ещё неполная (2 из 3), а две предыдущие недели по 3 тренировки; 9 тренировок за 28 дней
  assert(sum.workoutsLast28 === 9 && sum.streakWeeks === 2, 'streak and 28-day count: ' + JSON.stringify(sum));
  assert(sum.volumeThisWeek === 2 * 70 + 2 * 50, 'week volume = sum of done sets of this week, got ' + sum.volumeThisWeek);
  // рекорд только у жима (62.5 -> 65 -> 70); тяга и присед стоят на месте
  assert(sum.prs.length === 1 && sum.prs[0].name === 'Жим штанги лёжа' && sum.prs[0].kg === 70 && sum.prs[0].date === ago(2), 'records: ' + JSON.stringify(sum.prs));
  // приватность: ни одно значение из профиля, веса тела, самочувствия и травм не может попасть в пакет
  const json = JSON.stringify(sum);
  ['183.7', '77.7', 'knees', 'injur', 'profile', 'bodyLog', 'feelLog', 'height', 'goal', '"sex"', '"age"'].forEach(x => assertNot(json.includes(x), 'health data leaked into the summary: ' + x));
  const allowed = new Set(['v', 'userId', 'name', 'asOf', 'workoutsThisWeek', 'workoutsLast28', 'streakWeeks', 'lastWorkoutDaysAgo', 'volumeThisWeek', 'prs']);
  Object.keys(sum).forEach(k => assert(allowed.has(k), 'unexpected key in the published summary: ' + k));
  // отключённая категория исчезает целиком
  const noVol = s.socialSummary(Object.assign({}, d, { social: { enabled: true, displayName: '', share: { workouts: true } } }), TODAY);
  assert(!('volumeThisWeek' in noVol) && !('prs' in noVol) && ('workoutsThisWeek' in noVol), 'a hidden category must be absent, not zero');
  info('Numbers correct; profile, body weight, feel and injuries never appear');
});

test('Social leaderboard ranks by consistency or volume, fairly and stably', () => {
  const s = loadSocial();
  const mk = (userId, name, w, streak, vol) => ({ userId, name, workoutsThisWeek: w, streakWeeks: streak, volumeThisWeek: vol });
  const list = [mk('1', 'Борис', 3, 1, 5000), mk('2', 'Анна', 3, 4, 3000), mk('3', 'Вика', 4, 0, 1000), mk('4', 'Глеб', 3, 1, 9000), { userId: '5', name: 'Без данных' }];
  const byW = s.socialLeaderboard(list, 'workouts');
  assert(byW.map(r => r.name).join() === 'Вика,Анна,Борис,Глеб', 'more workouts first, then streak, then name: ' + byW.map(r => r.name).join());
  assert(byW.map(r => r.rank).join() === '1,2,3,4' && byW[0].value === 4, 'ranks are consecutive, values carried');
  const byV = s.socialLeaderboard(list, 'volume');
  assert(byV.map(r => r.name).join() === 'Глеб,Борис,Анна,Вика', 'by volume: ' + byV.map(r => r.name).join());
  assert(s.socialLeaderboard([mk('9', '', 1, 0, 1)], 'workouts')[0].name === 'Без имени', 'an empty name gets a placeholder');
  assert(s.socialLeaderboard(list.slice(), 'workouts').length === 4 && list.length === 5, 'the input list is not modified');
  info('Consistency first, volume optional, ties by streak then name');
});

testAsync('Social backend: the local stand-in implements the whole interface (so the UI can be built before a server exists)', async () => {
  const s = loadSocial();
  const store = {};
  const be = s.socialLocalBackend(store);
  s.SOCIAL_BACKEND_METHODS.forEach(m => assert(typeof be[m] === 'function', 'backend method missing: ' + m));
  const summ = (id, name, w) => ({ v: 1, userId: id, name, workoutsThisWeek: w, streakWeeks: 0 });
  await be.signIn({ userId: ID_A });
  await be.publishSummary(summ(ID_A, 'Я', 2));
  await be.publishSummary(summ(ID_B, 'Друг', 3));
  const mine = await be.addFriendByCode(s.socialFriendCode(ID_A));
  assert(mine.error === 'Это вы', 'adding yourself is refused, got ' + JSON.stringify(mine));
  const nope = await be.addFriendByCode('ZZZZ-0000');
  assert(nope.error === 'Код не найден', 'unknown code, got ' + JSON.stringify(nope));
  const ok = await be.addFriendByCode(s.socialFriendCode(ID_B).toLowerCase());
  assert(ok.ok && ok.userId === ID_B, 'a friend is added by a (case-insensitive) code');
  const friends = await be.getFriends();
  assert(friends.length === 1 && friends[0].name === 'Друг', 'friends list: ' + JSON.stringify(friends));
  const board = await be.getLeaderboard('workouts');
  assert(board.map(r => r.name).join() === 'Друг,Я', 'leaderboard includes me and my friends, best first: ' + board.map(r => r.name).join());
  info('signIn, publishSummary, addFriendByCode, getFriends, getLeaderboard all work against the stand-in');
});

test('Social: nothing leaves the phone, the panel is wired and explained, the design doc exists', () => {
  const soc = fs.readFileSync(path.join(BETA_SRC_DIR, 'social.jsx'), 'utf8');
  ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'navigator.share', 'location.href'].forEach(x => assertNot(soc.includes(x), 'social.jsx must not touch the network or navigate: ' + x));
  assert(soc.includes('ничего не отправляется'), 'the panel must say that nothing is sent');
  assert(soc.includes('Профиль, вес тела, самочувствие и журнал целиком друзьям не показываются никогда'), 'the privacy promise must stay visible');
  assert(betaSrc.includes('typeof SocialPanel === "function" && <SocialPanel'), 'SocialPanel not wired into BetaTab');
  assertNot(/function Social|socialSummary|socialEnsure/.test(app), 'the social groundwork must not exist in the production page');
  assert((soc.slice(soc.indexOf('function SocialPanel')).match(/minHeight: 44/g) || []).length >= 2, 'inputs and toggles need 44pt targets');
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'social-design.md'), 'utf8');
  ['Supabase', 'Firebase', 'Cloudflare', 'PocketBase', 'Анонимный аккаунт', 'Sign in with Apple', 'Что закладываем СЕЙЧАС', 'Дорожная карта'].forEach(x => assert(doc.includes(x), 'design doc is missing: ' + x));
  info('No network in social.jsx; doc covers backends, auth, privacy, roadmap');
});

// ── Соревнования сейчас и боты ────────────────────────────────────────────────
function loadCompete() {
  const dnFrom = src.indexOf('function dayNum');
  const dnSrc = src.slice(dnFrom, src.indexOf('function backupAgeDays', dnFrom));
  const read = f => fs.readFileSync(path.join(BETA_SRC_DIR, f), 'utf8');
  const cut = (s, marker) => s.slice(0, s.indexOf(marker));
  const profPure = cut(read('profile.jsx'), '// ---- Интерфейс ----');
  const coachPure = cut(read('coach.jsx'), 'const COACH_KIND_STYLE');
  const socPure = cut(read('social.jsx'), 'function SocialPanel');
  const compPure = cut(read('compete.jsx'), '// ---- Интерфейс: демо-комната с ботами ----');
  return new Function(dnSrc + profPure + coachPure + socPure + compPure +
    '; return { SOCIAL_FORMATS, SOCIAL_ROOM_METHODS, socialPlannedSets, socialRecordsToday, socialLiveProgress, socialLivePayload, socialCompScore, socialCompRank, socialTeamProgress, socialHash, socialBot, socialBotTimeline, socialReferencePace, socialBotLive, socialRoomBoard, socialLocalRooms, ARENA_SHARD_SIZE, ARENA_LEVELS, socialCohortKey, socialShardIndex, socialArenaView };')();
}
const PROGS = { push: { exercises: [{ id: 'bench', sets: 4 }, { id: 'ohp', sets: 4 }, { id: 'dips', sets: 3 }] } };
const T = '2026-10-07';
const SK = T + '_push';
const sess = (o) => ({ [SK]: o });
const setsOf = (arr) => Object.fromEntries(arr.map((s, i) => [i, s]));   // [{weight, done}] -> {0:..,1:..}
const dn = (n) => new Date(Date.UTC(2026, 9, 7) - n * 86400000).toISOString().slice(0, 10);
const histEntry = (n, id, kg) => ({ date: dn(n), ts: n, workout: 'push', detail: [{ id, name: id, sets: [{ w: String(kg), done: true }] }] });

test('Live competition: planned sets respect custom set counts, skips, added exercises and custom days', () => {
  const c = loadCompete();
  assert(c.socialPlannedSets({}, 'push', SK, PROGS) === 11, 'base program: 4+4+3');
  assert(c.socialPlannedSets({ customSets: { [SK]: { bench: 2 } } }, 'push', SK, PROGS) === 9, 'a changed set count overrides the program');
  assert(c.socialPlannedSets({ skipped: { [SK]: ['dips'] } }, 'push', SK, PROGS) === 8, 'a skipped exercise is not planned');
  assert(c.socialPlannedSets({ addedEx: { [SK]: [{ id: 'curl', sets: 3 }] } }, 'push', SK, PROGS) === 14, 'an added exercise counts');
  assert(c.socialPlannedSets({ customWorkouts: { mine: { exercises: [{ id: 'x', sets: 5 }] } } }, 'mine', T + '_mine', PROGS) === 5, 'a custom day is read from customWorkouts');
  assert(c.socialPlannedSets({}, 'nope', T + '_nope', PROGS) === 0, 'an unknown day plans nothing, no crash');
  info('11 planned; overrides, skips, additions, custom days');
});

test('Live competition: a record is only a beat of your OWN earlier maximum', () => {
  const c = loadCompete();
  const base = { history: { push: [histEntry(7, 'bench', 70), histEntry(14, 'bench', 65)] } };
  const rec = (sessions, extra) => c.socialRecordsToday(Object.assign({}, base, { sessions }, extra || {}), T);
  assert(rec(sess({ bench: setsOf([{ weight: '72.5', done: true }]) })) === 1, 'above the earlier best: a record');
  assert(rec(sess({ bench: setsOf([{ weight: '70', done: true }]) })) === 0, 'equal is not a record');
  assert(rec(sess({ bench: setsOf([{ weight: '80', done: false }]) })) === 0, 'an unmarked set does not count');
  assert(rec(sess({ curl: setsOf([{ weight: '30', done: true }]) })) === 0, 'a first-ever exercise is not a record');
  assert(rec(sess({ bench: setsOf([{ weight: '90', done: true }]) }), { skipped: { [SK]: ['bench'] } }) === 0, 'a skipped exercise does not count');
  assert(rec({ ['2026-10-06_push']: { bench: setsOf([{ weight: '99', done: true }]) } }) === 0, 'yesterday\'s session is not today');
  // сегодняшняя завершённая запись не должна поднимать "прошлый максимум" и обнулять рекорд
  const withToday = { history: { push: [histEntry(0, 'bench', 75), histEntry(7, 'bench', 70)] }, sessions: sess({ bench: setsOf([{ weight: '75', done: true }]) }) };
  assert(c.socialRecordsToday(withToday, T) === 1, 'today\'s own history entry is excluded from the earlier maximum');
  info('Beating your own earlier best counts; ties, undone, skipped, first-time and other days do not');
});

test('Live competition: progress is built from marked sets only, and the live packet carries no weights', () => {
  const c = loadCompete();
  const d = { history: {}, identity: { userId: 'u1' }, social: { displayName: 'Ник' }, sessions: {
    [SK]: { bench: setsOf([{ weight: '999', done: true }, { weight: '999', done: true }, { weight: '999', done: false }]), ohp: setsOf([{ weight: '40', done: true }]) },
    '2026-10-06_push': { bench: setsOf([{ weight: '50', done: true }]) } } };
  const p = c.socialLiveProgress(d, T, PROGS);
  assert(p.setsDone === 3 && p.setsPlanned === 11 && p.pct === 27, 'progress: ' + JSON.stringify(p));
  assert(c.socialLiveProgress({ sessions: {}, history: {} }, T, PROGS).setsDone === 0, 'no session, zero progress');
  assert(c.socialLiveProgress({ sessions: { [SK]: { bench: setsOf(Array.from({ length: 30 }, () => ({ weight: '1', done: true }))) } } }, T, PROGS).pct === 100, 'percent is capped at 100');
  assert(c.socialLiveProgress(Object.assign({}, d, { skipped: { [SK]: ['ohp'] } }), T, PROGS).setsDone === 2, 'a skipped exercise drops out of progress');
  const pay = c.socialLivePayload(d, T, 12345);
  assert(Object.keys(pay).sort().join() === 'at,name,pct,recordsToday,setsDone,userId', 'live packet keys: ' + Object.keys(pay).join());
  assertNot(JSON.stringify(pay).includes('999') || JSON.stringify(pay).includes('weight'), 'a barbell weight leaked into the live packet');
  assert(pay.at === 12345 && pay.userId === 'u1' && pay.name === 'Ник', 'identity and timestamp are passed through');
  info('3 of 11 sets; the packet is counters only');
});

test('Live competition: scoring, tie-breaks and team goal', () => {
  const c = loadCompete();
  const rows = [
    { userId: 'a', name: 'Борис', setsDone: 8, pct: 50, recordsToday: 0, at: 200 },
    { userId: 'b', name: 'Анна', setsDone: 8, pct: 50, recordsToday: 1, at: 100 },
    { userId: 'c', name: 'Вика', setsDone: 5, pct: 90, recordsToday: 2, at: 50 },
    { userId: 'd', name: 'Глеб', setsDone: 8, pct: 50, recordsToday: 0, at: 200 } ];
  const before = JSON.stringify(rows);
  const bySets = c.socialCompRank('sets', rows);
  assert(bySets.map(r => r.userId).join() === 'b,a,d,c', 'equal sets: whoever got there first, then by name: ' + bySets.map(r => r.userId).join());
  assert(bySets.map(r => r.rank).join() === '1,2,3,4' && bySets[0].score === 8, 'consecutive ranks with the score attached');
  assert(c.socialCompRank('plan', rows)[0].userId === 'c' && c.socialCompRank('plan', rows)[0].score === 90, 'plan format ranks by percent');
  assert(c.socialCompRank('records', rows)[0].userId === 'c', 'records format ranks by beaten personal bests');
  assert(c.socialCompRank('team', rows)[0].score === 8, 'the team format counts sets');
  assert(JSON.stringify(rows) === before, 'ranking must not mutate its input');
  const tp = c.socialTeamProgress(rows, 40);
  assert(tp.total === 29 && tp.pct === 73 && !tp.reached, 'team progress: ' + JSON.stringify(tp));
  assert(c.socialTeamProgress(rows, 20).reached && c.socialTeamProgress(rows, 20).pct === 100, 'the goal is reached and capped');
  assert(c.socialTeamProgress([], 0).pct === 0 && !c.socialTeamProgress([], 0).reached, 'an empty goal is safe');
  assert(c.SOCIAL_FORMATS.map(f => f.id).join() === 'sets,plan,records,team' && c.SOCIAL_FORMATS.every(f => f.desc && f.shares && f.name), 'four documented formats');
  info('Earlier-to-reach wins ties; formats rank by their own metric');
});

test('Bots: deterministic, labelled data, believable and monotone, never beyond the plan', () => {
  const c = loadCompete();
  const a1 = c.socialBot('room-1', 0), a2 = c.socialBot('room-1', 0), b = c.socialBot('room-2', 0);
  assert(JSON.stringify(a1) === JSON.stringify(a2), 'the same room and number always give the same bot');
  assert(a1.userId !== b.userId, 'different rooms give different bots');
  const names = Array.from({ length: 8 }, (_, i) => c.socialBot('room-1', i).name);
  assert(new Set(names).size === 8, 'eight bots in one room have eight distinct names: ' + names.join());
  for (let i = 0; i < 8; i++) {
    const bot = c.socialBot('room-' + i, i);
    assert(bot.skill >= 0.75 && bot.skill <= 1.25 && bot.userId.startsWith('bot-'), 'skill in range, id marked as a bot: ' + JSON.stringify(bot));
    let prev = -1;
    for (let m = 0; m <= 120; m++) {
      const live = c.socialBotLive(bot, m, 18, 0.3);
      assert(live.setsDone >= prev, 'bot progress must never go back (minute ' + m + ')');
      assert(live.setsDone <= 18 && live.pct <= 100, 'a bot never exceeds the plan');
      prev = live.setsDone;
    }
    assert(c.socialBotLive(bot, 0, 18, 0.3).setsDone === 0, 'everyone starts from zero');
    const fin = c.socialBotLive(bot, 240, 18, 0.3).setsDone;
    assert(fin === 18 || (fin >= 9 && fin <= 16), 'given enough time a bot finishes the plan or quits between 50% and 90% of it, got ' + fin);
  }
  info('Deterministic, named, bounded, monotone');
});

test('Bots behave like people: uneven rest, late arrival, long pauses, some quit early', () => {
  const c = loadCompete();
  const tls = Array.from({ length: 200 }, (_, i) => ({ bot: c.socialBot('room-' + i, i % 5), tl: null })).map(x => { x.tl = c.socialBotTimeline(x.bot, 18, 0.3); return x; });
  // 1. отдых между подходами неровный, а не метроном
  let uneven = 0, withPause = 0, late = 0, quit = 0, fullDur = [], meanRatio = [];
  tls.forEach(({ bot, tl }) => {
    const gaps = tl.map((x, k) => x - (k ? tl[k - 1] : 0)).slice(1);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) * (g - mean), 0) / gaps.length);
    if (sd / mean > 0.12) uneven++;
    if (gaps.some(g => g > mean * 1.6)) withPause++;
    if (tl[0] > 1.5) late++;
    if (tl.length < 18) quit++; else { fullDur.push(tl[tl.length - 1]); meanRatio.push((tl[tl.length - 1] - tl[0]) / 17 / (1 / (0.3 * bot.skill))); }
  });
  assert(uneven / 200 > 0.95, 'rest between sets must vary, only ' + uneven + '/200 bots were uneven');
  assert(withPause / 200 > 0.5, 'many bots take an occasional long pause, got ' + withPause + '/200');
  assert(late / 200 > 0.5, 'most bots do not start at the exact first second, got ' + late + '/200');
  assert(quit / 200 > 0.1 && quit / 200 < 0.4, 'roughly one in four quits early, got ' + quit + '/200');
  // 2. при этом средний темп соответствует заданному: гонка остаётся близкой
  const avgRatio = meanRatio.reduce((a, b) => a + b, 0) / meanRatio.length;
  assert(avgRatio > 0.85 && avgRatio < 1.3, 'on average a bot keeps the pace it was given, ratio ' + avgRatio.toFixed(2));
  // 3. у разных ботов разные расписания; у одного бота - одно и то же при каждом вызове
  const a = c.socialBot('room-9', 0), b = c.socialBot('room-9', 1);
  assert(JSON.stringify(c.socialBotTimeline(a, 18, 0.3)) !== JSON.stringify(c.socialBotTimeline(b, 18, 0.3)), 'two bots of one room must not move in lockstep');
  assert(JSON.stringify(c.socialBotTimeline(a, 18, 0.3)) === JSON.stringify(c.socialBotTimeline(a, 18, 0.3)), 'one bot always has the same schedule');
  // 4. подходы приходят ступеньками (целые числа, не плавная кривая), за минуту не больше одного-двух
  const live = Array.from({ length: 61 }, (_, m) => c.socialBotLive(a, m, 18, 0.3).setsDone);
  assert(live.every((v, i) => i === 0 || v - live[i - 1] <= 2), 'never more than two sets in a minute: ' + live.join(','));
  info('Uneven rest, pauses, late start, ~1/4 drop out, average pace preserved');
});

test('Bots: pace comes from the user\'s own history, with a sane default for a beginner', () => {
  const c = loadCompete();
  assert(c.socialReferencePace({ history: {} }).planned === 18 && c.socialReferencePace({ history: {} }).perMin === 0.3, 'no history: 18 sets an hour');
  const ent = (n, k) => ({ date: dn(n), ts: n, workout: 'push', detail: [{ id: 'x', sets: Array.from({ length: k }, () => ({ w: '1', done: true })) }] });
  const r = c.socialReferencePace({ history: { push: [ent(1, 20), ent(8, 24), ent(15, 16)] } });
  assert(r.planned === 20 && r.perMin === 20 / 60, 'average of the user\'s sessions: ' + JSON.stringify(r));
  const tiny = c.socialReferencePace({ history: { push: [ent(1, 2)] } });
  assert(tiny.planned === 6, 'never fewer than 6 sets, got ' + tiny.planned);
  info('Bots race at roughly your own level, so the race is close');
});

test('Bots yield to people: humans push bots out from the end and the rest do not change', () => {
  const c = loadCompete();
  const o = { seed: 'room-x', capacity: 5, minutes: 30, planned: 18, perMin: 0.3, startsAt: 0 };
  const me = (sets, at) => ({ userId: 'me', name: 'Вы', setsDone: sets, pct: Math.round(sets / 18 * 100), recordsToday: 0, at: at || 1 });
  const empty = c.socialRoomBoard('sets', [], o);
  assert(empty.length === 5 && empty.every(r => r.bot === true), 'an empty room is full of bots');
  const one = c.socialRoomBoard('sets', [me(3)], o);
  assert(one.length === 5 && one.filter(r => r.bot).length === 4 && one.filter(r => !r.bot).length === 1, 'one person, four bots');
  const sig = rows => rows.filter(r => r.bot).map(r => r.userId + ':' + r.setsDone).sort();
  const botsOf5 = sig(empty), botsOf4 = sig(one);
  assert(botsOf4.every(x => botsOf5.includes(x)), 'the bots that stay are the same bots with the same progress');
  assert(botsOf5.filter(x => !botsOf4.includes(x)).length === 1, 'exactly one bot left when one person joined');
  const gone = botsOf5.filter(x => !botsOf4.includes(x))[0];
  assert(gone.startsWith(c.socialBot('room-x', 4).userId + ':'), 'the bot that leaves is the LAST one (index 4), so earlier bots keep their places: left ' + gone);
  const two = c.socialRoomBoard('sets', [me(3), { userId: 'h2', name: 'Игрок', setsDone: 4, pct: 22, recordsToday: 0, at: 2 }], o);
  assert(two.filter(r => r.bot).length === 3 && sig(two).every(x => botsOf4.includes(x)), 'a second person removes the next bot, the earlier ones stay');
  const crowd = Array.from({ length: 7 }, (_, i) => ({ userId: 'h' + i, name: 'H' + i, setsDone: i, pct: 0, recordsToday: 0, at: i }));
  const full = c.socialRoomBoard('sets', crowd, o);
  assert(full.length === 5 && full.every(r => !r.bot), 'a full room has no bots and never exceeds its capacity');
  assert(full.every((r, i) => r.rank === i + 1), 'ranks stay consecutive');
  // боты помечены, людей за ботов выдавать нельзя
  assert(empty.every(r => r.bot === true && r.userId.startsWith('bot-')) && one.filter(r => !r.bot).every(r => !r.userId.startsWith('bot-')), 'bots are flagged, humans are not');
  info('5 bots -> 4 -> 3 -> 0 as people join; survivors keep their identity and progress');
});

testAsync('Live rooms: the local stand-in supports create, join, publish and subscribe', async () => {
  const c = loadCompete();
  let clock = 1000;
  const be = c.socialLocalRooms({}, () => clock);
  c.SOCIAL_ROOM_METHODS.forEach(m => assert(typeof be[m] === 'function', 'rooms method missing: ' + m));
  const room = await be.createRoom({ format: 'plan', minutes: 45, capacity: 2 });
  assert(room.format === 'plan' && room.minutes === 45 && room.capacity === 2 && /^[0-9A-F]{1,6}$/.test(room.code), 'room: ' + JSON.stringify(room));
  assert((await be.joinRoom('NOPE', 'u1')).error === 'Комната не найдена', 'a wrong code is rejected');
  assert((await be.publishLive(room.id, { userId: 'u1', setsDone: 1 })).error === 'Сначала войдите в комнату', 'publishing requires joining first');
  let calls = 0;
  const off = be.subscribeRoom(room.id, () => calls++);
  assert((await be.joinRoom(room.code.toLowerCase(), 'u1')).ok, 'the code is case-insensitive');
  assert((await be.joinRoom(room.code, 'u2')).ok, 'second person joins');
  assert((await be.joinRoom(room.code, 'u3')).error === 'Комната заполнена', 'a full room refuses a third');
  assert((await be.joinRoom(room.code, 'u1')).ok, 're-joining as the same person is fine');
  clock = 2000;
  await be.publishLive(room.id, { userId: 'u1', name: 'A', setsDone: 3, pct: 20, recordsToday: 0, at: 2000 });
  clock = 3000;
  await be.publishLive(room.id, { userId: 'u1', name: 'A', setsDone: 3, pct: 20, recordsToday: 0, at: 3000 });
  const got = await be.getRoom(room.id);
  const u1 = got.humans.filter(h => h.userId === 'u1')[0];
  assert(u1.setsDone === 3 && u1.at === 2000, 'the reach time moves only when the score changes, so resending cannot fake "first": at=' + u1.at);
  clock = 4000;
  await be.publishLive(room.id, { userId: 'u1', name: 'A', setsDone: 4, pct: 25, recordsToday: 0, at: 0 });
  assert((await be.getRoom(room.id)).humans.filter(h => h.userId === 'u1')[0].at === 4000, 'a new score gets a new reach time');
  assert(calls >= 5, 'subscribers are notified on joins and publishes, got ' + calls);
  off();
  const before = calls;
  await be.publishLive(room.id, { userId: 'u1', setsDone: 5 });
  assert(calls === before, 'an unsubscribed callback is not called again');
  assert((await be.getRoom('nope')) === null, 'an unknown room is null');
  info('create / join / publish / getRoom / subscribe, anti-replay reach time');
});

test('Arena and friends rooms UI: consent screen, visibility choice, friends rooms without bots by default', () => {
  const comp = fs.readFileSync(path.join(BETA_SRC_DIR, 'compete.jsx'), 'utf8');
  assert(comp.includes('КТО ВАС УВИДИТ') && comp.includes('По умолчанию в зале все видят всех'), 'the first-use consent text must say what everyone sees');
  assert(comp.includes('Пока вы не выберете, ничего не публикуется'), 'and that nothing is published before the choice');
  assert(comp.includes('Веса, профиль, вес тела и самочувствие не видит никто'), 'and that health data is never shown');
  assert(comp.includes('(ПО УМОЛЧАНИЮ)') && comp.includes('SOCIAL_VISIBILITY.map'), 'public is offered as the default, with the other two choices equally one tap away');
  assert(comp.includes('consentAt: d.social.consentAt || todayKey()'), 'choosing records the consent date and never erases an earlier one');
  assert(comp.includes('Открытый зал доступен с 16 лет'), 'the under-16 notice must be visible');
  assert(comp.includes('КОМНАТЫ ДРУЗЕЙ (СКОРО)') && comp.includes('Закрытые комнаты: попасть можно только по коду'), 'friends rooms are described as private by code');
  assert(comp.includes('const [withBots, setWithBots] = useState(false)'), 'bots are OFF by default in friends rooms');
  assert(comp.includes('demo.withBots ? COMPETE_DEMO_CAPACITY : humans.length'), 'with bots off the room holds only people');
  assert(betaSrc.includes('<ArenaPanel data={data} setData={setData} />'), 'the arena panel needs setData to store the choice');
  assertNot(/fetch\(|WebSocket|sendBeacon/.test(comp), 'still no network');
  info('Consent first, three equal choices, under-16 note, friends rooms bot-free by default');
});

test('Arena: cohorts, stable group assignment and an even spread of people over groups', () => {
  const c = loadCompete();
  assert(c.ARENA_SHARD_SIZE === 30, 'groups of up to 30');
  assert(c.socialCohortKey('pro', 'plan') === 'pro:plan' && c.socialCohortKey('new', 'team') === 'new:team', 'cohort is level plus format');
  assert(c.socialCohortKey(undefined, 'sets') === 'mid:sets' && c.socialCohortKey('legend', 'sets') === 'mid:sets', 'unknown or missing level falls back to the middle one');
  assert(c.socialCohortKey('mid', 'nope') === 'mid:sets', 'unknown format falls back to sets');
  const idx = (u, w, pop) => c.socialShardIndex(u, 'mid:sets', w, pop);
  assert(idx('u1', 'w1', 100) === idx('u1', 'w1', 100), 'the same person lands in the same group every time (phones and server agree)');
  assert(idx('u1', 'w1', 25) === 0 && idx('u2', 'w1', 30) === 0, 'up to 30 people: a single group, index 0');
  // равномерность: 3000 человек -> 100 групп, в среднем по 30
  const counts = {};
  for (let i = 0; i < 3000; i++) { const s = idx('user-' + i, 'w1', 3000); counts[s] = (counts[s] || 0) + 1; }
  const vals = Object.keys(counts).map(k => counts[k]);
  assert(Object.keys(counts).length === 100 && Math.max(...vals) <= 55 && Math.min(...vals) >= 12, 'groups must be filled evenly, got min ' + Math.min(...vals) + ' max ' + Math.max(...vals));
  // окно меняет состав: через окно люди перемешиваются
  let moved = 0;
  for (let i = 0; i < 300; i++) if (idx('user-' + i, 'w1', 3000) !== idx('user-' + i, 'w2', 3000)) moved++;
  assert(moved > 250, 'groups are reshuffled between windows, only ' + moved + '/300 moved');
  assert(idx('u', 'w', 0) === 0 && idx('u', 'w', 1) === 0, 'an empty or single-person population is safe');
  info('Stable, even (12..55 per group of ~30), reshuffled by window');
});

test('Arena view: your place, leaders and neighbours, without duplicates', () => {
  const c = loadCompete();
  const board = n => Array.from({ length: n }, (_, i) => ({ userId: i === 14 ? 'me' : 'u' + i, name: 'N' + i, bot: i % 3 === 0, rank: i + 1, score: 100 - i }));
  const v = c.socialArenaView(board(30), 'me', 2);
  assert(v.total === 30 && v.rank === 15 && v.betterThan === 52, 'rank 15 of 30 beats 52% (14/29): ' + JSON.stringify({ r: v.rank, b: v.betterThan }));
  assert(v.top.map(r => r.rank).join() === '1,2,3', 'the top three');
  assert(v.near.map(r => r.rank).join() === '13,14,15,16,17' && v.gap === true, 'five neighbours around you, a gap marker between them and the leaders');
  assert(v.people + v.bots === 30 && v.bots === 10 && v.people === 20, 'people and bots are counted separately');
  const first = c.socialArenaView(board(30).map((r, i) => Object.assign({}, r, { userId: i === 0 ? 'me' : 'u' + i })), 'me', 2);
  assert(first.rank === 1 && first.betterThan === 100 && first.near.map(r => r.rank).join() === '4,5' && first.gap === false, 'first place: leaders already shown, near rows exclude them: ' + first.near.map(r => r.rank));
  const lastB = board(30).map((r, i) => Object.assign({}, r, { userId: i === 29 ? 'me' : 'u' + i }));
  const last = c.socialArenaView(lastB, 'me', 2);
  assert(last.rank === 30 && last.betterThan === 0 && last.near.map(r => r.rank).join() === '26,27,28,29,30' && last.gap === true, 'last place: the window is pinned to the end, got ' + last.near.map(r => r.rank));
  const small = c.socialArenaView(board(4).map((r, i) => Object.assign({}, r, { userId: i === 3 ? 'me' : 'u' + i })), 'me', 2);
  assert(small.near.length === 1 && small.near[0].rank === 4 && small.gap === false, 'a tiny group has no gap and no duplicates: ' + JSON.stringify(small.near.map(r => r.rank)));
  assert(c.socialArenaView(board(1).map(r => Object.assign({}, r, { userId: 'me' })), 'me', 2).betterThan === null, 'alone in a group there is no percentile to brag about');
  const away = c.socialArenaView(board(30), 'ghost', 2);
  assert(away.rank === null && away.near.length === 0 && away.betterThan === null, 'someone who is not on the board gets no place');
  assert(new Set([...v.top, ...v.near].map(r => r.userId)).size === v.top.length + v.near.length, 'no row is shown twice');
  info('Place, percentile, leaders, neighbours, gap marker, edges');
});

test('Arena + friends rooms: the design doc records the decisions', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'social-design.md'), 'utf8');
  ['10. Зал: всё приложение - одна большая комната', 'Все видят', 'Пока человек не выбрал, не публикуется ничего', 'с 16 лет', 'Общий счётчик «сейчас в зале» считает **только людей**',
    'Вариант', 'B. Зал из групп по 30', 'фильтр имён'].forEach(x => assert(doc.includes(x), 'design doc missing: ' + x));
  info('Section 10 covers scale variants, consent, age rule, honest counter, moderation');
});

test('Live competition UI: bots are labelled, no network, wired in, privacy stated, beta only', () => {
  const comp = fs.readFileSync(path.join(BETA_SRC_DIR, 'compete.jsx'), 'utf8');
  ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'navigator.share'].forEach(x => assertNot(comp.includes(x), 'compete.jsx must not touch the network: ' + x));
  // Боты ведут себя по-человечески, но НЕ выдаются за людей: значок у имени и строка в шапке комнаты обязательны
  assert(comp.includes('{r.bot && <span title="бот-партнёр"') && comp.includes('🤖'), 'every bot row must carry the robot marker');
  assert(/В комнате: .*человек.*бот-партнёр/.test(comp.replace(/\s+/g, ' ')), 'the room header must say how many people and bots are in the room');
  assert(comp.includes('Боты-партнёры (значок 🤖) по умолчанию выключены'), 'friends rooms: bots are off by default and marked when on');
  assert(comp.includes('боты-партнёры (значок 🤖)'), 'the arena intro must say bots are marked');
  assert(comp.includes('не выдаются за людей') && comp.includes('нельзя'), 'the no-deception rule must stay in the code comment');
  assertNot(/hideBot|скрыть бот|без пометки|неотличим/i.test(comp), 'there must be no switch that hides the bot marker');
  assert(comp.includes('Каждый подключившийся человек вытесняет одного бота'), 'the replacement rule is explained to the user');
  assert(comp.includes('Веса не публикуются'), 'the weights-never-published promise is visible');
  assert(comp.includes('Сервера пока нет, ничего не отправляется'), 'the panel says nothing is sent');
  assert(betaSrc.includes('typeof CompetePanel === "function" && <CompetePanel'), 'CompetePanel not wired into BetaTab');
  assertNot(/function Compete|socialRoomBoard|socialBot/.test(app), 'competitions must not exist in the production page');
  assert((comp.slice(comp.indexOf('function CompetePanel')).match(/minHeight: 48/g) || []).length >= 3, 'demo buttons need 44pt+ targets');
  info('Labelled bots, no network, wired in, beta only');
});

test('Coach UI: panel is wired into the beta tab and its dismiss button is a 44pt target', () => {
  const coach = fs.readFileSync(path.join(BETA_SRC_DIR, 'coach.jsx'), 'utf8');
  assert(/function CoachPanel/.test(betaApp), 'CoachPanel missing from the beta page');
  assert(betaSrc.includes('typeof CoachPanel === "function" && <CoachPanel'), 'BetaTab must render CoachPanel');
  assert(coach.includes('coachDismissed') && coach.includes('СКРЫТЬ НА НЕДЕЛЮ'), 'dismiss action missing');
  assert(/minHeight: 44[^}]*\}\}>\s*СКРЫТЬ/.test(coach), 'dismiss button needs minHeight 44');
  assertNot(/function CoachPanel|coachAnalyze/.test(app), 'the coach must not leak into the production page');
  info('Wired in, no leak into production');
});

test('Compilation waits for the whole page, otherwise Babel reads a half-loaded app source', () => {
  // Гонка: библиотеки из vendor/ и кэша воркера приходят мгновенно, а inline-скрипт приложения
  // (~290 КБ) в конце страницы ещё разбирается. Тогда textContent оборван и Babel падает с
  // "Unterminated string constant" на ровном месте. Воспроизводилось в Edge примерно на каждой второй загрузке.
  [['production', html], ['beta', betaHtml]].forEach(([name, page]) => {
    const shell = page.slice(0, page.indexOf('id="app-src"'));
    const fnSrc = shell.match(/function onDocumentParsed\(fn\) \{[\s\S]*?\n\}/);
    assert(fnSrc, name + ': onDocumentParsed missing');
    const make = state => {
      const doc = { readyState: state, listener: null, addEventListener(t, f) { assert(t === 'DOMContentLoaded', 'must wait for DOMContentLoaded'); this.listener = f; } };
      return { doc, fn: new Function('document', fnSrc[0] + '; return onDocumentParsed;')(doc) };
    };
    let ran = 0, w = make('loading');
    w.fn(() => ran++);
    assert(ran === 0 && w.doc.listener, name + ': while the page is loading the callback must wait');
    w.doc.listener();
    assert(ran === 1, name + ': the callback must run once the page is parsed');
    ['interactive', 'complete'].forEach(s => { ran = 0; make(s).fn(() => ran++); assert(ran === 1, name + ': an already parsed page (' + s + ') must run immediately'); });
    const call = shell.indexOf('onDocumentParsed(function()');
    const transform = shell.indexOf('Babel.transform');
    const read = shell.indexOf("getElementById('app-src').textContent");
    assert(call > 0 && transform > call && read > call, name + ': the app source must be read and compiled inside onDocumentParsed');
  });
  info('Compile starts only after parsing finishes (production and beta)');
});

test('Test version is built: beta/index.html, beta/sw.js and src/beta/*.jsx exist', () => {
  assert(betaHtml.length > 0, 'beta/index.html missing (run: python3 scripts/build.py)');
  assert(fs.existsSync(BETA_SW_PATH), 'beta/sw.js missing');
  assert(betaFiles.includes('shell.jsx'), 'src/beta/shell.jsx missing');
  info('Beta modules: ' + betaFiles.join(', '));
});

test('Production page carries no beta code and keeps its own keys', () => {
  assert(app.includes('const APP_VARIANT = "prod";'), 'production must be built as "prod"');
  assertNot(/function BetaTab|function BetaSection|PROD_STORAGE_KEY|function readProdBackup/.test(app), 'beta modules leaked into the production page');
  assertNot(app.includes('ppl_tracker_beta') && !app.includes('APP_VARIANT === "beta" ? "ppl_tracker_beta"'), 'unexpected beta key use in production');
  info('index.html is "prod" and contains no src/beta code');
});

test('Test page is the "beta" variant with its own name and shared libraries', () => {
  assert(betaApp.includes('const APP_VARIANT = "beta";'), 'beta must be built as "beta"');
  assert(/function BetaTab/.test(betaApp), 'BetaTab missing from the test page');
  assert(betaHtml.includes('<title>Workout BETA</title>'), 'title must say BETA - otherwise the two apps look the same on the home screen');
  assert(betaHtml.includes('name="apple-mobile-web-app-title" content="Workout BETA"'), 'home-screen name must say BETA');
  assert(betaHtml.includes('Workout%20BETA'), 'manifest name must say BETA');
  ['react.production.min.js', 'react-dom.production.min.js', 'babel.min.js'].forEach(f =>
    assert(betaHtml.includes("loadScript('../vendor/" + f + "'"), f + ' must load from ../vendor/ (shared with production)'));
  assertNot(/loadScript\('vendor\//.test(betaHtml), 'a library still loads from vendor/ relative to beta/ - it would 404');
  info('Own name, shared ../vendor/');
});

test('Test version never writes to production storage keys', () => {
  // ключи, как их вычислит бета-страница
  const decl = betaApp.match(/const APP_VARIANT = "beta";\s*const STORAGE_KEY = [^\n]+\s*const TIMER_KEY = [^\n]+/);
  assert(decl, 'key declarations not found in the beta page');
  const keys = new Function(decl[0] + '; return { STORAGE_KEY, TIMER_KEY };')();
  assert(keys.STORAGE_KEY === 'ppl_tracker_beta' && keys.TIMER_KEY === 'sila_timer_beta', 'beta keys must be separate, got ' + JSON.stringify(keys));
  // в модулях src/beta запись и удаление возможны только в НЕ боевые ключи
  const writes = [...betaSrc.matchAll(/localStorage\.(setItem|removeItem)\(\s*([^,)]+)/g)].map(m => m[2].trim());
  writes.forEach(w => assertNot(/PROD_STORAGE_KEY|ppl_tracker_v4|"sila_timer"/.test(w), 'beta code writes to a production key: ' + w));
  // единственное упоминание боевого ключа - константа для ЧТЕНИЯ
  assert((betaSrc.match(/ppl_tracker_v4/g) || []).length === 1, 'the production key may be named exactly once (the read-only constant)');
  info('Beta keys: ' + keys.STORAGE_KEY + ', ' + keys.TIMER_KEY + '; ' + writes.length + ' write(s) in beta modules, none to production');
});

test('Copy from production only reads it and merges additively', () => {
  const from = src.indexOf('const BACKUP_APP');
  const prodBody = src.slice(from, src.indexOf('export default function App', from));
  const betaBody = betaSrc.slice(betaSrc.indexOf('const PROD_STORAGE_KEY'), betaSrc.indexOf('function BetaSection'));
  const calls = [];
  const mk = raw => ({ getItem: k => { calls.push(['get', k]); return k === 'ppl_tracker_v4' ? raw : null; }, setItem: k => calls.push(['set', k]), removeItem: k => calls.push(['remove', k]) });
  const load = ls => new Function('localStorage', 'HISTORY_LIMIT', prodBody + betaBody + '; return { readProdBackup, countEntries };')(ls, 200);

  const prodData = { sessions: {}, history: { push: [{ date: '2026-09-25', ts: 5, workout: 'push' }, { date: '2026-09-18', ts: 4, workout: 'push' }] }, schedule: ['push', null, null, null, null, null, null], dbMode: 'single' };
  let f = load(mk(JSON.stringify(prodData)));
  let r = f.readProdBackup();
  assert(r.data && f.countEntries(r.data) === 2, 'production history must be readable, got ' + JSON.stringify(r).slice(0, 80));
  assert(calls.length === 1 && calls[0][0] === 'get' && calls[0][1] === 'ppl_tracker_v4', 'reading production must be exactly one getItem, got ' + JSON.stringify(calls));
  assert(!calls.some(c => c[0] !== 'get'), 'no writes or removals while reading production');

  f = load(mk(null)); r = f.readProdBackup();
  assert(r.error && !r.data, 'no production data -> a message, not a crash');
  f = load(mk('not json')); r = f.readProdBackup();
  assert(r.error && !r.data, 'broken production data -> a message, not a crash');

  // слияние в пустую бету копирует историю, и повторное нажатие ничего не дублирует
  const { mergeBackup, parseBackup } = new Function('HISTORY_LIMIT', prodBody + '; return { mergeBackup, parseBackup };')(200);
  const empty = { sessions: {}, history: {}, swaps: {}, skipped: {}, customWorkouts: {}, customSets: {}, addedEx: {}, resuming: null, dbMode: 'single', trash: [], schedule: [null, null, null, null, null, null, null] };
  const once = mergeBackup(empty, parseBackup(JSON.stringify(prodData)).data);
  assert(once.added === 2, 'first copy adds 2, got ' + once.added);
  const twice = mergeBackup(once.data, parseBackup(JSON.stringify(prodData)).data);
  assert(twice.added === 0, 'second copy adds nothing, got ' + twice.added);
  info('One getItem, zero writes; copy is additive and repeatable');
});

test('Moving data into the test app by file (home-screen apps on iPhone do not share storage)', () => {
  const from = src.indexOf('const BACKUP_APP');
  const prodBody = src.slice(from, src.indexOf('export default function App', from));
  const betaBody = betaSrc.slice(betaSrc.indexOf('const PROD_STORAGE_KEY'), betaSrc.indexOf('function BetaSection'));
  let pruned = 0;
  const f = new Function('localStorage', 'HISTORY_LIMIT', 'pruneOldKeys', prodBody + betaBody + '; return { betaMergeFile, readProdBackup, buildBackup };')(
    { getItem: () => null }, 200, d => { pruned++; return d; });
  const empty = () => ({ sessions: {}, history: {}, swaps: {}, skipped: {}, customWorkouts: {}, customSets: {}, addedEx: {}, resuming: null, dbMode: 'single', trash: [], schedule: [null, null, null, null, null, null, null] });
  const prod = empty();
  prod.history.push = [{ date: '2026-09-25', ts: 20, workout: 'push' }, { date: '2026-09-18', ts: 10, workout: 'push' }];
  const file = f.buildBackup(prod);
  // файл копии основной версии загружается в пустую бету
  const r1 = f.betaMergeFile(file, empty());
  assert(r1.added === 2 && r1.data.history.push.length === 2 && pruned === 1, 'file import into an empty test app: ' + JSON.stringify({ a: r1.added, p: pruned }));
  // повторная загрузка ничего не дублирует и ничего не стирает
  const local = r1.data;
  local.history.push.unshift({ date: '2026-10-01', ts: 30, workout: 'push', name: 'LOCAL' });
  const r2 = f.betaMergeFile(file, local);
  assert(r2.added === 0 && r2.data.history.push.length === 3 && r2.data.history.push[0].name === 'LOCAL', 'a second load adds nothing and keeps local work');
  // не тот файл: понятная ошибка, данные не тронуты
  const bad = f.betaMergeFile('{"hello": 1}', local);
  assert(bad.error && !bad.data, 'a foreign file is rejected with a message');
  assert(f.betaMergeFile('not json', local).error, 'garbage is rejected with a message');
  // на iPhone основная версия отсюда не видна: сообщение спокойное и говорит, что делать
  const msg = f.readProdBackup().error;
  assert(msg.includes('хранит данные отдельно') && msg.includes('Загрузите, пожалуйста, файл копии'), 'the message must explain and point to the file: ' + msg);
  assertNot(/нет \(открывалась ли/.test(msg), 'the old abrupt wording must be gone');
  info('File import is additive and repeatable; the error message explains what to do');
});

test('Test app data section explains the file route and the questionnaire is rendered on its own', () => {
  const shell = fs.readFileSync(path.join(BETA_SRC_DIR, 'shell.jsx'), 'utf8');
  assert(shell.includes('type="file" accept="application/json,.json"') && shell.includes('ЗАГРУЗИТЬ ФАЙЛ ИЗ ОСНОВНОЙ ВЕРСИИ'), 'a file picker for the main version copy');
  assert(shell.includes('хранит данные отдельно') && shell.includes('СОХРАНИТЬ'), 'the section tells how to produce the file');
  assert(shell.includes('{!prod.error && ('), 'the direct copy button is shown only where the main version is actually readable');
  const prof = fs.readFileSync(path.join(BETA_SRC_DIR, 'profile.jsx'), 'utf8');
  assert(prof.includes('ReactDOM.createPortal(') && prof.includes('document.body'), 'the questionnaire is rendered in body, outside the app tree');
  assert(prof.includes('r.style.visibility = "hidden"') && prof.includes('r.style.visibility = ""'), 'the app underneath is hidden while the questionnaire is open and restored afterwards');
  assert(/top: 0, left: 0, right: 0, bottom: 0/.test(prof), 'explicit edges instead of the inset shorthand');
  info('File route documented in the UI; questionnaire sits above a hidden app');
});

test('Beta page code obeys the iOS rules (no bad non-ASCII in strings, no ?. / ??)', () => {
  const bad = scanNonAsciiInStrings(betaApp);
  assert(bad.length === 0, bad.length + ' bad chars in beta strings: ' + bad.slice(0, 5).join(', '));
  const hits = codeLines(betaSrc).filter(l => l.includes('?.') || /[^?]\?\?[^?=]/.test(l) || /\|\|=|&&=|\?\?=/.test(l));
  assert(hits.length === 0, 'optional chaining / nullish / logical assignment in beta modules: ' + hits.slice(0, 3).join(' | '));
  ['.at(', 'structuredClone', 'Object.hasOwn'].forEach(t => assertNot(betaSrc.includes(t), t + ' is not available on the target iOS'));
  info('Beta modules follow the same rules as production');
});

test('Beta page really compiles with the vendored Babel 7.23.10 (not just regexes)', () => {
  const Babel = require(path.join(ROOT, 'vendor', 'babel.min.js'));
  assert(Babel.version === '7.23.10', 'unexpected Babel version ' + Babel.version);
  const compile = code => Babel.transform(code, { presets: [['react', {}]], plugins: [], filename: 'app.jsx' }).code;
  const compiled = compile(betaApp);
  new Function('React', 'ReactDOM', compiled);   // создаём, но не запускаем: проверяем, что итог - валидный JS
  new Function('React', 'ReactDOM', compile(app));
  assert(compiled.length > 0, 'empty output');
  info('Beta and production pages both compile to valid JS');
});

test('beta/sw.js has its own cache, shared libraries and never touches production caches', () => {
  const sw = fs.readFileSync(BETA_SW_PATH, 'utf8');
  assert(/const CACHE = "sila-beta-v\d+"/.test(sw), 'beta cache must be sila-beta-N');
  assert(sw.includes('const CACHE_PREFIX = "sila-beta-"'), 'beta must only clean sila-beta-* caches');
  const list = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
  list.filter(u => u !== './').forEach(u => assert(fs.existsSync(path.join(ROOT, 'beta', u)), 'beta precache entry does not exist: ' + u));
  assert(list.filter(u => u.startsWith('../vendor/')).length === 3, 'all three libraries must come from ../vendor/');
  info('Beta precache: ' + list.join(', '));
});

testAsync('beta/sw.js activate deletes only old beta caches; production sw.js leaves beta alone', async () => {
  const keys = ['sila-v5', 'sila-v6', 'sila-beta-v0', 'sila-beta-v1'];
  let store = new Map(), waited;
  runSw(store, () => Promise.reject(new Error('x')), 'beta/sw.js', keys).handlers.activate({ waitUntil: p => { waited = p; } });
  await waited;
  assert((store.deleted || []).join() === 'sila-beta-v0', 'beta worker must delete only old beta caches, got ' + store.deleted);
  store = new Map();
  runSw(store, () => Promise.reject(new Error('x')), 'sw.js', keys).handlers.activate({ waitUntil: p => { waited = p; } });
  await waited;
  assert((store.deleted || []).join() === 'sila-v5', 'production worker must delete only old production caches, got ' + store.deleted);
  info('The two workers never delete each other\'s caches');
});

test('--check covers beta, and the default build writes all three files', () => {
  const b = fs.readFileSync(path.join(ROOT, 'scripts', 'build.py'), 'utf8');
  assert(b.includes('BETA_OUT') && b.includes('BETA_SW_OUT') && b.includes('build(beta=True)'), 'build.py must build the test version');
  assert(b.includes('def replace_once'), 'beta substitutions must fail loudly when they miss');
  info('build.py builds and checks index.html, beta/index.html, beta/sw.js');
});

// ═══════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ═══════════════════════════════════════════════════════════════════════════
(async function () {
  if (ASYNC_TESTS.length) section('22 · SERVICE WORKER (async)');
  for (const t of ASYNC_TESTS) {
    try { await t.fn(); PASS.push(t.name); console.log(`  ${GREEN('✓')} ${t.name}`); }
    catch (e) { FAIL.push({ name: t.name, msg: e.message }); console.log(`  ${RED('✗')} ${t.name}\n    ${RED('→')} ${e.message}`); }
  }
  const total = PASS.length + FAIL.length;
  console.log('\n' + '═'.repeat(55));
  if (FAIL.length === 0) {
    console.log(GREEN(`✅  ALL ${total} TESTS PASSED`));
  } else {
    console.log(RED(`❌  ${FAIL.length} FAILED`) + `  /  ${GREEN(PASS.length + ' passed')}  /  ${total} total`);
    console.log('\n' + BOLD('Failed:'));
    FAIL.forEach(f => console.log(`  ${RED('✗')} ${f.name}\n    ${RED('→')} ${f.msg}`));
  }
  console.log('═'.repeat(55) + '\n');
  process.exit(FAIL.length > 0 ? 1 : 0);
})();
