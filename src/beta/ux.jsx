// ==== УДОБСТВА ТРЕНИРОВКИ (тестовая версия) ====
// Четыре улучшения, которые сначала проверяются здесь, а в основную версию идут после проверки:
//   1. звук в конце отдыха и при рекорде (вибрация из Safari на iPhone не работает, а экран во время
//      тренировки и так не гаснет, поэтому слышимый сигнал - единственный, который доходит);
//   2. рекорд прямо во время тренировки: всплывашка и звук, когда вес выше всех прежних;
//   3. итог после сохранения: время, объём, рекорды, сравнение с прошлой такой же тренировкой;
//   4. календарь в журнале: месяц, дни с тренировками, по нажатию окно со сведениями о дне.
//
// Тексты без "ты" и "вы": экраны тренировки и журнала в основной версии на "ты", так что при переносе
// подгонять тон не придётся. Цвета - токены темы (var(--...)), чтобы код переехал без правок.
// Всё, что тесты исполняют, лежит выше разделителя "Интерфейс" (его строка ниже) и написано обычным JS
// (глобальные todayKey и APP_VARIANT берутся из основного файла); компоненты - ниже.

const UX_SOUND_KEY = APP_VARIANT === "beta" ? "sila_sound_beta" : "sila_sound";   // как и тема: у беты свой ключ
const UX_DUR_MAX = 240;        // минут: дольше - тренировку забыли закончить, время не показываем
const UX_RECORDS_SHOWN = 4;    // сколько рекордов перечислять в итоге

// ---- Звук ----
// Нота: частота (Гц), начало (с), длина (с), громкость. Сигналы короткие и негромкие: в зале рядом люди.
function uxTones(kind) {
  const note = function (f, at, len, vol) { return { f: f, at: at, len: len, vol: vol }; };
  if (kind === "record") return [note(1047, 0, 0.14, 0.2), note(1319, 0.11, 0.14, 0.2), note(1568, 0.22, 0.14, 0.2), note(2093, 0.33, 0.45, 0.22)];
  if (kind === "done") return [note(880, 0, 0.16, 0.22), note(1175, 0.2, 0.38, 0.22)];
  return [];
}

// Включён ли звук: выбор хранится отдельным ключом (не в data, иначе поедет в файл резервной копии)
function uxSoundOn() {
  try { return localStorage.getItem(UX_SOUND_KEY) !== "off"; } catch (e) { return true; }
}
function uxSoundSet(on) {
  try { localStorage.setItem(UX_SOUND_KEY, on ? "on" : "off"); } catch (e) {}
}

let uxCtx = null;
// Создаёт или будит аудио-контекст. На iPhone звук разрешён только после нажатия, поэтому вызывается
// из обработчика касания; потом контекст живёт, пока приложение на экране.
function uxContext() {
  try {
    if (!uxCtx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      uxCtx = new C();
      // тихий отрывок в момент касания "открывает" звук на iOS надёжнее, чем один resume()
      if (uxCtx.createBuffer && uxCtx.createBufferSource) {
        const s = uxCtx.createBufferSource();
        s.buffer = uxCtx.createBuffer(1, 1, 22050);
        s.connect(uxCtx.destination);
        s.start(0);
      }
    }
    if (uxCtx.state !== "running" && uxCtx.resume) {
      const p = uxCtx.resume();
      if (p && p.catch) p.catch(function () {});
    }
    return uxCtx;
  } catch (e) { return null; }
}
function uxAudioUnlock() { return uxSoundOn() ? uxContext() : null; }

// force - сыграть, даже если звук выключен (кнопка "проверить" в настройках)
function uxPlay(kind, force) {
  try {
    if (!force && !uxSoundOn()) return false;
    const ctx = uxContext();
    if (!ctx) return false;
    const t0 = ctx.currentTime + 0.02;
    uxTones(kind).forEach(function (n) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = n.f;
      g.gain.setValueAtTime(0.0001, t0 + n.at);
      g.gain.exponentialRampToValueAtTime(n.vol, t0 + n.at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.len + 0.05);
    });
    return true;
  } catch (e) { return false; }
}

// Отдых закончился (вызывается из тика таймера)
function uxRestDone() { uxPlay("done"); }

// ---- Рекорды ----
function uxFlat(history) {
  const out = [];
  Object.keys(history || {}).forEach(function (k) {
    (history[k] || []).forEach(function (e) { if (e && typeof e === "object") out.push(e); });
  });
  return out;
}

