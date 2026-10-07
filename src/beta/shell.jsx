// ==== ТЕСТОВАЯ ВЕРСИЯ ====
// Файлы src/beta/*.jsx попадают ТОЛЬКО в beta/index.html (python3 scripts/build.py).
// В боевой index.html их нет, так что здесь можно пробовать новое, не рискуя основной
// версией. Правила кода те же, что везде (CLAUDE.md): в строках не-ASCII только
// кириллица, градус и эмодзи; без ?. и ??; запятые в объектах.
//
// Данные теста лежат под своим ключом (см. STORAGE_KEY в workout_tracker.jsx).
// Боевые данные отсюда ТОЛЬКО ЧИТАЮТСЯ: ни одной записи в PROD_STORAGE_KEY.

const PROD_STORAGE_KEY = "ppl_tracker_v4";

function countEntries(d) {
  return Object.keys((d && d.history) || {}).reduce(function (n, k) { return n + ((d.history[k] || []).length); }, 0);
}

// Боевые данные для копирования: { data } или { error }. Только getItem.
function readProdBackup() {
  try {
    const raw = localStorage.getItem(PROD_STORAGE_KEY);
    if (!raw) return { error: "В основной версии данных нет (открывалась ли она на этом телефоне?)" };
    return parseBackup(raw);
  } catch (e) {
    return { error: "Не удалось прочитать основную версию" };
  }
}

function BetaSection(props) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "#666", marginBottom: 10 }}>{props.title}</div>
      <div style={{ background: "#0f0f12", border: "1px solid #1a1a22", borderRadius: 10, padding: "14px 14px" }}>
        {props.children}
      </div>
    </div>
  );
}

function BetaTab(props) {
  const data = props.data;
  const setData = props.setData;
  const showToast = props.showToast;
  const prod = readProdBackup();
  const prodCount = prod.data ? countEntries(prod.data) : 0;

  function copyFromProd() {
    if (prod.error) { showToast(prod.error); return; }
    const added = mergeBackup(data, prod.data).added;
    setData(prev => pruneOldKeys(mergeBackup(prev, prod.data).data));
    showToast(added > 0 ? "Скопировано тренировок: " + added : "Новых тренировок в основной версии нет");
  }

  return (
    <div style={{ paddingTop: 20 }}>
      <div style={{ background: "#1a1206", border: "1px solid #f7a84440", borderRadius: 12, padding: "12px 14px", marginBottom: 20 }}>
        <div style={{ fontSize: 9, letterSpacing: 2, color: "#f7a844", marginBottom: 4 }}>ТЕСТОВАЯ ВЕРСИЯ</div>
        <div style={{ fontSize: 11, color: "#ccc", lineHeight: 1.6 }}>
          Здесь пробуем новое. Данные этой версии хранятся отдельно и основную не затрагивают.
        </div>
      </div>

      <BetaSection title="ДАННЫЕ">
        <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6, marginBottom: 10 }}>
          Чтобы тренер видел вашу историю, скопируйте её из основной версии. Копирование только читает основную версию и добавляет недостающие тренировки сюда; повторное нажатие ничего не дублирует.
        </div>
        <div style={{ fontSize: 10, color: "#666", marginBottom: 12 }}>
          В основной версии: {prod.error ? "нет данных" : prodCount} | здесь: {countEntries(data)}
        </div>
        <button onClick={copyFromProd}
          style={{ width: "100%", padding: "12px 8px", borderRadius: 9, border: "1px solid #f7a84460", background: "#f7a84412", color: "#f7a844", fontSize: 10, letterSpacing: 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minHeight: 48 }}>
          СКОПИРОВАТЬ ИЗ ОСНОВНОЙ ВЕРСИИ
        </button>
      </BetaSection>

      {typeof ProfilePanel === "function" && <ProfilePanel data={data} setData={setData} showToast={showToast} />}
      {typeof BodyPanel === "function" && <BodyPanel data={data} setData={setData} showToast={showToast} />}
      {typeof CoachPanel === "function" && <CoachPanel data={data} setData={setData} />}
      {typeof SpotifyPanel === "function" && <SpotifyPanel data={data} setData={setData} showToast={showToast} />}
    </div>
  );
}
