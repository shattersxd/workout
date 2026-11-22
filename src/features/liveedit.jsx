// ==== ПРАВКА ТРЕНИРОВКИ НА ХОДУ ====
// Раньше правки были разбросаны: режим "ИЗМЕНИТЬ СПИСОК" (в нём пропадали подходы, тренироваться было нельзя),
// кнопка "= заменить" (только 2-3 заранее заданных варианта), мелкий значок "ДОБАВЛЕНО x". Порядок не менялся
// совсем, замена после начатых подходов выбрасывала сделанное из журнала, отмены не было.
// Теперь у каждой карточки одна кнопка с тремя точками, за ней окно упражнения:
//   - заменить на ЛЮБОЕ упражнение (сначала рекомендованные замены и та же группа мышц, дальше поиск);
//   - порядок: выше, ниже, в конец (станок занят - делаем следующее);
//   - пропустить сегодня; если подходы уже есть - закончить на сделанных;
//   - убрать добавленное.
// Сделанное не теряется: если в упражнении уже есть отмеченные подходы, замена не подменяет его, а встаёт
// следом на оставшиеся подходы, пропуск превращается в "закончить на N подходах".
// После каждого действия внизу плашка "ОТМЕНИТЬ" (возвращает снимок тренировки до действия). Кнопка
// "СОСТАВ" над списком открывает обзор: порядок, пропущенные, добавить, вернуть план.
// Все правки действуют только на текущую тренировку (ключ сессии), в следующий раз список снова по плану.
//
// Замену можно ЗАПОМНИТЬ ("ВСЕГДА" в окне выбора или "Запомнить замену" в окне упражнения): тогда она действует и в
// следующих тренировках этого дня, пока её не отменят. Запомненные замены лежат в planSwaps[день][id слота] и не
// привязаны к дате; правка на сегодня (swaps) всегда важнее запомненной.
//
// Данные: к прежним sessions, swaps, skipped, addedEx, customSets добавлен order[ключ сессии] - id слотов в порядке
// показа. Слот - упражнение дня (или добавленное); в слоте может стоять замена (swaps), подходы записываются под
// id того упражнения, которое реально делается.
// Тексты без "ты" и "вы". Всё, что тесты исполняют, лежит выше разделителя "Интерфейс" (его строка ниже) и
// написано обычным JS (глобальные PROGRAM и ALTERNATIVES берутся из основного файла); компоненты - ниже.

const LV_PARTS = ["sessions", "swaps", "skipped", "addedEx", "customSets", "order"];
const LV_UNDO_MS = 6000;       // сколько висит плашка отмены

function lvClone(x) { return JSON.parse(JSON.stringify(x)); }

function lvGet(data, bucket, key, fallback) {
  return data[bucket] && data[bucket][key] !== undefined ? data[bucket][key] : fallback;
}

// Новая копия data с изменённой частью одной тренировки (null - убрать часть)
function lvPut(data, bucket, key, value) {
  const b = Object.assign({}, data[bucket] || {});
  if (value === null) delete b[key]; else b[key] = value;
  const out = Object.assign({}, data);
  out[bucket] = b;
  return out;
}

// День тренировки из ключа сессии "2026-11-23_fullbody_a" -> "fullbody_a" (в дате подчёркиваний нет)
function lvDayOf(key) { return key.slice(key.indexOf("_") + 1); }

// Запомненные замены дня: { id слота: id упражнения }
function lvPlan(data, key) {
  return lvGet(data, "planSwaps", lvDayOf(key), {});
}

// Снимок всего, что относится к одной тренировке (и запомненных замен её дня), и возврат к нему (для "ОТМЕНИТЬ")
function lvSnapshot(data, key) {
  const parts = {};
  LV_PARTS.forEach(function (b) { parts[b] = data[b] && data[b][key] !== undefined ? lvClone(data[b][key]) : null; });
  const plan = lvGet(data, "planSwaps", lvDayOf(key), null);
  return { key: key, parts: parts, plan: plan ? lvClone(plan) : null };
}
function lvRestore(data, snap) {
  let out = data;
  LV_PARTS.forEach(function (b) { out = lvPut(out, b, snap.key, snap.parts[b] === null ? null : lvClone(snap.parts[b])); });
  if (snap.plan || lvGet(out, "planSwaps", lvDayOf(snap.key), null)) out = lvPut(out, "planSwaps", lvDayOf(snap.key), snap.plan ? lvClone(snap.plan) : null);
  return out;
}

// Упражнение по id из всего пула (программы и замены). Данные после загрузки страницы не меняются,
// поэтому указатель строится один раз.
let lvPool = null;
function lvFind(id) {
  if (!lvPool) {
    lvPool = {};
    Object.keys(PROGRAM).forEach(function (k) { PROGRAM[k].exercises.forEach(function (e) { if (!lvPool[e.id]) lvPool[e.id] = e; }); });
    Object.keys(ALTERNATIVES).forEach(function (k) { ALTERNATIVES[k].forEach(function (e) { if (!lvPool[e.id]) lvPool[e.id] = e; }); });
  }
  return lvPool[id] || null;
}

// Список в порядке order; чего в order нет (добавили позже) - в конце, в прежнем порядке
function lvOrdered(list, order) {
  if (!order || !order.length) return list;
  const pos = {};
  order.forEach(function (id, i) { if (pos[id] === undefined) pos[id] = i; });
  return list
    .map(function (e, i) { return { e: e, p: pos[e.id] === undefined ? order.length + i : pos[e.id] }; })
    .sort(function (a, b) { return a.p - b.p; })
    .map(function (x) { return x.e; });
}

// Слоты тренировки: упражнения дня (base) и добавленные сегодня, в порядке показа
function lvList(data, key, base) {
  return lvOrdered((base || []).concat(lvGet(data, "addedEx", key, [])), lvGet(data, "order", key, null));
}

function lvIsSkipped(data, key, slotId) {
  return lvGet(data, "skipped", key, []).indexOf(slotId) >= 0;
}