// Лучший вес упражнения среди отмеченных подходов записей entries (плоский список)
function uxPriorBest(entries, exId) {
  let best = 0;
  (entries || []).forEach(function (e) {
    (e.detail || []).forEach(function (d) {
      if (!d || d.id !== exId) return;
      (d.sets || []).forEach(function (s) {
        if (!s || !s.done) return;
        const w = parseFloat(s.w) || 0;
        if (w > best) best = w;
      });
    });
  });
  return best;
}

// Рекорд: вес выше всего, что было раньше - в журнале (entries), в других подходах этой тренировки
// (others) и уже отпразднованного сегодня (celebrated). Первое выполнение упражнения рекордом не
// считается, как и в ачивках. Возвращает { weight, prior, gain } или null.
function uxRecordCheck(o) {
  const w = parseFloat(o.weight) || 0;
  if (!(w > 0)) return null;
  const prior = uxPriorBest(o.entries, o.exId);
  if (!(prior > 0)) return null;
  let bar = prior;
  (o.others || []).forEach(function (x) { if (x > bar) bar = x; });
  if ((o.celebrated || 0) > bar) bar = o.celebrated;
  if (!(w > bar)) return null;
  return { weight: w, prior: prior, gain: Math.round((w - prior) * 100) / 100 };
}

function uxNum(x) { return String(Math.round(x * 100) / 100); }

const uxCelebrated = {};   // "ключ тренировки|упражнение" -> самый большой уже отпразднованный вес

// Отметили подход (вызывается из toggleDone). p: data, setData, sessionKey, activeDay, session, exId,
// setIdx, weight, name, unit, show. Включает звук (нужно нажатие), запоминает начало тренировки и,
// если вес - рекорд, показывает всплывашку.
function uxOnSetDone(p) {
  try {
    uxAudioUnlock();
    if (p.setData && p.sessionKey) {
      p.setData(function (prev) {
        if (prev.started && prev.started[p.sessionKey]) return prev;
        const s = Object.assign({}, prev.started || {});
        s[p.sessionKey] = Date.now();
        return Object.assign({}, prev, { started: s });
      });
    }
    const res = p.data.resuming;
    const today = todayKey();
    // дополняемая запись и автосохранение сегодняшней тренировки не считаются "прошлым"
    const entries = uxFlat(p.data.history).filter(function (e) {
      return !(res && e.ts === res.ts) && !(e.date === today && e.workout === p.activeDay);
    });
    const others = [];
    const cur = (p.session && p.session[p.exId]) || {};
    Object.keys(cur).forEach(function (i) {
      if (+i === p.setIdx) return;
      if (cur[i] && cur[i].done) others.push(parseFloat(cur[i].weight) || 0);
    });
    const memo = p.sessionKey + "|" + p.exId;
    const rec = uxRecordCheck({ entries: entries, exId: p.exId, weight: p.weight, others: others, celebrated: uxCelebrated[memo] });
    if (!rec) return;
    uxCelebrated[memo] = rec.weight;
    uxPlay("record");
    if (p.show) p.show({ id: Date.now(), name: p.name, weight: rec.weight, prior: rec.prior, gain: rec.gain, unit: p.unit });
  } catch (e) {}
}

// ---- Итог тренировки ----
function uxDay(key) {
  const p = String(key).split("-");
  return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
}
// Номер недели (с понедельника 2024-01-01)
function uxWeek(key) { return Math.floor((uxDay(key) - uxDay("2024-01-01")) / 7); }

function uxVolumeOf(detail) {
  let v = 0;
  (detail || []).forEach(function (d) {
    ((d && d.sets) || []).forEach(function (s) { if (s && s.done) v += parseFloat(s.w) || 0; });
  });
  return Math.round(v);
}

// Минуты -> части для плитки: 52 -> {52, МИН}, 65 -> {1:05, Ч}
function uxDurParts(min) {
  const m = Math.round(min);
  if (m < 60) return { value: String(m), unit: "МИН" };
  const r = m % 60;
  return { value: Math.floor(m / 60) + ":" + (r < 10 ? "0" : "") + r, unit: "Ч" };
}
function uxDur(min) {
  const m = Math.round(min);
  if (m < 60) return m + " мин";
  const r = m % 60;
  return Math.floor(m / 60) + " ч " + (r < 10 ? "0" : "") + r + " мин";
}

