#!/usr/bin/env node
// Проверка картинок упражнений ПО СЕТИ: каждая ссылка из src/beta/media.jsx (гифки и запасные картинки WebP)
// должна отдавать 200 и нужный тип.
// Нужна после смены закреплённого коммита или файла соответствия. Тесты (tests/test_pwa.js) работают без сети
// и эту проверку не заменяют. Запуск: node scripts/check_media_urls.js
const fs = require('fs');
const path = require('path');
const https = require('https');

const file = fs.readFileSync(path.join(__dirname, '..', 'src', 'beta', 'media.jsx'), 'utf8').replace(/\r\n/g, '\n');
const pure = file.slice(0, file.indexOf('// ---- Интерфейс ----'));
const m = new Function(pure + '; return { EXERCISE_MEDIA, EXERCISE_MEDIA_BASE, EXERCISE_STILLS, exerciseStillsUrls };')();
const gifs = [...new Set(Object.keys(m.EXERCISE_MEDIA).map(id => m.EXERCISE_MEDIA_BASE + m.EXERCISE_MEDIA[id] + '.gif'))];
const stills = [...new Set([].concat.apply([], Object.keys(m.EXERCISE_STILLS).map(id => m.exerciseStillsUrls(id))))];
const urls = gifs.concat(stills);
const TYPE = u => (u.endsWith('.webp') ? 'image/webp' : 'image/gif');

function head(url) {
  return new Promise(resolve => {
    const req = https.request(url, { method: 'HEAD', timeout: 20000 }, res => { res.resume(); resolve({ url, status: res.statusCode, type: res.headers['content-type'], size: +res.headers['content-length'] || 0 }); });
    req.on('timeout', () => { req.destroy(); resolve({ url, status: 0, type: 'timeout', size: 0 }); });
    req.on('error', e => resolve({ url, status: 0, type: e.code || 'error', size: 0 }));
    req.end();
  });
}

(async () => {
  const bad = [];
  let bytes = 0, i = 0;
  const queue = urls.slice();
  async function worker() {
    while (queue.length) {
      const r = await head(queue.shift());
      i++;
      bytes += r.size;
      if (r.status !== 200 || r.type !== TYPE(r.url) || r.size < 3000 || r.size > 400000) bad.push(r);
    }
  }
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  console.log('checked ' + i + ' links (' + gifs.length + ' GIF + ' + stills.length + ' WebP), total ' + (bytes / 1048576).toFixed(1) + ' MB, ' + (bad.length ? bad.length + ' PROBLEMS' : 'all OK'));
  bad.forEach(b => console.log('  ' + b.status + ' ' + b.type + ' ' + b.size + ' ' + b.url));
  process.exit(bad.length ? 1 : 0);
})();
