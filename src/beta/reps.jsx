// ==== ФАКТИЧЕСКИЕ ПОВТОРЫ (тестовая версия) ====
// Раньше в подходе хранился только вес, повторы были диапазоном из программы ("8-10"). Теперь к подходу можно
// записать, сколько повторов сделано на самом деле:
//   - после отметки подхода в карточке отдыха появляется ряд чисел: одно нажатие во время отдыха - и повторы
//     записаны (лишнего шага в самой тренировке нет: отдыхать всё равно надо);
//   - в строке подхода вместо "8-10 повт." стоит кнопка: показывает записанное число, по нажатию - окно с числами
//     (можно поправить или записать заранее);
//   - ничего не выдумывается: если число не выбрано, повторы остаются неизвестными, как раньше;
//   - запись уходит в журнал (95x8), на свёрнутую выполненную карточку и в подсказку перед следующей тренировкой:
//     "прошлый раз 8, 8, 7 - сначала 10 во всех подходах, потом прибавка веса" (двойная прогрессия).
// У упражнений на время ("30 сек") повторов нет, там всё по-прежнему.
// Данные: sessions[ключ][id упражнения][номер подхода].reps (число) и поле r у подхода в записи журнала.
// Тексты без "ты" и "вы". Всё, что тесты исполняют, лежит выше разделителя "Интерфейс" (его строка ниже).

const RX_MAX = 200;        // больше в подходе не бывает: защита от опечатки
const RX_ASK_H = 84;       // на столько вырастает карточка отдыха, когда в ней ряд чисел