// Что показать после сохранения. entry - сохранённая запись, history - журнал ДО сохранения.
// Сама запись (и её прежняя версия за ту же дату) не сравнивается с собой.
function uxSummary(entry, history, schedule) {
  const detail = entry.detail || [];
  let sets = 0, exDone = 0;
  detail.forEach(function (d) {
    const all = (d && d.sets) || [];
    let n = 0;
    all.forEach(function (s) { if (s && s.done) { n++; sets++; } });
    if (all.length > 0 && n === all.length) exDone++;
  });
  const volume = uxVolumeOf(detail);
  const before = [];
  let weekOthers = 0;
  uxFlat(history).forEach(function (e) {
    if (e.ts === entry.ts || (e.date === entry.date && e.workout === entry.workout)) return;
    if (uxWeek(e.date) === uxWeek(entry.date)) weekOthers++;
    if (e.date < entry.date || (e.date === entry.date && (e.ts || 0) < (entry.ts || 0))) before.push(e);
  });
  // прошлая такая же тренировка (тот же день программы)
  let prev = null;
  before.forEach(function (e) {
    if (e.workout !== entry.workout) return;
    if (!prev || e.date > prev.date || (e.date === prev.date && (e.ts || 0) > (prev.ts || 0))) prev = e;
  });
  const prevVolume = prev ? uxVolumeOf(prev.detail) : 0;
  const delta = prev && prevVolume > 0 ? Math.round((volume - prevVolume) / prevVolume * 100) : null;
  const records = [];
  detail.forEach(function (d) {
    if (!d) return;
    let m = 0;
    (d.sets || []).forEach(function (s) { if (s && s.done) { const x = parseFloat(s.w) || 0; if (x > m) m = x; } });
    if (!(m > 0)) return;
    const prior = uxPriorBest(before, d.id);
    if (prior > 0 && m > prior) records.push({ id: d.id, name: d.name, weight: m, prior: prior, gain: Math.round((m - prior) * 100) / 100 });
  });
  records.sort(function (a, b) { return b.gain - a.gain; });
  return {
    name: entry.name, workout: entry.workout, date: entry.date,
    dur: entry.dur || 0, volume: volume, sets: sets, setsTotal: entry.total || 0, exDone: exDone, exTotal: detail.length,
    hasPrev: !!prev, delta: delta, records: records,
    weekCount: weekOthers + 1,
    planned: (schedule || []).filter(Boolean).length,
  };
}

// Дополнительные поля записи при сохранении: сколько шла тренировка (минуты). Доп. запись (res) хранит
// прежнее время: новое от первого подхода дополнения было бы неполным.
function uxEntryExtra(data, sessionKey, res, now) {
  if (res) {
    const arr = (data.history || {})[res.workout] || [];
    const old = arr.filter(function (e) { return e.ts === res.ts; })[0];
    return old && old.dur ? { dur: old.dur } : null;
  }
  const st = data.started && data.started[sessionKey];
  if (!st) return null;
  const min = Math.round(((now === undefined ? Date.now() : now) - st) / 60000);
  return min >= 1 && min <= UX_DUR_MAX ? { dur: min } : null;
}

// Вызывается из finishWorkout после сохранения. p: entry, data (состояние ДО сохранения), sessionKey,
// setData, show, update. Возвращает true, если итог показан (тогда обычный тост не нужен).
function uxOnFinish(p) {
  try {
    const res = p.data.resuming;
    const e = res ? Object.assign({}, p.entry, { date: res.date, ts: res.ts }) : p.entry;
    const sum = uxSummary(e, p.data.history, p.data.schedule);
    sum.update = !!p.update;
    p.show(sum);
    p.setData(function (prev) {
      if (!prev.started || prev.started[p.sessionKey] === undefined) return prev;
      const s = Object.assign({}, prev.started);
      delete s[p.sessionKey];
      return Object.assign({}, prev, { started: s });
    });
    return true;
  } catch (e2) { return false; }
}

// ---- Календарь ----
const UX_MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const UX_WEEKDAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

function uxPad(n) { return n < 10 ? "0" + n : String(n); }
function uxDateKey(y, m, d) { return y + "-" + uxPad(m + 1) + "-" + uxPad(d); }

// Месяц сеткой: недели с понедельника, пустые клетки (date: null) до первого и после последнего дня.
// month - 0..11. entries - записи журнала (плоский список), today - "YYYY-MM-DD".
function uxCalMonth(entries, year, month, today) {
  const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const byDate = {};
  (entries || []).forEach(function (e) { if (e && e.date) (byDate[e.date] = byDate[e.date] || []).push(e); });
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push({ date: null });
  let volume = 0, sets = 0, workouts = 0, days = 0;
  for (let d = 1; d <= count; d++) {
    const key = uxDateKey(year, month, d);
    const items = (byDate[key] || []).slice().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    if (items.length) days++;
    items.forEach(function (e) {
      workouts++;
      const det = e.detail || [];
      if (!det.length) sets += e.done || 0;
      det.forEach(function (x) {
        ((x && x.sets) || []).forEach(function (s) { if (s && s.done) { sets++; volume += parseFloat(s.w) || 0; } });
      });
    });
    cells.push({ date: key, day: d, items: items, today: key === today, future: key > today });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null });
  return { year: year, month: month, title: UX_MONTHS[month] + " " + year, cells: cells, rows: cells.length / 7,
    stats: { workouts: workouts, days: days, sets: sets, volume: Math.round(volume) } };
}

