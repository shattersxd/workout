// ==== ФОКУС НА ТРЕНИРОВКЕ (тестовая версия) ====
// Пять мелочей, которые убирают лишние движения в зале:
//   1. выполненное упражнение сворачивается в одну строку (название и веса), список становится короче с каждым
//      упражнением; строка раскрывается нажатием, карточку можно свернуть обратно;
//   2. текущее упражнение (начатое, а если такого нет - первое несделанное) обведено и помечено "СЕЙЧАС";
//   3. заметка к упражнению ("сиденье 4, хват шире плеч"): хранится по id упражнения и видна на карточке каждый раз;
//   4. таймер отдыха с крупными кнопками (-30, +30, пропустить) и строкой "Дальше: упражнение, подход 3 из 4";
//   5. блины на штангу: сколько вешать на каждую сторону для нужного веса.
// Тексты без "ты" и "вы". Всё, что тесты исполняют, лежит выше разделителя "Интерфейс" (его строка ниже) и
// написано обычным JS.

const FX_NOTE_MAX = 240;
const FX_BARS = [20, 15, 10];                          // грифы, кг
const FX_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];      // блины, кг
// Вес грифа - настройка устройства, как тема и звук: отдельный ключ, не в data (иначе уедет в файл копии)
const FX_BAR_KEY = APP_VARIANT === "beta" ? "sila_bar_beta" : "sila_bar";

function fxWeight(x) {
  const v = parseFloat(String(x === undefined || x === null ? "" : x).replace(",", "."));
  return isFinite(v) ? v : 0;
}
function fxNum(x) { return String(Math.round(x * 100) / 100); }

// ---- Текущее упражнение ----
// items - видимые упражнения по порядку: [{ id (слот), exId (что делается), name, n, sets: [{ done, weight }] }]
function fxDone(it) {
  let d = 0;
  for (let i = 0; i < it.n; i++) if (it.sets[i] && it.sets[i].done) d++;
  return d;
}
// Начатое, но не законченное; если такого нет - первое незаконченное; всё сделано - null
function fxCurrent(items) {
  let first = null, started = null;
  (items || []).forEach(function (it) {
    const d = fxDone(it);
    if (d >= it.n) return;
    if (first === null) first = it.id;
    if (started === null && d > 0) started = it.id;
  });
  return started !== null ? started : first;
}
// Что делать после отдыха: { id, exId, name, set, of, weight } - следующий неотмеченный подход текущего упражнения
function fxNext(items) {
  const id = fxCurrent(items);
  if (id === null) return null;
  let it = null;
  items.forEach(function (x) { if (x.id === id) it = x; });
  for (let i = 0; i < it.n; i++) {
    if (!(it.sets[i] && it.sets[i].done)) return { id: it.id, exId: it.exId, name: it.name, set: i + 1, of: it.n, weight: it.sets[i] && it.sets[i].weight ? String(it.sets[i].weight) : "" };
  }
  return null;
}

// Веса выполненного упражнения одной строкой: "4 x 95" при одинаковых, иначе "95 / 95 / 92.5"
function fxSummary(sets, n) {
  const ws = [];
  for (let i = 0; i < n; i++) if (sets[i] && sets[i].done) ws.push(fxNum(fxWeight(sets[i].weight)));
  if (!ws.length) return "";
  if (ws.every(function (w) { return w === ws[0]; })) return ws.length + " x " + ws[0];
  return ws.join(" / ");
}

// ---- Заметки ----
function fxNoteClean(text) {
  return String(text === undefined || text === null ? "" : text).replace(/\s+/g, " ").trim().slice(0, FX_NOTE_MAX);
}
// Новая копия data с заметкой упражнения; пустая заметка убирается; без изменений - тот же объект
function fxNoteSet(data, exId, text) {
  const clean = fxNoteClean(text);
  const cur = (data.notes && data.notes[exId]) || "";
  if (clean === cur) return data;
  const notes = Object.assign({}, data.notes || {});
  if (clean) notes[exId] = clean; else delete notes[exId];
  return Object.assign({}, data, { notes: notes });
}