// id упражнения, которое стоит в слоте ВМЕСТО исходного, или null. Замена на сегодня важнее запомненной;
// запись "слот -> он сам" в swaps значит "сегодня исходное, хотя замена запомнена". У добавленных сегодня
// упражнений запомненных замен нет (slot - запись слота, если она под рукой).
function lvSwapOf(data, key, slotId, slot) {
  const today = lvGet(data, "swaps", key, {})[slotId];
  if (today) return today === slotId ? null : today;
  if (slot && slot._added) return null;
  const kept = lvPlan(data, key)[slotId];
  return kept && kept !== slotId ? kept : null;
}

// Что сейчас в слоте: само упражнение или его замена, сколько подходов запланировано и сколько отмечено.
// plan - id запомненной замены слота (или null), kept - она сейчас и стоит.
function lvSlot(data, key, base, slotId) {
  const list = lvList(data, key, base);
  let slot = null;
  list.forEach(function (e) { if (e.id === slotId) slot = e; });
  if (!slot) return null;
  let ex = slot;
  const sw = lvSwapOf(data, key, slotId, slot);
  if (sw) { const alt = lvFind(sw); if (alt) ex = alt; }
  const plan = slot._added ? null : (lvPlan(data, key)[slotId] || null);
  const custom = lvGet(data, "customSets", key, {})[slotId];
  const n = custom !== undefined ? custom : (ex.sets || 3);
  const sets = lvGet(data, "sessions", key, {})[ex.id] || {};
  let done = 0;
  for (let i = 0; i < n; i++) if (sets[i] && sets[i].done) done++;
  return { slot: slot, ex: ex, swapped: ex !== slot, added: !!slot._added, n: n, done: done, skipped: lvIsSkipped(data, key, slotId), plan: plan, kept: !!plan && plan === ex.id };
}

// Какие id уже заняты в тренировке (слоты и стоящие в них замены): второй раз то же упражнение не берём,
// иначе два слота писали бы подходы в одно место
function lvBusy(data, key, base) {
  const busy = {};
  lvList(data, key, base).forEach(function (e) {
    busy[e.id] = true;
    const s = lvSlot(data, key, base, e.id);
    if (s) busy[s.ex.id] = true;
  });
  return busy;
}

// Запись добавленного упражнения (тот же вид, что делает addExerciseToSession в основном файле)
function lvAddedRec(rec, sets) {
  return { id: rec.id, name: rec.name, sets: sets || rec.sets, reps: rec.reps, rest: rec.rest, steps: rec.steps, warn: rec.warn, danger: rec.danger, _added: true };
}

// Оставить в упражнении только отмеченные подходы, сдвинув их к началу: 1 и 3 из четырёх станут 1 и 2
function lvCompact(data, key, exId, n) {
  const sess = lvClone(lvGet(data, "sessions", key, {}));
  const sets = sess[exId] || {};
  const kept = {};
  let d = 0;
  for (let i = 0; i < n; i++) if (sets[i] && sets[i].done) { kept[d] = sets[i]; d++; }
  sess[exId] = kept;
  return { data: lvPut(data, "sessions", key, sess), done: d };
}

function lvSetCustom(data, key, slotId, n) {
  const cs = lvClone(lvGet(data, "customSets", key, {}));
  if (n === null) delete cs[slotId]; else cs[slotId] = n;
  return lvPut(data, "customSets", key, cs);
}

// ---- Порядок ----
function lvIds(data, key, base) {
  return lvList(data, key, base).map(function (e) { return e.id; });
}

// Можно ли подвинуть слот среди видимых (непропущенных)
function lvCanMove(data, key, base, slotId) {
  const vis = lvIds(data, key, base).filter(function (id) { return !lvIsSkipped(data, key, id); });
  const i = vis.indexOf(slotId);
  return { up: i > 0, down: i >= 0 && i < vis.length - 1 };
}

// dir: -1 выше, 1 ниже. Меняется местами с соседним ВИДИМЫМ слотом
function lvMove(data, key, base, slotId, dir) {
  const ids = lvIds(data, key, base);
  const vis = ids.filter(function (id) { return !lvIsSkipped(data, key, id); });
  const i = vis.indexOf(slotId);
  const other = i < 0 ? undefined : vis[i + dir];
  if (other === undefined) return data;
  const a = ids.indexOf(slotId), b = ids.indexOf(other);
  ids[a] = other; ids[b] = slotId;
  return lvPut(data, "order", key, ids);
}

function lvToEnd(data, key, base, slotId) {
  if (!lvCanMove(data, key, base, slotId).down) return data;
  const ids = lvIds(data, key, base).filter(function (id) { return id !== slotId; });
  ids.push(slotId);
  return lvPut(data, "order", key, ids);
}

// ---- Замена ----
// Запись в swaps на сегодня (exId === slotId - "сегодня исходное"; null - убрать запись)
function lvSetSwap(data, key, slotId, exId) {
  const sw = lvClone(lvGet(data, "swaps", key, {}));
  if (exId === null) delete sw[slotId]; else sw[slotId] = exId;
  return lvPut(data, "swaps", key, sw);
}
// Запомненная замена слота (null - забыть)
function lvSetPlan(data, key, slotId, exId) {
  const plan = lvClone(lvPlan(data, key));
  if (exId === null) delete plan[slotId]; else plan[slotId] = exId;
  return lvPut(data, "planSwaps", lvDayOf(key), Object.keys(plan).length ? plan : null);
}