// Сдвиг месяца: { y, m } на delta месяцев (через границу года тоже)
function uxCalShift(ym, delta) {
  const n = ym.y * 12 + ym.m + delta;
  return { y: Math.floor(n / 12), m: ((n % 12) + 12) % 12 };
}

// Самый ранний месяц журнала { y, m } или null
function uxCalFirst(entries) {
  let min = "";
  (entries || []).forEach(function (e) { if (e && e.date && (!min || e.date < min)) min = e.date; });
  return min ? { y: +min.slice(0, 4), m: +min.slice(5, 7) - 1 } : null;
}

// ---- Интерфейс ----
// Ключевые кадры лежат здесь, а не в head.html: пока функция бета, боевая страница не меняется. Каждый
// движущийся элемент помечен классом app-anim, правило "уменьшить движение" из head.html их отключает.
// Без анимации окно выглядит итоговым: кадры только "from", скрытых по умолчанию слоёв нет.
const UX_CSS = [
  "@keyframes uxDrop{from{opacity:0;transform:translateY(-130%) scale(.96)}60%{opacity:1;transform:translateY(5%) scale(1.01)}to{transform:none}}",
  "@keyframes uxShine{from{transform:translateX(-140%) skewX(-18deg)}to{transform:translateX(340%) skewX(-18deg)}}",
  "@keyframes uxRing{from{opacity:.7;transform:scale(.8)}to{opacity:0;transform:scale(1.9)}}",
  "@keyframes uxFade{from{opacity:0}to{opacity:1}}",
  "@keyframes uxUp{from{opacity:0;transform:translateY(70px)}to{opacity:1;transform:none}}",
  "@keyframes uxPop{from{opacity:0;transform:scale(.7) translateY(10px)}to{opacity:1;transform:none}}",
  "@keyframes uxBadge{0%{opacity:0;transform:scale(.3) rotate(-30deg)}60%{opacity:1;transform:scale(1.18) rotate(6deg)}100%{transform:none}}",
  "@keyframes uxRest{0%{box-shadow:0 0 0 0 rgba(0,212,170,.55)}100%{box-shadow:0 0 0 20px rgba(0,212,170,0)}}",
  ".ux-fade{animation:uxFade .25s ease-out backwards}",
  ".ux-drop{animation:uxDrop .6s cubic-bezier(.2,.9,.3,1) backwards}",
  ".ux-shine{animation:uxShine 1.3s ease-in-out .5s 2 backwards}",
  ".ux-ring{animation:uxRing 1.4s ease-out .3s 2 backwards}",
  ".ux-up{animation:uxUp .4s cubic-bezier(.2,.9,.3,1) backwards}",
  ".ux-pop{animation:uxPop .45s cubic-bezier(.2,.9,.3,1.25) backwards;animation-delay:var(--d,0s)}",
  ".ux-badge{animation:uxBadge .6s cubic-bezier(.2,.9,.3,1) .15s backwards}",
  ".ux-rest-done{animation:uxRest 1.1s ease-out 3}",
].join("\n");

// Класс карточки таймера, когда отдых закончился: бирюзовая волна
const uxRestDoneClass = "app-anim ux-rest-done";