// ---- Блины ----
// Упражнение со штангой: по названию. Ошибка не страшна - блок блинов свёрнут и открывается по нажатию.
function fxIsBarbell(name) {
  const s = String(name || "").toLowerCase();
  if (/гантел|тренаж|смит|блок|кроссовер|резин|хаммер/.test(s)) return false;
  return /штанг|гриф|становая|румынск|жим узким|гуд морнинг|шраги|пендлея|\(ez\)|ohp/.test(s);
}
function fxBarDefault(name) {
  return /\(ez\)|ez-|ez /i.test(String(name || "")) ? 10 : 20;
}
function fxBarGet(exId, name) {
  try {
    const map = JSON.parse(localStorage.getItem(FX_BAR_KEY) || "{}");
    if (map && FX_BARS.indexOf(map[exId]) >= 0) return map[exId];
  } catch (e) {}
  return fxBarDefault(name);
}
function fxBarSet(exId, kg) {
  try {
    const map = JSON.parse(localStorage.getItem(FX_BAR_KEY) || "{}") || {};
    map[exId] = kg;
    localStorage.setItem(FX_BAR_KEY, JSON.stringify(map));
  } catch (e) {}
}
// Раскладка: total - вес штанги целиком, bar - гриф. Возвращает { side: [блины на ОДНУ сторону], rest: сколько
// не набралось (на всю штангу), under: вес меньше грифа }
function fxPlates(total, bar, plates) {
  const t = fxWeight(total), b = fxWeight(bar);
  if (!(t > 0)) return { side: [], rest: 0, under: false, empty: true };
  if (t < b) return { side: [], rest: 0, under: true, empty: false };
  let left = Math.round((t - b) / 2 * 1000) / 1000;
  const side = [];
  (plates || FX_PLATES).forEach(function (p) {
    while (left >= p - 0.0005) { side.push(p); left = Math.round((left - p) * 1000) / 1000; }
  });
  return { side: side, rest: Math.round(left * 2 * 100) / 100, under: false, empty: false };
}

// ---- Интерфейс ----
function FxIcon(props) {
  const paths = {
    check: ["M5 12l5 5L20 7"],
    pen: ["M4 20h4L19 9l-4-4L4 16z", "M13.5 6.5l4 4"],
    down: ["M6 9l6 6 6-6"],
    up: ["M6 15l6-6 6 6"],
    skip: ["M6 6l12 12", "M18 6L6 18"],
  };
  const size = props.size || 18;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {paths[props.name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// Выполненное упражнение одной строкой. menu - кнопка окна упражнения (её рисует основной код)
function FxDoneCard(props) {
  return (
    <div id={props.domId} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-0f0f12)", border: `1px solid ${props.color}50`, borderRadius: 12, padding: "6px 8px 6px 12px", marginBottom: 12 }}>
      <button onClick={props.onOpen} aria-label={"Развернуть: " + props.name}
        style={{ flex: 1, minWidth: 0, minHeight: 48, display: "flex", alignItems: "center", gap: 12, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: props.color, color: "#000", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><FxIcon name="check" /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--tx-ccc)", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{props.name}</span>
          <span style={{ display: "block", fontSize: 11, color: "var(--tx-777)", marginTop: 2 }}>{props.summary}{props.summary ? " " + props.unit : "сделано"}</span>
        </span>
        <span style={{ color: "var(--tx-555)", display: "flex" }}><FxIcon name="down" size={16} /></span>
      </button>
      {props.menu}
    </div>
  );
}

// Кнопка внизу раскрытой выполненной карточки
function FxFold(props) {
  return (
    <div style={{ padding: "0 14px 14px" }}>
      <button onClick={props.onClick}
        style={{ width: "100%", minHeight: 44, borderRadius: 10, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-0c0c0f)", color: "var(--tx-888)", fontSize: 10, letterSpacing: 2, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <FxIcon name="up" size={15} />
        СВЕРНУТЬ
      </button>
    </div>
  );
}

function FxNowTag(props) {
  return <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: `${props.color}25`, color: props.ink(props.color), letterSpacing: 1, fontWeight: 700 }}>СЕЙЧАС</span>;
}

// Заметка на карточке (если есть)
function FxNoteLine(props) {
  if (!props.text) return null;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 6, fontSize: 11, color: "var(--tx-999)", lineHeight: 1.45 }}>
      <span style={{ display: "flex", paddingTop: 1, color: "var(--tx-666)" }}><FxIcon name="pen" size={12} /></span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{props.text}</span>
    </div>
  );
}