// rec - упражнение из пула; always - запомнить замену на следующие тренировки (у добавленных сегодня не действует).
// Возвращает { data, mode }:
//   "swap"  - в слоте теперь другое упражнение (подходов ещё не было);
//   "split" - подходы уже были: слот закончен на сделанных, замена добавлена следом на оставшиеся (kept - сколько сделано);
//   "none"  - ничего не изменилось (то же упражнение, или оно уже есть в тренировке).
function lvReplace(data, key, base, slotId, rec, always) {
  const s = lvSlot(data, key, base, slotId);
  if (!s || !rec || rec.id === s.ex.id) return { data: data, mode: "none" };
  const keep = !!always && !s.added;
  if (s.done === 0) {
    // возврат исходного упражнения слота: навсегда (замена забыта) или только сегодня (запомненная остаётся)
    if (rec.id === slotId) {
      if (keep) return { data: lvSetSwap(lvSetPlan(data, key, slotId, null), key, slotId, null), mode: "swap" };
      return { data: lvSetSwap(data, key, slotId, s.plan ? slotId : null), mode: "swap" };
    }
    if (lvBusy(data, key, base)[rec.id]) return { data: data, mode: "none" };
    if (s.added) {
      // добавленное упражнение заменяется записью на том же месте
      const ids = lvIds(data, key, base).map(function (id) { return id === slotId ? rec.id : id; });
      const added = lvGet(data, "addedEx", key, []).map(function (e) { return e.id === slotId ? lvAddedRec(rec) : e; });
      let out = lvPut(data, "addedEx", key, added);
      out = lvSetCustom(out, key, slotId, null);
      return { data: lvPut(out, "order", key, ids), mode: "swap" };
    }
    const swapped = lvSetSwap(data, key, slotId, rec.id);
    return { data: keep ? lvSetPlan(swapped, key, slotId, rec.id) : swapped, mode: "swap" };
  }
  if (lvBusy(data, key, base)[rec.id]) return { data: data, mode: "none" };
  // подходы уже были: оставляем сделанное, замену ставим следом
  const ids = lvIds(data, key, base);
  const c = lvCompact(data, key, s.ex.id, s.n);
  let out = lvSetCustom(c.data, key, slotId, c.done);
  const left = s.n - c.done;
  out = lvPut(out, "addedEx", key, lvGet(out, "addedEx", key, []).concat([lvAddedRec(rec, left > 0 ? left : rec.sets)]));
  ids.splice(ids.indexOf(slotId) + 1, 0, rec.id);
  out = lvPut(out, "order", key, ids);
  // запомнить: со следующей тренировки в слоте будет замена, а сегодня слот остаётся с тем, что уже начато
  if (keep) out = lvSetPlan(lvSetSwap(out, key, slotId, s.ex.id), key, slotId, rec.id);
  return { data: out, mode: "split", kept: c.done };
}

// Запомнить ту замену, что стоит в слоте сейчас; забыть запомненную (сегодня в слоте остаётся то, что стоит)
function lvKeep(data, key, base, slotId) {
  const s = lvSlot(data, key, base, slotId);
  if (!s || s.added || !s.swapped || s.kept) return data;
  return lvSetPlan(lvSetSwap(data, key, slotId, s.ex.id), key, slotId, s.ex.id);
}
function lvForget(data, key, base, slotId) {
  const s = lvSlot(data, key, base, slotId);
  if (!s || !s.plan) return data;
  return lvSetPlan(lvSetSwap(data, key, slotId, s.swapped ? s.ex.id : null), key, slotId, null);
}

// ---- Пропуск ----
// "skip" - упражнение пропущено сегодня; "remove" - добавленное убрано; "trim" - подходы уже были, упражнение
// закончено на сделанных (kept); "none" - все подходы сделаны, менять нечего.
function lvSkip(data, key, base, slotId) {
  const s = lvSlot(data, key, base, slotId);
  if (!s) return { data: data, mode: "none" };
  if (s.done === 0) {
    if (s.added) {
      const added = lvGet(data, "addedEx", key, []).filter(function (e) { return e.id !== slotId; });
      const ids = lvGet(data, "order", key, null);
      let out = lvPut(data, "addedEx", key, added);
      out = lvSetCustom(out, key, slotId, null);
      if (ids) out = lvPut(out, "order", key, ids.filter(function (id) { return id !== slotId; }));
      return { data: out, mode: "remove" };
    }
    if (s.skipped) return { data: data, mode: "none" };
    return { data: lvPut(data, "skipped", key, lvGet(data, "skipped", key, []).concat([slotId])), mode: "skip" };
  }
  if (s.done >= s.n) return { data: data, mode: "none" };
  const c = lvCompact(data, key, s.ex.id, s.n);
  return { data: lvSetCustom(c.data, key, slotId, c.done), mode: "trim", kept: c.done };
}

function lvUnskip(data, key, slotId) {
  const sk = lvGet(data, "skipped", key, []);
  if (sk.indexOf(slotId) < 0) return data;
  return lvPut(data, "skipped", key, sk.filter(function (id) { return id !== slotId; }));
}

// Есть ли сегодня отступления от плана
function lvChanged(data, key) {
  const n = function (b) { const v = lvGet(data, b, key, null); return v ? Object.keys(v).length : 0; };
  return n("swaps") + n("skipped") + n("addedEx") + n("customSets") + n("order") > 0;
}

// Вернуть план: всё, что ещё не начато, становится как в программе. Упражнения с отмеченными подходами
// (замены, добавленные, с изменённым числом подходов) остаются как есть - сделанное не трогаем.
function lvReset(data, key, base) {
  const keepSwap = {}, keepSets = {}, keepAdded = [];
  const swaps = lvGet(data, "swaps", key, {}), custom = lvGet(data, "customSets", key, {});
  lvList(data, key, base).forEach(function (e) {
    const s = lvSlot(data, key, base, e.id);
    if (!s || s.done === 0) return;
    if (swaps[e.id]) keepSwap[e.id] = swaps[e.id];
    if (custom[e.id] !== undefined) keepSets[e.id] = custom[e.id];
    if (e._added) keepAdded.push(e);
  });
  let out = lvPut(data, "order", key, null);
  out = lvPut(out, "skipped", key, null);
  out = lvPut(out, "swaps", key, Object.keys(keepSwap).length ? keepSwap : null);
  out = lvPut(out, "customSets", key, Object.keys(keepSets).length ? keepSets : null);
  return lvPut(out, "addedEx", key, keepAdded.length ? keepAdded : null);
}

// ---- Выбор замены ----
function lvNorm(s) { return String(s || "").toLowerCase().replace(/ё/g, "е"); }

// 1 подход, 2 подхода, 5 подходов
function lvWord(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}
const LV_SETS = ["подход", "подхода", "подходов"];
const LV_EXES = ["упражнение", "упражнения", "упражнений"];