function UxChevron(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={props.dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

// Всплывашка рекорда сверху: сама исчезает через 4 секунды, закрывается нажатием
function UxRecordPop(props) {
  const pop = props.pop;
  const close = props.onClose;
  useEffect(function () {
    if (!pop) return;
    const t = setTimeout(close, 4200);
    return function () { clearTimeout(t); };
  }, [pop ? pop.id : 0]);
  if (!pop) return null;
  return (
    <div role="status" aria-live="polite" style={{ position: "fixed", top: "calc(env(safe-area-inset-top) + 10px)", left: 0, right: 0, zIndex: 650, display: "flex", justifyContent: "center", padding: "0 14px", pointerEvents: "none" }}>
      <div className="app-anim ux-drop" onClick={close}
        style={{ pointerEvents: "auto", position: "relative", overflow: "hidden", width: "100%", maxWidth: 420, display: "flex", alignItems: "center", gap: 14, padding: "12px 16px 12px 12px", borderRadius: 20, background: "var(--bg-1a1206)", border: "1px solid #f7a84470", boxShadow: "var(--shadow-pop), 0 0 28px #f7a84430", cursor: "pointer" }}>
        <div style={{ position: "relative", width: 56, height: 56, flexShrink: 0 }}>
          <div className="app-anim ux-ring" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: "50%", border: "2px solid #f7a844" }} />
          <div className="app-anim ux-badge" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: "50%", background: "linear-gradient(135deg, #f7a844, #ffd98a)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, boxShadow: "0 4px 14px #f7a84455" }}>🏆</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: 3, fontWeight: 700, color: "var(--tx-f7a844)", marginBottom: 3 }}>НОВЫЙ РЕКОРД</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx-fff)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 4 }}>{pop.name}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: "var(--tx-fff)", lineHeight: 1 }}>{uxNum(pop.weight)}<span style={{ fontSize: 11, fontWeight: 600, color: "var(--tx-a89060)", marginLeft: 4 }}>{pop.unit}</span></span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#000", background: "#f7a844", borderRadius: 20, padding: "2px 8px" }}>+{uxNum(pop.gain)}</span>
            <span style={{ fontSize: 10, color: "var(--tx-8a7550)" }}>раньше {uxNum(pop.prior)}</span>
          </div>
        </div>
        <div className="app-anim ux-shine" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "28%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent)", pointerEvents: "none" }} />
      </div>
    </div>
  );
}

// Итог после сохранения тренировки: плитки, сравнение с прошлым разом, рекорды, неделя
function UxSummary(props) {
  const s = props.summary;
  if (!s) return null;
  const col = props.color || "#f7a844";
  const ink = props.ink || function (c) { return c; };
  const vol = formatVolume(s.volume);
  const dur = s.dur ? uxDurParts(s.dur) : null;
  const tiles = [
    { label: "ВРЕМЯ", value: dur ? dur.value : "-", unit: dur ? dur.unit : "" },
    { label: "ОБЪЁМ", value: vol.value, unit: vol.unit },
    { label: "ПОДХОДОВ", value: String(s.sets), unit: s.setsTotal ? "ИЗ " + s.setsTotal : "" },
    { label: "УПРАЖНЕНИЙ", value: String(s.exDone), unit: s.exTotal ? "ИЗ " + s.exTotal : "" },
  ];
  let cmpText, cmpTone;
  if (s.delta === null) { cmpText = s.hasPrev ? "В прошлый раз веса не записаны" : "Первая такая тренировка в журнале"; cmpTone = "flat"; }
  else if (s.delta > 0) { cmpText = "+" + s.delta + "% объёма к прошлой такой же тренировке"; cmpTone = "up"; }
  else if (s.delta === 0) { cmpText = "Объём как в прошлый раз"; cmpTone = "flat"; }
  else { cmpText = s.delta + "% объёма к прошлой такой же тренировке"; cmpTone = "flat"; }
  const cmpStyle = cmpTone === "up"
    ? { background: "var(--bg-0e1a13)", border: "1px solid var(--bd-1d3a28)", color: "var(--tx-7fc79a)" }
    : { background: "var(--bg-0c0c0f)", border: "1px solid var(--bd-1a1a22)", color: "var(--tx-888)" };
  const shown = s.records.slice(0, UX_RECORDS_SHOWN);
  const dots = Math.max(s.planned, s.weekCount);
  return (
    <div role="dialog" aria-modal="true" aria-label="Итог тренировки" className="app-anim ux-fade" onClick={props.onClose}
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 650, background: "var(--scrim)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div className="app-anim ux-up" onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", WebkitOverflowScrolling: "touch", background: "var(--bg-111)", borderRadius: "22px 22px 0 0", borderTop: "1px solid var(--bd-2a2a35)", padding: "0 20px calc(24px + env(safe-area-inset-bottom))", boxShadow: "var(--shadow-pop)" }}>
        <div style={{ height: 4, background: `linear-gradient(90deg, ${col}, ${col}55)`, margin: "0 -20px 22px", borderRadius: "22px 22px 0 0" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          <div className="app-anim ux-badge" style={{ width: 58, height: 58, borderRadius: 18, background: `${col}22`, border: `1px solid ${col}66`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, flexShrink: 0 }}>🏁</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, fontWeight: 700, color: ink(col), marginBottom: 4 }}>{s.update ? "ТРЕНИРОВКА ОБНОВЛЕНА" : "ТРЕНИРОВКА СОХРАНЕНА"}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--tx-fff)", letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          {tiles.map((t, i) => (
            <div key={t.label} className="app-anim ux-pop" style={{ "--d": (0.12 + i * 0.07) + "s", background: "var(--bg-0c0c0f)", border: "1px solid var(--bd-1a1a22)", borderRadius: 14, padding: "14px 14px 12px" }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--tx-666)", marginBottom: 8 }}>{t.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 26, fontWeight: 800, color: t.value === "-" ? "var(--tx-444)" : "var(--tx-fff)", lineHeight: 1 }}>{t.value}</span>
                {t.unit && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: ink(col) }}>{t.unit}</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="app-anim ux-pop" style={Object.assign({ "--d": "0.42s", borderRadius: 12, padding: "11px 14px", fontSize: 12, lineHeight: 1.5, marginBottom: 12 }, cmpStyle)}>{cmpText}</div>

        {shown.length > 0 && (
          <div className="app-anim ux-pop" style={{ "--d": "0.5s", background: "var(--bg-1a1206)", border: "1px solid #f7a84450", borderRadius: 14, padding: "14px 14px 6px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 18 }}>🏆</span>
              <span style={{ fontSize: 10, letterSpacing: 3, fontWeight: 700, color: "var(--tx-f7a844)" }}>РЕКОРДЫ  |  {s.records.length}</span>
            </div>
            {shown.map(r => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid var(--bd-3a2a10)" }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--tx-ddd)", fontWeight: 600, lineHeight: 1.35 }}>{r.name}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--tx-fff)", whiteSpace: "nowrap" }}>{uxNum(r.weight)}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#000", background: "#f7a844", borderRadius: 20, padding: "2px 8px", whiteSpace: "nowrap" }}>+{uxNum(r.gain)}</div>
              </div>
            ))}
            {s.records.length > shown.length && (
              <div style={{ fontSize: 10, color: "var(--tx-8a7550)", padding: "6px 0 8px" }}>и ещё {s.records.length - shown.length}</div>
            )}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg-0c0c0f)", border: "1px solid var(--bd-1a1a22)", borderRadius: 12, padding: "12px 14px", marginBottom: 18 }}>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            {Array.from({ length: Math.min(dots, 7) }, (_, i) => (
              <span key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: i < s.weekCount ? col : "var(--bg-1e1e28)", boxShadow: i < s.weekCount ? `0 0 6px ${col}80` : "none" }} />
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--tx-888)", lineHeight: 1.4 }}>
            {s.weekCount}-я тренировка на этой неделе{s.planned > 0 ? ", по плану " + s.planned : ""}
          </div>
        </div>

        <button onClick={props.onClose}
          style={{ width: "100%", minHeight: 52, borderRadius: 14, border: "none", background: col, color: "#000", fontSize: 12, fontWeight: 800, letterSpacing: 3, cursor: "pointer", fontFamily: "inherit" }}>
          ГОТОВО
        </button>
      </div>
    </div>
  );
}