// Поле заметки в раскрытой карточке. Сохраняется, когда поле теряет фокус.
function FxNote(props) {
  const [text, setText] = useState(props.value || "");
  useEffect(function () { setText(props.value || ""); }, [props.value]);
  return (
    <div style={{ background: "var(--bg-0c0c0f)", borderRadius: 8, padding: "12px 14px", marginBottom: 8, border: "1px solid var(--bd-1a1a22)" }}>
      <div style={{ fontSize: 9, letterSpacing: 3, color: props.ink(props.color), fontWeight: 700, marginBottom: 8 }}>ЗАМЕТКА</div>
      <textarea value={text} rows={2} maxLength={FX_NOTE_MAX} placeholder="Например: сиденье 4, хват шире плеч"
        onChange={e => setText(e.target.value)} onBlur={() => props.onSave(text)}
        style={{ width: "100%", background: "var(--bg-0f0f12)", border: "1px solid var(--bd-2a2a2a)", borderRadius: 8, padding: "10px 12px", color: "var(--tx-fff)", fontSize: 16, fontFamily: "inherit", outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.4 }} />
      <div style={{ fontSize: 10, color: "var(--tx-666)", marginTop: 6, lineHeight: 1.4 }}>Заметка остаётся у упражнения и видна на карточке на каждой тренировке</div>
    </div>
  );
}