// Разделы окна выбора. all - пул с группами мышц (getAllExercises), s - слот (lvSlot), busy - занятые id,
// q - строка поиска, showAll - показать весь пул. Возвращает { sections: [{ title, items: [{ ex, busy, orig }] }], rest }
function lvCandidates(all, s, slotId, busy, q, showAll) {
  // занятые (уже в тренировке) уходят в конец раздела: сначала то, что можно выбрать
  const items = function (list) {
    const free = [], taken = [];
    list.forEach(function (e) { (busy[e.id] ? taken : free).push({ ex: e, busy: !!busy[e.id], orig: false }); });
    return free.concat(taken);
  };
  const cur = s.ex.id;
  const words = lvNorm(q).split(/\s+/).filter(Boolean);
  if (words.length) {
    const found = all.filter(function (e) {
      if (e.id === cur) return false;
      const hay = lvNorm(e.name) + " " + lvNorm(e._group);
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    return { sections: [{ title: "НАЙДЕНО: " + found.length, items: items(found) }], rest: 0 };
  }
  const sections = [];
  const used = {};
  used[cur] = true;
  // исходное упражнение слота, если сейчас стоит замена и подходов ещё нет
  if (s.swapped && s.done === 0) {
    sections.push({ title: "ИСХОДНОЕ УПРАЖНЕНИЕ", items: [{ ex: s.slot, busy: false, orig: true }] });
    used[slotId] = true;
  }
  const recIds = {};
  (ALTERNATIVES[slotId] || []).concat(ALTERNATIVES[cur] || []).forEach(function (e) { recIds[e.id] = true; });
  const recs = all.filter(function (e) { return recIds[e.id] && !used[e.id]; });
  recs.forEach(function (e) { used[e.id] = true; });
  if (recs.length) sections.push({ title: "ЛУЧШИЕ ЗАМЕНЫ", items: items(recs) });
  let group = null;
  all.forEach(function (e) { if (e.id === cur || (!group && e.id === slotId)) group = e._group; });
  if (group && group !== "Другое") {
    const same = all.filter(function (e) { return e._group === group && !used[e.id]; });
    same.forEach(function (e) { used[e.id] = true; });
    if (same.length) sections.push({ title: "ТА ЖЕ ГРУППА: " + group.toUpperCase(), items: items(same) });
  }
  const others = all.filter(function (e) { return !used[e.id]; });
  if (!showAll) return { sections: sections, rest: others.length };
  const byGroup = {}, order = [];
  others.forEach(function (e) {
    const g = e._group || "Другое";
    if (!byGroup[g]) { byGroup[g] = []; order.push(g); }
    byGroup[g].push(e);
  });
  order.forEach(function (g) { sections.push({ title: g.toUpperCase(), items: items(byGroup[g]) }); });
  return { sections: sections, rest: 0 };
}

// ---- Интерфейс ----
// Ключевые кадры лежат здесь, рядом с компонентами, которые ими пользуются. Каждый
// движущийся элемент помечен классом app-anim, правило "уменьшить движение" из head.html их отключает.
// Кадры только "from": без анимации окна выглядят итоговыми.
const LV_CSS = [
  "@keyframes lvFade{from{opacity:0}to{opacity:1}}",
  "@keyframes lvUp{from{opacity:0;transform:translateY(60px)}to{opacity:1;transform:none}}",
  "@keyframes lvToast{from{opacity:0;transform:translateY(24px) scale(.97)}to{opacity:1;transform:none}}",
  "@keyframes lvFlash{from{box-shadow:0 0 0 2px var(--lv-c,currentColor),0 0 22px var(--lv-c,currentColor)}to{box-shadow:0 0 0 0 transparent}}",
  "@keyframes lvBar{from{transform:scaleX(1)}to{transform:scaleX(0)}}",
  ".lv-fade{animation:lvFade .2s ease-out backwards}",
  ".lv-up{animation:lvUp .32s cubic-bezier(.2,.9,.3,1) backwards}",
  ".lv-toast{animation:lvToast .28s cubic-bezier(.2,.9,.3,1) backwards}",
  ".lv-flash{animation:lvFlash 1s ease-out backwards}",
  ".lv-bar{animation:lvBar 6s linear forwards;transform-origin:left}",
  ".lv-row:active{background:var(--bg-1a1a22)}",
].join("\n");

const LV_ICONS = {
  dots: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  swap: ["M7 4L3 8l4 4", "M3 8h14", "M17 20l4-4-4-4", "M21 16H7"],
  up: ["M12 19V5", "M5 12l7-7 7 7"],
  down: ["M12 5v14", "M5 12l7 7 7-7"],
  end: ["M12 3v12", "M6 9l6 6 6-6", "M5 21h14"],
  skip: ["M5 5l14 14", "M12 3a9 9 0 100 18 9 9 0 000-18z"],
  check: ["M5 12l5 5L20 7"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  undo: ["M9 14L4 9l5-5", "M4 9h10a6 6 0 010 12h-3"],
  pin: ["M6 4h12v17l-6-4-6 4z"],
  unpin: ["M6 4h12v17l-6-4-6 4z", "M4 3l16 18"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  plus: ["M12 5v14", "M5 12h14"],
  close: ["M6 6l12 12", "M18 6L6 18"],
};

function LvIcon(props) {
  const size = props.size || 20;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={props.name === "dots" ? 3.2 : 2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {LV_ICONS[props.name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// Кнопка с тремя точками на карточке упражнения
function LvMenuButton(props) {
  return (
    <button onClick={props.onClick} aria-label={"Изменить упражнение: " + props.name}
      style={{ width: 44, height: 44, borderRadius: 11, border: `1px solid ${props.active ? props.color + "60" : "var(--bd-2a2a2a)"}`, background: props.active ? `${props.color}15` : "var(--bg-0c0c0f)", color: props.active ? props.ink(props.color) : "var(--tx-888)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0 }}>
      <LvIcon name="dots" />
    </button>
  );
}

// Строка над списком: сколько упражнений сегодня и кнопка обзора
function LvBar(props) {
  const ids = lvIds(props.data, props.sessionKey, props.base);
  const skipped = ids.filter(id => lvIsSkipped(props.data, props.sessionKey, id)).length;
  const shown = ids.length - skipped;
  const changed = lvChanged(props.data, props.sessionKey);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "var(--tx-666)", letterSpacing: 1, lineHeight: 1.5, minWidth: 0 }}>
        {shown} {lvWord(shown, LV_EXES)}{skipped > 0 ? "  |  пропущено: " + skipped : ""}
        {changed && <span style={{ color: props.ink(props.color) }}>  |  изменено</span>}
      </div>
      <button onClick={props.onOpen}
        style={{ minHeight: 44, padding: "0 14px", borderRadius: 10, border: `1px solid ${changed ? props.color + "60" : "var(--bd-2a2a2a)"}`, background: changed ? `${props.color}12` : "var(--bg-0c0c0f)", color: changed ? props.ink(props.color) : "var(--tx-888)", fontSize: 10, letterSpacing: 2, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <LvIcon name="list" size={16} />
        СОСТАВ
      </button>
    </div>
  );
}

// Пропущенные сегодня упражнения под списком: видно, что пропущено, и вернуть можно одним нажатием
function LvSkipped(props) {
  const key = props.sessionKey;
  const list = lvList(props.data, key, props.base).filter(e => lvIsSkipped(props.data, key, e.id));
  if (!list.length) return null;
  return (
    <div style={{ border: "1px dashed var(--bd-2a2a2a)", borderRadius: 12, padding: "12px 12px 6px 14px", marginBottom: 12 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--tx-666)", marginBottom: 6 }}>ПРОПУЩЕНО СЕГОДНЯ</div>
      {list.map(e => {
        const s = lvSlot(props.data, key, props.base, e.id);
        return (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--tx-777)", lineHeight: 1.35 }}>{s.ex.name}</div>
            <button onClick={() => props.setData(prev => lvUnskip(prev, key, e.id))}
              style={{ minHeight: 44, padding: "0 14px", borderRadius: 10, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-0c0c0f)", color: "var(--tx-aaa)", fontSize: 10, letterSpacing: 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
              ВЕРНУТЬ
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Нижнее окно: общий каркас
function LvSheet(props) {
  return (
    <div role="dialog" aria-modal="true" aria-label={props.label} className="app-anim lv-fade" onClick={props.onClose}
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 640, background: "var(--scrim)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div className="app-anim lv-up" onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", WebkitOverflowScrolling: "touch", background: "var(--bg-111)", borderRadius: "22px 22px 0 0", borderTop: "1px solid var(--bd-2a2a35)", padding: "10px 16px calc(20px + env(safe-area-inset-bottom))", boxShadow: "var(--shadow-pop)" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--bd-2a2a35)", margin: "0 auto 14px" }} />
        {props.children}
      </div>
    </div>
  );
}

// Строка действия в окне упражнения
function LvAction(props) {
  return (
    <button className="lv-row" onClick={props.onClick}
      style={{ width: "100%", minHeight: 60, display: "flex", alignItems: "center", gap: 14, padding: "10px 12px", marginBottom: 8, borderRadius: 14, border: "1px solid var(--bd-1a1a22)", background: "var(--bg-0f0f12)", color: props.tone || "var(--tx-fff)", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
      <span style={{ width: 40, height: 40, borderRadius: 11, background: "var(--bg-1a1a22)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><LvIcon name={props.icon} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{props.title}</span>
        {props.sub && <span style={{ display: "block", fontSize: 11, color: "var(--tx-777)", lineHeight: 1.45, marginTop: 2 }}>{props.sub}</span>}
      </span>
    </button>
  );
}

function LvClose(props) {
  return (
    <button onClick={props.onClick}
      style={{ width: "100%", minHeight: 48, borderRadius: 12, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-1a1a22)", color: "var(--tx-999)", fontSize: 11, letterSpacing: 2, cursor: "pointer", fontFamily: "inherit", marginTop: 4 }}>
      {props.text || "ЗАКРЫТЬ"}
    </button>
  );
}

// Окно упражнения: заменить, порядок, пропустить
function LvMenu(props) {
  const s = props.slot;
  const can = props.can;
  const moveBtn = (icon, text, on, onClick) => (
    <button key={text} onClick={on ? onClick : undefined} disabled={!on}
      style={{ flex: 1, minHeight: 56, borderRadius: 12, border: "1px solid var(--bd-1a1a22)", background: "var(--bg-0f0f12)", color: on ? "var(--tx-fff)" : "var(--tx-444)", opacity: on ? 1 : 0.5, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: on ? "pointer" : "default", fontFamily: "inherit", fontSize: 9, letterSpacing: 1, fontWeight: 700, padding: "6px 2px" }}>
      <LvIcon name={icon} size={18} />
      {text}
    </button>
  );
  const left = s.n - s.done;
  return (
    <LvSheet label={s.ex.name} onClose={props.onClose}>
      <div style={{ padding: "0 4px 14px" }}>
        <div style={{ fontSize: 9, letterSpacing: 3, color: "var(--tx-666)", marginBottom: 6 }}>УПРАЖНЕНИЕ {props.no} ИЗ {props.total}</div>
        <div style={{ fontSize: 17, fontWeight: 800, color: "var(--tx-fff)", lineHeight: 1.3, marginBottom: 6 }}>{s.ex.name}</div>
        <div style={{ fontSize: 11, color: "var(--tx-777)", lineHeight: 1.5 }}>
          {s.done === 0 ? "Ещё не начато" : s.done >= s.n ? "Все подходы сделаны" : "Сделано подходов: " + s.done + " из " + s.n}
          {s.swapped ? "  |  вместо: " + s.slot.name : ""}
          {s.added ? "  |  добавлено сегодня" : ""}
        </div>
        {s.plan && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: props.ink(props.color), lineHeight: 1.5, marginTop: 6 }}>
            <LvIcon name="pin" size={14} />
            <span>{s.kept ? "Замена запомнена: так будет и в следующих тренировках" : "Запомнена замена: " + props.planName}</span>
          </div>
        )}
      </div>

      {s.done < s.n && (
        <LvAction icon="swap" title="Заменить" onClick={props.onReplace}
          sub={s.done > 0 ? "Сделанное останется (" + s.done + " " + lvWord(s.done, LV_SETS) + "), замена встанет следом: " + left + " " + lvWord(left, LV_SETS) : s.added ? "Другое упражнение на сегодня" : "Другое упражнение: на сегодня или насовсем"} />
      )}

      {s.swapped && !s.kept && !s.added && (
        <LvAction icon="pin" title="Запомнить замену" sub={"В следующих тренировках здесь будет: " + s.ex.name} onClick={props.onKeep} />
      )}
      {s.plan && (
        <LvAction icon="unpin" title="Больше не заменять" sub={"Со следующей тренировки вернётся: " + s.slot.name + ". Сегодня ничего не изменится"} onClick={props.onForget} />
      )}

      <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--tx-666)", margin: "10px 4px 8px" }}>ПОРЯДОК</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {moveBtn("up", "ВЫШЕ", can.up, () => props.onMove(-1))}
        {moveBtn("down", "НИЖЕ", can.down, () => props.onMove(1))}
        {moveBtn("end", "В КОНЕЦ", can.down, props.onEnd)}
      </div>

      {s.done === 0 && !s.added && (
        <LvAction icon="skip" title="Пропустить сегодня" sub="В следующий раз упражнение вернётся" onClick={props.onSkip} />
      )}
      {s.done === 0 && s.added && (
        <LvAction icon="trash" title="Убрать из тренировки" sub="Добавлено сегодня, подходов ещё нет" onClick={props.onSkip} />
      )}
      {s.done > 0 && s.done < s.n && (
        <LvAction icon="check" title={"Закончить на " + s.done + " " + lvWord(s.done, ["подходе", "подходах", "подходах"])} sub={"Несделанное уберётся (" + left + " " + lvWord(left, LV_SETS) + "), упражнение засчитается"} onClick={props.onSkip} />
      )}
      <LvClose onClick={props.onClose} />
    </LvSheet>
  );
}

// Окно выбора замены
function LvPicker(props) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [always, setAlways] = useState(false);
  const s = props.slot;
  const res = lvCandidates(props.all, s, props.slotId, props.busy, q, showAll);
  return (
    <LvSheet label="Замена упражнения" onClose={props.onClose}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0, padding: "0 4px" }}>
          <div style={{ fontSize: 9, letterSpacing: 3, color: "var(--tx-666)", marginBottom: 6 }}>ЗАМЕНА</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--tx-fff)", lineHeight: 1.3 }}>{s.ex.name}</div>
          {s.done > 0 && <div style={{ fontSize: 11, color: "var(--tx-777)", lineHeight: 1.5, marginTop: 4 }}>Сделанные подходы останутся, новое упражнение встанет следом</div>}
        </div>
        <button onClick={props.onClose} aria-label="Закрыть"
          style={{ width: 44, height: 44, borderRadius: 11, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-0c0c0f)", color: "var(--tx-888)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0 }}>
          <LvIcon name="close" size={18} />
        </button>
      </div>
      {!s.added && (
        <div style={{ marginBottom: 12 }}>
          <div role="group" aria-label="На какой срок заменить" style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            {[[false, "ТОЛЬКО СЕГОДНЯ"], [true, "ВСЕГДА"]].map(m => {
              const sel = always === m[0];
              return (
                <button key={m[1]} onClick={() => setAlways(m[0])} aria-pressed={sel}
                  style={{ flex: 1, minHeight: 44, borderRadius: 11, border: `1px solid ${sel ? props.color + "70" : "var(--bd-2a2a2a)"}`, background: sel ? `${props.color}18` : "var(--bg-0c0c0f)", color: sel ? props.ink(props.color) : "var(--tx-777)", fontSize: 10, letterSpacing: 1, fontWeight: sel ? 800 : 400, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  {m[0] && <LvIcon name="pin" size={14} />}
                  {m[1]}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: "var(--tx-777)", lineHeight: 1.45, padding: "0 4px" }}>
            {always ? "Замена запомнится: в следующих тренировках этого дня будет выбранное упражнение" : s.plan ? "Только эта тренировка. В следующий раз будет запомненная замена" : "Только эта тренировка. В следующий раз упражнение вернётся"}
          </div>
        </div>
      )}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск: название или группа"
        style={{ width: "100%", background: "var(--bg-0c0c0f)", border: "1px solid var(--bd-2a2a2a)", borderRadius: 12, padding: "13px 14px", color: "var(--tx-fff)", fontSize: 16, fontFamily: "inherit", outline: "none", marginBottom: 14, boxSizing: "border-box" }} />
      {res.sections.map(sec => (
        <div key={sec.title} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--tx-888)", margin: "0 4px 8px" }}>{sec.title}</div>
          {sec.items.length === 0 && <div style={{ fontSize: 12, color: "var(--tx-666)", padding: "8px 4px" }}>Ничего не нашлось</div>}
          {sec.items.map(it => (
            <button key={it.ex.id} className="lv-row" disabled={it.busy} onClick={() => props.onPick(it.ex, always)}
              style={{ width: "100%", minHeight: 56, display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 6, borderRadius: 12, border: `1px solid ${it.orig ? props.color + "60" : "var(--bd-1a1a22)"}`, background: it.orig ? `${props.color}12` : "var(--bg-0f0f12)", opacity: it.busy ? 0.45 : 1, cursor: it.busy ? "default" : "pointer", fontFamily: "inherit", textAlign: "left" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: it.busy ? "var(--tx-666)" : "var(--tx-fff)", lineHeight: 1.35 }}>{it.ex.name}</span>
                <span style={{ display: "block", fontSize: 10, color: "var(--tx-666)", marginTop: 3 }}>
                  {it.busy ? "уже в тренировке" : it.ex.sets + " x " + it.ex.reps + "  |  " + it.ex.rest}{it.orig ? "  |  исходное упражнение" : ""}
                </span>
              </span>
              {!it.busy && <span style={{ color: props.ink(props.color), display: "flex" }}><LvIcon name={it.orig ? "undo" : "swap"} size={18} /></span>}
            </button>
          ))}
        </div>
      ))}
      {res.rest > 0 && (
        <button onClick={() => setShowAll(true)}
          style={{ width: "100%", minHeight: 48, borderRadius: 12, border: "1px dashed var(--bd-2a2a2a)", background: "none", color: "var(--tx-999)", fontSize: 10, letterSpacing: 2, cursor: "pointer", fontFamily: "inherit", marginBottom: 8 }}>
          ВСЕ УПРАЖНЕНИЯ: ЕЩЁ {res.rest}
        </button>
      )}
    </LvSheet>
  );
}

// Обзор тренировки: порядок, пропущенные, добавить, вернуть план
function LvOverview(props) {
  const key = props.sessionKey, data = props.data, base = props.base;
  const list = lvList(data, key, base);
  const shown = list.filter(e => !lvIsSkipped(data, key, e.id));
  const skipped = list.filter(e => lvIsSkipped(data, key, e.id));
  const arrow = (icon, label, on, onClick) => (
    <button onClick={on ? onClick : undefined} disabled={!on} aria-label={label}
      style={{ width: 44, height: 44, borderRadius: 11, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-0c0c0f)", color: on ? "var(--tx-ccc)" : "var(--tx-333)", opacity: on ? 1 : 0.5, display: "flex", alignItems: "center", justifyContent: "center", cursor: on ? "pointer" : "default", flexShrink: 0, padding: 0 }}>
      <LvIcon name={icon} size={18} />
    </button>
  );
  return (
    <LvSheet label="Состав тренировки" onClose={props.onClose}>
      <div style={{ padding: "0 4px 12px" }}>
        <div style={{ fontSize: 9, letterSpacing: 3, color: "var(--tx-666)", marginBottom: 6 }}>СОСТАВ НА СЕГОДНЯ</div>
        <div style={{ fontSize: 11, color: "var(--tx-777)", lineHeight: 1.5 }}>Правки действуют только на эту тренировку. Нажатие на название - переход к упражнению.</div>
      </div>
      {shown.map((e, i) => {
        const s = lvSlot(data, key, base, e.id);
        const full = s.done >= s.n;
        return (
          <div key={e.id + (props.moved === e.id ? "-" + props.movedAt : "")} className={props.moved === e.id ? "app-anim lv-flash" : undefined}
            style={{ "--lv-c": props.color, display: "flex", alignItems: "center", gap: 8, padding: "6px 6px 6px 12px", marginBottom: 6, borderRadius: 12, border: `1px solid ${full ? props.color + "50" : "var(--bd-1a1a22)"}`, background: "var(--bg-0f0f12)" }}>
            <button onClick={() => props.onJump(e.id)}
              style={{ flex: 1, minWidth: 0, minHeight: 44, display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
              <span style={{ width: 22, fontSize: 12, fontWeight: 700, color: full ? props.ink(props.color) : "var(--tx-555)", flexShrink: 0 }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--tx-fff)", lineHeight: 1.3 }}>{s.ex.name}</span>
                <span style={{ display: "block", fontSize: 10, color: "var(--tx-666)", marginTop: 2 }}>
                  {s.done} / {s.n}{s.kept ? "  |  замена запомнена" : s.swapped ? "  |  замена" : ""}{s.added ? "  |  добавлено" : ""}
                </span>
              </span>
            </button>
            {arrow("up", "Выше: " + s.ex.name, i > 0, () => props.onMove(e.id, -1))}
            {arrow("down", "Ниже: " + s.ex.name, i < shown.length - 1, () => props.onMove(e.id, 1))}
          </div>
        );
      })}
      {skipped.length > 0 && <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--tx-666)", margin: "14px 4px 8px" }}>ПРОПУЩЕНО</div>}
      {skipped.map(e => {
        const s = lvSlot(data, key, base, e.id);
        return (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px 6px 12px", marginBottom: 6, borderRadius: 12, border: "1px dashed var(--bd-2a2a2a)" }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--tx-777)", lineHeight: 1.3 }}>{s.ex.name}</div>
            <button onClick={() => props.onUnskip(e.id)}
              style={{ minHeight: 44, padding: "0 14px", borderRadius: 10, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-0c0c0f)", color: "var(--tx-aaa)", fontSize: 10, letterSpacing: 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
              ВЕРНУТЬ
            </button>
          </div>
        );
      })}
      <button onClick={props.onAdd}
        style={{ width: "100%", minHeight: 48, borderRadius: 12, border: "1px dashed var(--bd-2a2a2a)", background: "none", color: "var(--tx-999)", fontSize: 10, letterSpacing: 2, cursor: "pointer", fontFamily: "inherit", margin: "8px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <LvIcon name="plus" size={16} />
        ДОБАВИТЬ УПРАЖНЕНИЕ
      </button>
      {lvChanged(data, key) && (
        <button onClick={props.onReset}
          style={{ width: "100%", minHeight: 56, borderRadius: 12, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-0c0c0f)", color: "var(--tx-ccc)", cursor: "pointer", fontFamily: "inherit", marginBottom: 8, padding: "8px 12px" }}>
          <span style={{ display: "block", fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>ВЕРНУТЬ ПЛАН</span>
          <span style={{ display: "block", fontSize: 10, color: "var(--tx-666)", marginTop: 3, lineHeight: 1.4 }}>Всё, что ещё не начато, станет как в программе</span>
        </button>
      )}
      <LvClose onClick={props.onClose} text="ГОТОВО" />
    </LvSheet>
  );
}

// Плашка "ОТМЕНИТЬ" после действия
function LvUndo(props) {
  const u = props.undo;
  if (!u) return null;
  return (
    <div role="status" aria-live="polite" style={{ position: "fixed", left: 0, right: 0, bottom: `calc(${(props.timerOn ? 128 : 28) + (props.lift || 0)}px + env(safe-area-inset-bottom))`, zIndex: 660, display: "flex", justifyContent: "center", padding: "0 14px", pointerEvents: "none" }}>
      <div key={u.id} className="app-anim lv-toast"
        style={{ pointerEvents: "auto", position: "relative", overflow: "hidden", width: "100%", maxWidth: 420, display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 8px 16px", borderRadius: 16, background: "var(--bg-1a1a22)", border: "1px solid var(--bd-2a2a35)", boxShadow: "var(--shadow-pop)" }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--tx-ccc)", lineHeight: 1.4 }}>{u.text}</div>
        <button onClick={props.onUndo}
          style={{ minHeight: 44, padding: "0 14px", borderRadius: 11, border: `1px solid ${props.color}70`, background: `${props.color}18`, color: props.ink(props.color), fontSize: 10, letterSpacing: 1, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <LvIcon name="undo" size={16} />
          ОТМЕНИТЬ
        </button>
        <div className="app-anim lv-bar" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 2, background: props.color, opacity: 0.6 }} />
      </div>
    </div>
  );
}

// Подсветить карточку упражнения на экране тренировки (после переноса или перехода из обзора)
function lvFlashCard(id, color, scroll) {
  setTimeout(function () {
    const el = document.getElementById("exc-" + id);
    if (!el) return;
    if (scroll && el.scrollIntoView) {
      let calm = false;
      try { calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
      el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
    }
    el.style.setProperty("--lv-c", color);
    el.classList.remove("app-anim", "lv-flash");
    void el.offsetWidth;
    el.classList.add("app-anim", "lv-flash");
    setTimeout(function () { el.classList.remove("app-anim", "lv-flash"); }, 1100);
  }, 80);
}

// Все окна правки. state: null | { sheet: "menu" | "pick" | "list", id }
function LvLayer(props) {
  const data = props.data, key = props.sessionKey, base = props.base;
  const st = props.state;
  const [undo, setUndo] = useState(null);
  const [moved, setMoved] = useState(null);
  const sessSig = JSON.stringify(lvGet(data, "sessions", key, null));

  // плашка отмены сама исчезает; исчезает и тогда, когда после действия отмечен подход (снимок устарел)
  useEffect(function () {
    if (!undo) return;
    const t = setTimeout(function () { setUndo(null); }, LV_UNDO_MS);
    return function () { clearTimeout(t); };
  }, [undo ? undo.id : 0]);
  useEffect(function () { if (undo && sessSig !== undo.sig) setUndo(null); }, [sessSig]);
  // открыто окно - плашка отмены мешала бы его кнопкам
  useEffect(function () { if (st) setUndo(null); }, [st ? st.sheet + "|" + st.id : ""]);
  // другой день или другая дата: окна и отмена относятся к прежней тренировке
  useEffect(function () { setUndo(null); setMoved(null); if (st) props.onState(null); }, [key]);

  // Выполнить правку: fn(data) -> новые данные. Запоминает снимок для отмены.
  const act = (text, fn) => {
    const next = fn(data);
    if (next === data) return false;
    const snap = lvSnapshot(data, key);
    props.setData(prev => fn(prev));
    setUndo({ id: Date.now(), text: text, snap: snap, sig: JSON.stringify(lvGet(next, "sessions", key, null)) });
    return true;
  };
  const doUndo = () => {
    const snap = undo.snap;
    props.setData(prev => lvRestore(prev, snap));
    setUndo(null);
  };
  const close = () => props.onState(null);

  const s = st && st.id ? lvSlot(data, key, base, st.id) : null;
  const shownIds = lvIds(data, key, base).filter(id => !lvIsSkipped(data, key, id));

  let sheet = null;
  if (st && st.sheet === "menu" && s) {
    sheet = (
      <LvMenu slot={s} can={lvCanMove(data, key, base, st.id)} no={shownIds.indexOf(st.id) + 1} total={shownIds.length} onClose={close}
        color={props.color} ink={props.ink} planName={s.plan && lvFind(s.plan) ? lvFind(s.plan).name : ""}
        onKeep={() => { act("Замена запомнена: " + s.ex.name, d => lvKeep(d, key, base, st.id)); close(); }}
        onForget={() => { act("Замена больше не запоминается", d => lvForget(d, key, base, st.id)); close(); }}
        onReplace={() => props.onState({ sheet: "pick", id: st.id })}
        onMove={dir => { if (act(dir < 0 ? "Перенесено выше" : "Перенесено ниже", d => lvMove(d, key, base, st.id, dir))) lvFlashCard(st.id, props.color, false); close(); }}
        onEnd={() => { act("Перенесено в конец", d => lvToEnd(d, key, base, st.id)); close(); }}
        onSkip={() => {
          const r = lvSkip(data, key, base, st.id);
          const text = r.mode === "skip" ? "Пропущено: " + s.ex.name : r.mode === "remove" ? "Убрано: " + s.ex.name : "Закончено на " + r.kept + " " + lvWord(r.kept, ["подходе", "подходах", "подходах"]);
          act(text, d => lvSkip(d, key, base, st.id).data);
          close();
        }} />
    );
  } else if (st && st.sheet === "pick" && s) {
    sheet = (
      <LvPicker slot={s} slotId={st.id} all={props.pool()} busy={lvBusy(data, key, base)} color={props.color} ink={props.ink} onClose={close}
        onPick={(rec, always) => {
          const r = lvReplace(data, key, base, st.id, rec, always);
          const keep = always && !s.added;
          const text = r.mode === "split" ? "Добавлено следом: " + rec.name + (keep ? ". Замена запомнена" : "")
            : rec.id === st.id ? (keep ? "Возвращено насовсем: " : "Возвращено: ") + rec.name
            : (keep ? "Заменено и запомнено: " : "Заменено на: ") + rec.name;
          if (act(text, d => lvReplace(d, key, base, st.id, rec, always).data)) lvFlashCard(r.mode === "split" || s.added ? rec.id : st.id, props.color, r.mode === "split");
          close();
        }} />
    );
  } else if (st && st.sheet === "list") {
    sheet = (
      <LvOverview data={data} sessionKey={key} base={base} color={props.color} ink={props.ink} moved={moved ? moved.id : null} movedAt={moved ? moved.at : 0} onClose={close}
        onMove={(id, dir) => { props.setData(prev => lvMove(prev, key, base, id, dir)); setMoved({ id: id, at: Date.now() }); }}
        onUnskip={id => props.setData(prev => lvUnskip(prev, key, id))}
        onJump={id => { close(); lvFlashCard(id, props.color, true); }}
        onAdd={() => { close(); props.onAdd(); }}
        onReset={() => { act("План возвращён", d => lvReset(d, key, base)); close(); }} />
    );
  }

  return (
    <>
      <style>{LV_CSS}</style>
      {sheet}
      <LvUndo undo={undo} onUndo={doUndo} color={props.color} ink={props.ink} timerOn={props.timerOn} lift={props.lift} />
    </>
  );
}