// Всё, что рисуется поверх приложения: стили анимаций, всплывашка рекорда, итог
function UxLayer(props) {
  return (
    <>
      <style>{UX_CSS}</style>
      <UxRecordPop pop={props.recordPop} onClose={props.onRecordClose} />
      <UxSummary summary={props.summary} color={props.color} ink={props.ink} onClose={props.onSummaryClose} />
    </>
  );
}

// Блок настроек: звук. Стоит среди остальных настроек (Меню -> Настройки).
function UxSettings() {
  const [on, setOn] = useState(uxSoundOn);
  const pick = v => { uxSoundSet(v); setOn(v); if (v) uxPlay("done", true); };
  return (
    <>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--tx-666)", marginBottom: 10 }}>ЗВУК</div>
      <div style={{ background: "var(--bg-0f0f12)", border: "1px solid var(--bd-1a1a22)", borderRadius: 10, padding: "14px 14px", marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: "var(--tx-888)", lineHeight: 1.6, marginBottom: 12 }}>
          Короткий сигнал, когда отдых закончился, и при новом рекорде. Звучит, пока приложение открыто. Если звука нет, возможно, включён беззвучный режим (переключатель на боковой грани iPhone).
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {[[true, "ВКЛЮЧЁН"], [false, "ВЫКЛЮЧЕН"]].map(m => {
            const sel = on === m[0];
            return (
              <button key={m[1]} onClick={() => pick(m[0])}
                style={{ flex: 1, padding: "12px 8px", borderRadius: 9, border: `1px solid ${sel ? "#f7a84460" : "var(--bd-2a2a2a)"}`, background: sel ? "#f7a84412" : "var(--bg-0c0c0f)", color: sel ? "var(--tx-f7a844)" : "var(--tx-777)", fontSize: 10, letterSpacing: 1, fontWeight: sel ? 700 : 400, cursor: "pointer", fontFamily: "inherit", minHeight: 48 }}>
                {m[1]}
              </button>
            );
          })}
        </div>
        <button onClick={() => uxPlay("record", true)}
          style={{ width: "100%", padding: "12px 8px", borderRadius: 9, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-0c0c0f)", color: "var(--tx-999)", fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit", minHeight: 48 }}>
          ПРОВЕРИТЬ ЗВУК
        </button>
      </div>
    </>
  );
}