// Диапазон из программы: "8-10" -> { lo: 8, hi: 10 }, "12" -> { lo: 12, hi: 12 }, "10-12 на сторону" -> 10..12.
// Упражнение на время или без чисел - null (повторы не записываются).
function rxPlan(str) {
  const s = String(str === undefined || str === null ? "" : str).toLowerCase();
  if (/сек|мин/.test(s)) return null;
  const m = s.match(/\d+/g);
  if (!m) return null;
  const a = parseInt(m[0], 10), b = m.length > 1 ? parseInt(m[1], 10) : a;
  if (!(a > 0) || !(b > 0)) return null;
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

function rxValid(n) {
  return typeof n === "number" && isFinite(n) && n === Math.floor(n) && n >= 1 && n <= RX_MAX;
}

// Шесть чисел для быстрого выбора во время отдыха: диапазон программы и соседи
function rxChips(plan) {
  if (!plan) return [];
  let lo = plan.lo - 1, hi = plan.hi + 1;
  if (hi - lo + 1 > 6) { lo = plan.hi - 5; hi = plan.hi; }      // широкий диапазон: верхние шесть
  while (hi - lo + 1 < 6) { if (lo > 1) lo--; else hi++; }      // узкий: добираем снизу, потом сверху
  if (lo < 1) { hi += 1 - lo; lo = 1; }
  const out = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

// Сколько чисел показать в окне выбора
function rxGridMax(plan) {
  return Math.max(20, plan ? plan.hi + 5 : 20);
}

// Новая копия data с числом повторов у подхода (null - убрать запись); без изменений - тот же объект
function rxSetReps(data, key, exId, setIdx, reps) {
  const cur = data.sessions && data.sessions[key] && data.sessions[key][exId] && data.sessions[key][exId][setIdx];
  const had = cur && cur.reps !== undefined ? cur.reps : null;
  const next = reps === null || reps === undefined ? null : reps;
  if (next !== null && !rxValid(next)) return data;
  if (had === next) return data;
  const sessions = Object.assign({}, data.sessions || {});
  const sess = Object.assign({}, sessions[key] || {});
  const ex = Object.assign({}, sess[exId] || {});
  const set = Object.assign({ weight: "", done: false }, ex[setIdx] || {});
  if (next === null) delete set.reps; else set.reps = next;
  ex[setIdx] = set; sess[exId] = ex; sessions[key] = sess;
  return Object.assign({}, data, { sessions: sessions });
}

// Подход для записи журнала и обратно (при "Дополнить")
function rxDetail(sd) {
  const out = { w: (sd && sd.weight) || "", done: !!(sd && sd.done) };
  if (sd && rxValid(sd.reps)) out.r = sd.reps;
  return out;
}
function rxRestore(s) {
  const out = { weight: (s && s.w) || "", done: !!(s && s.done) };
  if (s && rxValid(s.r)) out.reps = s.r;
  return out;
}

// Подпись подхода в журнале: "95x8", без повторов - как раньше
function rxLabel(s) {
  if (!s || !s.w) return "-";
  return rxValid(s.r) ? s.w + "x" + s.r : String(s.w);
}

// Повторы выполненных подходов строкой "8, 8, 7"; неизвестное - "?"; ничего не записано - ""
function rxList(sets, n) {
  const out = [];
  let any = false;
  for (let i = 0; i < n; i++) {
    const s = sets && sets[i];
    if (!s || !s.done) continue;
    if (rxValid(s.reps)) { out.push(String(s.reps)); any = true; } else out.push("?");
  }
  return any ? out.join(", ") : "";
}

// Прошлое выполнение упражнения по журналу дня: { date, sets: [{ w, r }] } (только отмеченные подходы).
// skipDate - сегодняшняя дата, skipTs - запись, которую сейчас дополняют: их не считаем "прошлым разом".
function rxPast(entries, exId, skipDate, skipTs) {
  let best = null;
  (entries || []).forEach(function (e) {
    if (!e || e.date === skipDate || (skipTs && e.ts === skipTs)) return;
    let d = null;
    (e.detail || []).forEach(function (x) { if (x && x.id === exId) d = x; });
    if (!d) return;
    const sets = (d.sets || []).filter(function (s) { return s && s.done && s.w; }).map(function (s) { return { w: String(s.w), r: rxValid(s.r) ? s.r : null }; });
    if (!sets.length) return;
    if (!best || String(e.date) > String(best.date)) best = { date: e.date, sets: sets };
  });
  return best;
}

// Совет по двойной прогрессии. Нужны повторы ВСЕХ подходов прошлого раза, иначе совета нет.
// { up: true } - верх диапазона взят во всех подходах, можно прибавлять вес; { up: false } - сначала добрать повторы.
function rxAdvice(past, planStr) {
  const plan = rxPlan(planStr);
  if (!past || !plan || !past.sets.length) return null;
  if (!past.sets.every(function (s) { return s.r !== null; })) return null;
  const reps = past.sets.map(function (s) { return s.r; });
  const up = reps.every(function (r) { return r >= plan.hi; });
  return { up: up, reps: reps.join(", "), goal: plan.hi };
}

// ---- Интерфейс ----
// Кнопка повторов в строке подхода. Занимает правую часть поля на всю его высоту (поле 44 пикселя).
function RxChip(props) {
  const plan = rxPlan(props.plan);
  const known = rxValid(props.reps);
  if (!plan) return <span style={{ fontSize: 12, color: "var(--tx-888)" }}>{props.plan} повт.</span>;
  return (
    <button onClick={props.onClick} aria-label={known ? "Повторов: " + props.reps + ". Изменить" : "Записать повторы"}
      style={{ minHeight: 44, margin: "-10px -14px -10px 0", padding: "0 14px 0 10px", background: "none", border: "none", borderLeft: "1px solid var(--bd-1e1e28)", color: known ? (props.done ? props.ink(props.color) : "var(--tx-fff)") : "var(--tx-888)", fontSize: known ? 13 : 12, fontWeight: known ? 700 : 400, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}>
      {known ? props.reps : props.plan} повт.
    </button>
  );
}

// Ряд чисел в карточке отдыха: сколько повторов было в только что отмеченном подходе
function RxAsk(props) {
  const plan = rxPlan(props.plan);
  if (!plan) return null;
  const chips = rxChips(plan);
  const known = rxValid(props.reps);
  const cell = { minHeight: 44, borderRadius: 10, fontSize: 14, cursor: "pointer", fontFamily: "inherit", padding: 0 };
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--bd-1a1a22)" }}>
      <div style={{ fontSize: 11, color: known ? props.ink(props.color) : "var(--tx-999)", lineHeight: 1.4, marginBottom: 6, padding: "0 2px" }}>
        {known ? "Подход " + (props.setIdx + 1) + ": записано " + props.reps + " повт." : "Подход " + (props.setIdx + 1) + ": сколько повторов?"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(" + (chips.length + 1) + ", 1fr)", gap: 4 }}>
        {chips.map(n => {
          const sel = props.reps === n;
          const inPlan = n >= plan.lo && n <= plan.hi;
          return (
            <button key={n} onClick={() => props.onPick(n)} aria-pressed={sel}
              style={Object.assign({}, cell, { border: `1px solid ${sel ? props.color : inPlan ? props.color + "50" : "var(--bd-2a2a35)"}`, background: sel ? props.color : "var(--bg-1a1a22)", color: sel ? "#000" : "var(--tx-ccc)", fontWeight: sel ? 800 : 600 })}>
              {n}
            </button>
          );
        })}
        <button onClick={props.onMore} aria-label="Другое число повторов"
          style={Object.assign({}, cell, { border: "1px solid var(--bd-2a2a35)", background: "none", color: "var(--tx-777)", fontWeight: 700 })}>
          ...
        </button>
      </div>
    </div>
  );
}

// Окно выбора: все числа, диапазон программы обведён
function RxSheet(props) {
  const p = props.pick;
  const plan = rxPlan(p.plan);
  const max = rxGridMax(plan);
  const nums = [];
  for (let i = 1; i <= max; i++) nums.push(i);
  const known = rxValid(props.reps);
  return (
    <div role="dialog" aria-modal="true" aria-label="Повторы в подходе" onClick={props.onClose}
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 640, background: "var(--scrim)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", WebkitOverflowScrolling: "touch", background: "var(--bg-111)", borderRadius: "22px 22px 0 0", borderTop: "1px solid var(--bd-2a2a35)", padding: "10px 16px calc(20px + env(safe-area-inset-bottom))", boxShadow: "var(--shadow-pop)" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--bd-2a2a35)", margin: "0 auto 14px" }} />
        <div style={{ padding: "0 4px 14px" }}>
          <div style={{ fontSize: 9, letterSpacing: 3, color: "var(--tx-666)", marginBottom: 6 }}>ПОВТОРЫ, ПОДХОД {p.setIdx + 1}</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--tx-fff)", lineHeight: 1.3, marginBottom: 6 }}>{p.name}</div>
          <div style={{ fontSize: 11, color: "var(--tx-777)", lineHeight: 1.5 }}>По программе: {p.plan}. {known ? "Записано: " + props.reps : "Пока не записано"}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 12 }}>
          {nums.map(n => {
            const sel = props.reps === n;
            const inPlan = plan && n >= plan.lo && n <= plan.hi;
            return (
              <button key={n} onClick={() => props.onPick(n)} aria-pressed={sel}
                style={{ minHeight: 48, borderRadius: 11, border: `1px solid ${sel ? props.color : inPlan ? props.color + "60" : "var(--bd-1a1a22)"}`, background: sel ? props.color : inPlan ? `${props.color}12` : "var(--bg-0f0f12)", color: sel ? "#000" : "var(--tx-ddd)", fontSize: 15, fontWeight: sel ? 800 : 600, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                {n}
              </button>
            );
          })}
        </div>
        {known && (
          <button onClick={() => props.onPick(null)}
            style={{ width: "100%", minHeight: 48, borderRadius: 12, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-0c0c0f)", color: "var(--tx-999)", fontSize: 10, letterSpacing: 2, cursor: "pointer", fontFamily: "inherit", marginBottom: 8 }}>
            УБРАТЬ ЗАПИСЬ
          </button>
        )}
        <button onClick={props.onClose}
          style={{ width: "100%", minHeight: 48, borderRadius: 12, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-1a1a22)", color: "var(--tx-999)", fontSize: 11, letterSpacing: 2, cursor: "pointer", fontFamily: "inherit" }}>
          ЗАКРЫТЬ
        </button>
      </div>
    </div>
  );
}

// Совет перед упражнением по повторам прошлого раза
function RxTip(props) {
  const a = props.advice;
  if (!a) return null;
  return (
    <div style={{ margin: "0 14px 10px", padding: "10px 12px", background: a.up ? "var(--bg-0e1a13)" : "var(--bg-0c0c0f)", border: `1px solid ${a.up ? "var(--bd-1d3a28)" : "var(--bd-1e1e28)"}`, borderRadius: 10, fontSize: 11, color: a.up ? "var(--tx-7fc79a)" : "var(--tx-999)", lineHeight: 1.5 }}>
      Прошлый раз повторов: {a.reps}. {a.up ? "Верх диапазона взят во всех подходах - пора прибавлять вес" : "Сначала " + a.goal + " во всех подходах, потом прибавка веса"}
    </div>
  );
}