// Блины на штангу: свёрнутый блок, открывается по нажатию
function FxPlates(props) {
  const [open, setOpen] = useState(false);
  const [weight, setWeight] = useState(props.weight ? String(props.weight) : "");
  const [bar, setBar] = useState(function () { return fxBarGet(props.exId, props.name); });
  if (!fxIsBarbell(props.name)) return null;
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        style={{ width: "100%", minHeight: 44, borderRadius: 8, border: "1px solid var(--bd-1a1a22)", background: "var(--bg-0c0c0f)", color: "var(--tx-888)", fontSize: 10, letterSpacing: 2, cursor: "pointer", fontFamily: "inherit", marginBottom: 8 }}>
        БЛИНЫ НА ШТАНГУ
      </button>
    );
  }
  const r = fxPlates(weight, bar);
  return (
    <div style={{ background: "var(--bg-0c0c0f)", borderRadius: 8, padding: "12px 14px", marginBottom: 8, border: "1px solid var(--bd-1a1a22)" }}>
      <div style={{ fontSize: 9, letterSpacing: 3, color: props.ink(props.color), fontWeight: 700, marginBottom: 10 }}>БЛИНЫ НА ШТАНГУ</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <input type="number" inputMode="decimal" value={weight} placeholder="вес" aria-label="Вес штанги" onChange={e => setWeight(e.target.value)}
          style={{ width: 92, minHeight: 44, background: "var(--bg-0f0f12)", border: "1px solid var(--bd-2a2a2a)", borderRadius: 8, padding: "0 12px", color: "var(--tx-fff)", fontSize: 16, fontWeight: 700, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
        <span style={{ fontSize: 12, color: "var(--tx-777)" }}>кг, гриф</span>
        {FX_BARS.map(b => {
          const sel = bar === b;
          return (
            <button key={b} onClick={() => { setBar(b); fxBarSet(props.exId, b); }} aria-pressed={sel}
              style={{ minWidth: 44, minHeight: 44, borderRadius: 8, border: `1px solid ${sel ? props.color + "70" : "var(--bd-2a2a2a)"}`, background: sel ? `${props.color}18` : "var(--bg-0f0f12)", color: sel ? props.ink(props.color) : "var(--tx-777)", fontSize: 13, fontWeight: sel ? 700 : 400, cursor: "pointer", fontFamily: "inherit", padding: "0 6px" }}>
              {b}
            </button>
          );
        })}
      </div>
      {r.empty && <div style={{ fontSize: 11, color: "var(--tx-666)", lineHeight: 1.5 }}>Нужен вес штанги целиком</div>}
      {r.under && <div style={{ fontSize: 11, color: "var(--tx-999)", lineHeight: 1.5 }}>Это меньше веса грифа ({bar} кг)</div>}
      {!r.empty && !r.under && (
        <>
          <div style={{ fontSize: 10, color: "var(--tx-777)", marginBottom: 8 }}>{r.side.length ? "На каждую сторону:" : "Пустой гриф"}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {r.side.map((p, i) => (
              <span key={i} style={{ minWidth: 40, textAlign: "center", padding: "8px 8px", borderRadius: 8, background: `${props.color}18`, border: `1px solid ${props.color}50`, color: "var(--tx-fff)", fontSize: 14, fontWeight: 700 }}>{fxNum(p)}</span>
            ))}
          </div>
          {r.rest > 0 && <div style={{ fontSize: 11, color: "var(--tx-999)", marginTop: 8, lineHeight: 1.5 }}>Не набирается {fxNum(r.rest)} кг: таких блинов в наборе нет</div>}
        </>
      )}
    </div>
  );
}

// Таймер отдыха: крупные кнопки и подсказка, что делать дальше. lift - на сколько поднять над нижней панелью.
function FxTimer(props) {
  const timer = props.timer;
  const pct = timer.total > 0 ? Math.min(100, (timer.left / timer.total) * 100) : 0;
  const mins = Math.floor(timer.left / 60), secs = timer.left % 60;
  const done = timer.left === 0;
  const R = 22, C = 2 * Math.PI * R;
  const next = props.next;
  const btn = { width: 44, height: 44, borderRadius: 11, border: "1px solid var(--bd-2a2a35)", background: "var(--bg-1a1a22)", color: "var(--tx-ccc)", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0 };
  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: `calc(${12 + (props.lift || 0)}px + env(safe-area-inset-bottom))`, zIndex: 500, display: "flex", justifyContent: "center", padding: "0 12px", pointerEvents: "none" }}>
      <div role="timer" className={done ? props.doneClass : undefined}
        style={{ pointerEvents: "auto", width: "100%", maxWidth: 440, background: done ? "var(--bg-0e1a13)" : "var(--bg-111)", border: `1px solid ${done ? "#00d4aa50" : "var(--bd-2a2a35)"}`, borderRadius: 18, padding: "10px 10px 10px 12px", boxShadow: "var(--shadow-pop)", transition: "border-color 0.3s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative", width: 50, height: 50, flexShrink: 0 }}>
            <svg width="50" height="50" style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
              <circle cx="25" cy="25" r={R} fill="none" strokeWidth="3" style={{ stroke: "var(--bd-1a1a22)" }} />
              <circle cx="25" cy="25" r={R} fill="none" stroke={props.ink(done ? "#00d4aa" : props.color)} strokeWidth="3" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.9s linear, stroke 0.3s" }} />
            </svg>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {done
                ? <span style={{ fontSize: 19 }}>💪</span>
                : <span style={{ fontSize: 13, fontWeight: 700, color: "var(--tx-fff)", fontFamily: "monospace" }}>{mins > 0 ? mins + ":" + String(secs).padStart(2, "0") : secs}</span>}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, color: done ? "var(--tx-00d4aa)" : "var(--tx-888)", letterSpacing: 1 }}>{done ? "ОТДЫХ ОКОНЧЕН" : "ОТДЫХ"}</div>
          {done ? (
            <button onClick={props.onStop} style={Object.assign({}, btn, { width: "auto", padding: "0 16px", background: "#00d4aa", border: "1px solid #00d4aa", color: "#000", letterSpacing: 1, fontSize: 11 })}>ГОТОВО</button>
          ) : (
            <>
              <button onClick={() => props.onAdd(-30)} aria-label="Убавить 30 секунд" style={btn}>-30</button>
              <button onClick={() => props.onAdd(30)} aria-label="Добавить 30 секунд" style={btn}>+30</button>
              <button onClick={props.onStop} aria-label="Пропустить отдых" style={Object.assign({}, btn, { color: "var(--tx-888)" })}><FxIcon name="skip" size={16} /></button>
            </>
          )}
        </div>
        {/* что делать дальше: сначала подход и вес (они нужнее), название упражнения обрезается последним */}
        <div style={{ fontSize: 11, color: next ? "var(--tx-ccc)" : "var(--tx-777)", lineHeight: 1.4, marginTop: 6, padding: "0 2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {next ? "Дальше: подход " + next.set + " из " + next.of + (next.weight ? ", " + next.weight + " " + (props.unitOf ? props.unitOf(next.name) : "кг") : "") + "  |  " + next.name : "Все подходы сделаны"}
        </div>
      </div>
    </div>
  );
}