// Окно дня из календаря: тренировки этого дня и переход к записи в журнале
function UxDaySheet(props) {
  const cell = props.cell;
  if (!cell) return null;
  const ink = props.ink;
  const d = new Date(cell.date + "T12:00:00");
  let title = d.toLocaleDateString("ru", { weekday: "long", day: "numeric", month: "long" });
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="app-anim ux-fade" onClick={props.onClose}
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 650, background: "var(--scrim)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div className="app-anim ux-up" onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto", WebkitOverflowScrolling: "touch", background: "var(--bg-111)", borderRadius: "22px 22px 0 0", borderTop: "1px solid var(--bd-2a2a35)", padding: "22px 20px calc(24px + env(safe-area-inset-bottom))", boxShadow: "var(--shadow-pop)" }}>
        <div style={{ fontSize: 9, letterSpacing: 3, color: "var(--tx-666)", marginBottom: 6 }}>{cell.items.length > 1 ? "ТРЕНИРОВОК: " + cell.items.length : "ТРЕНИРОВКА"}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--tx-fff)", marginBottom: 16 }}>{title}</div>
        {cell.items.map((e, i) => {
          const c = props.colorOf(e.workout);
          const pct = e.total > 0 ? Math.round(e.done / e.total * 100) : 0;
          const vol = formatVolume(uxVolumeOf(e.detail));
          const bits = [e.done + "/" + e.total + " подходов"];
          if (uxVolumeOf(e.detail) > 0) bits.push(vol.value + " " + vol.unit.toLowerCase());
          if (e.dur) bits.push(uxDur(e.dur));
          return (
            <div key={e.ts} className="app-anim ux-pop" style={{ "--d": (0.05 + i * 0.07) + "s", background: "var(--bg-0f0f12)", border: "1px solid var(--bd-1a1a22)", borderLeft: `3px solid ${c}`, borderRadius: 14, padding: "14px 14px 12px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: `${c}18`, border: `1px solid ${c}50`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: ink(c), flexShrink: 0 }}>{pct}%</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx-fff)", marginBottom: 4 }}>{e.name}</div>
                  <div style={{ fontSize: 11, color: "var(--tx-777)", lineHeight: 1.5 }}>{bits.join("  |  ")}</div>
                </div>
              </div>
              <button onClick={() => props.onOpen(e)}
                style={{ width: "100%", minHeight: 44, borderRadius: 10, border: `1px solid ${c}60`, background: `${c}14`, color: ink(c), fontSize: 10, fontWeight: 700, letterSpacing: 2, cursor: "pointer", fontFamily: "inherit" }}>
                ОТКРЫТЬ В ЖУРНАЛЕ
              </button>
            </div>
          );
        })}
        <button onClick={props.onClose}
          style={{ width: "100%", minHeight: 48, borderRadius: 12, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-1a1a22)", color: "var(--tx-999)", fontSize: 11, letterSpacing: 2, cursor: "pointer", fontFamily: "inherit", marginTop: 4 }}>
          ЗАКРЫТЬ
        </button>
      </div>
    </div>
  );
}

// Календарь в журнале. entries - все записи; colorOf(ключ тренировки) -> цвет; ink - цвет для текста;
// onOpen(запись) - показать запись в журнале.
function UxCalendar(props) {
  const parts = props.today.split("-");
  const [ym, setYm] = useState({ y: +parts[0], m: +parts[1] - 1 });
  const [sel, setSel] = useState(null);
  const ink = props.ink || function (c) { return c; };
  const first = uxCalFirst(props.entries);
  const cur = { y: +parts[0], m: +parts[1] - 1 };
  const canPrev = !!first && (ym.y * 12 + ym.m) > (first.y * 12 + first.m);
  const canNext = (ym.y * 12 + ym.m) < (cur.y * 12 + cur.m);
  const cal = uxCalMonth(props.entries, ym.y, ym.m, props.today);
  const vol = formatVolume(cal.stats.volume);
  const legend = [];
  cal.cells.forEach(c => {
    (c.items || []).forEach(e => { if (!legend.some(l => l.key === e.workout)) legend.push({ key: e.workout, name: e.name, color: props.colorOf(e.workout) }); });
  });
  const nav = { width: 44, height: 44, borderRadius: 12, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-0f0f12)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, fontFamily: "inherit", flexShrink: 0 };
  const tiles = [["ТРЕНИРОВОК", String(cal.stats.workouts), ""], ["ПОДХОДОВ", String(cal.stats.sets), ""], ["ОБЪЁМ", vol.value, vol.unit]];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={() => canPrev && setYm(uxCalShift(ym, -1))} disabled={!canPrev} aria-label="Предыдущий месяц"
          style={Object.assign({}, nav, { color: canPrev ? "var(--tx-ccc)" : "var(--tx-333)", cursor: canPrev ? "pointer" : "default", opacity: canPrev ? 1 : 0.5 })}><UxChevron dir="left" /></button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--tx-fff)", letterSpacing: 1 }}>{cal.title}</div>
          {canNext && (
            <button onClick={() => setYm(cur)}
              style={{ minHeight: 44, margin: "-10px 0 -12px", padding: "0 10px", background: "none", border: "none", display: "flex", alignItems: "center", cursor: "pointer", fontFamily: "inherit" }}>
              <span style={{ padding: "4px 12px", borderRadius: 14, border: "1px solid #f7a84450", background: "#f7a84410", color: "var(--tx-f7a844)", fontSize: 9, letterSpacing: 2, fontWeight: 700 }}>СЕГОДНЯ</span>
            </button>
          )}
        </div>
        <button onClick={() => canNext && setYm(uxCalShift(ym, 1))} disabled={!canNext} aria-label="Следующий месяц"
          style={Object.assign({}, nav, { color: canNext ? "var(--tx-ccc)" : "var(--tx-333)", cursor: canNext ? "pointer" : "default", opacity: canNext ? 1 : 0.5 })}><UxChevron dir="right" /></button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {UX_WEEKDAYS.map((d, i) => (
          <div key={d} style={{ textAlign: "center", fontSize: 9, letterSpacing: 1, padding: "4px 0", color: i > 4 ? "var(--tx-8a7550)" : "var(--tx-666)" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 16 }}>
        {cal.cells.map((c, i) => {
          if (!c.date) return <div key={i} style={{ height: 48 }} />;
          const has = c.items.length > 0;
          const color = has ? props.colorOf(c.items[0].workout) : "";
          const base = { height: 48, borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: 0, fontFamily: "inherit" };
          const numColor = has ? ink(color) : c.today ? "var(--tx-f7a844)" : c.future ? "var(--tx-3a3a3a)" : "var(--tx-777)";
          const inner = (
            <>
              <span style={{ fontSize: 13, fontWeight: has || c.today ? 800 : 500, color: numColor, lineHeight: 1 }}>{c.day}</span>
              <span style={{ display: "flex", gap: 3, height: 5 }}>
                {c.items.slice(0, 3).map((e, k) => <span key={k} style={{ width: 5, height: 5, borderRadius: "50%", background: props.colorOf(e.workout) }} />)}
              </span>
            </>
          );
          if (!has) {
            return <div key={i} style={Object.assign({}, base, { border: c.today ? "1px solid #f7a84480" : "1px solid transparent", background: c.today ? "#f7a84410" : "transparent" })}>{inner}</div>;
          }
          return (
            <button key={i} onClick={() => setSel(c)} aria-label={c.day + ": тренировок " + c.items.length}
              style={Object.assign({}, base, { cursor: "pointer", border: c.today ? "1px solid #f7a844" : `1px solid ${color}66`, background: `${color}22` })}>{inner}</button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
        {tiles.map(t => (
          <div key={t[0]} style={{ background: "var(--bg-0f0f12)", border: "1px solid var(--bd-1a1a22)", borderRadius: 12, padding: "12px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 8, letterSpacing: 2, color: "var(--tx-666)", marginBottom: 6 }}>{t[0]}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--tx-fff)", lineHeight: 1 }}>{t[1]}</div>
            <div style={{ fontSize: 8, letterSpacing: 1, color: "var(--tx-8a7550)", marginTop: 4, height: 10 }}>{t[2]}</div>
          </div>
        ))}
      </div>

      {legend.length > 0 ? (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
          {legend.map(l => (
            <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--tx-888)", letterSpacing: 1 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: l.color }} />{l.name}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "10px 20px 4px", color: "var(--tx-555)", fontSize: 12, lineHeight: 1.7 }}>В этом месяце тренировок не было</div>
      )}
      {cal.stats.workouts > 0 && <div style={{ fontSize: 10, color: "var(--tx-555)", marginTop: 8 }}>День с отметкой открывается нажатием: тренировки, объём, время</div>}

      <UxDaySheet cell={sel} colorOf={props.colorOf} ink={ink} onClose={() => setSel(null)} onOpen={e => { setSel(null); props.onOpen(e); }} />
    </div>
  );
}
