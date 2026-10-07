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

// Боевые данные для прямого копирования: { data } или { error }. Только getItem.
// На iPhone каждое приложение с экрана «Домой» хранит данные ОТДЕЛЬНО, даже если адрес общий, поэтому
// из тестового приложения основное обычно не видно. Тогда переносим данные файлом (betaMergeFile).
function readProdBackup() {
  try {
    const raw = localStorage.getItem(PROD_STORAGE_KEY);
    if (!raw) return { error: "Основная версия хранит данные отдельно, поэтому отсюда их не видно. Загрузите, пожалуйста, файл копии." };
    return parseBackup(raw);
  } catch (e) {
    return { error: "Не получилось прочитать основную версию. Загрузите, пожалуйста, файл копии." };
  }
}

// Добавляет в cur то, чего там нет, из текста файла копии: { data, added } или { error }.
// Ничего не удаляет и не перезаписывает, повторная загрузка не дублирует.
function betaMergeFile(text, cur) {
  const res = parseBackup(text);
  if (res.error) return { error: res.error };
  const m = mergeBackup(cur, res.data);
  return { data: pruneOldKeys(m.data), added: m.added };
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
  const fileRef = useRef(null);

  function onFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => showToast("Не получилось прочитать файл");
    reader.onload = () => {
      const text = String(reader.result || "");
      const r = betaMergeFile(text, data);
      if (r.error) { showToast(r.error); return; }
      setData(prev => betaMergeFile(text, prev).data);
      showToast(r.added > 0 ? "Загружено тренировок: " + r.added : "В файле нет новых тренировок");
    };
    reader.readAsText(file);
  }

  function copyFromProd() {
    if (prod.error) { showToast(prod.error); return; }
    const added = mergeBackup(data, prod.data).added;
    setData(prev => pruneOldKeys(mergeBackup(prev, prod.data).data));
    showToast(added > 0 ? "Скопировано тренировок: " + added : "В основной версии нет новых тренировок");
  }

  return (
    <div style={{ paddingTop: 20 }}>
      <div style={{ background: "#1a1206", border: "1px solid #f7a84440", borderRadius: 12, padding: "12px 14px", marginBottom: 20 }}>
        <div style={{ fontSize: 9, letterSpacing: 2, color: "#f7a844", marginBottom: 4 }}>ТЕСТОВАЯ ВЕРСИЯ</div>
        <div style={{ fontSize: 11, color: "#ccc", lineHeight: 1.6 }}>
          Здесь мы пробуем новые возможности. Данные этой версии хранятся отдельно и основную версию не затрагивают.
        </div>
      </div>

      <BetaSection title="ДАННЫЕ">
        <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6, marginBottom: 10 }}>
          Чтобы тренер видел вашу историю, перенесите её из основной версии. На iPhone каждое приложение на экране «Домой» хранит данные отдельно, поэтому делается это через файл:
        </div>
        <div style={{ fontSize: 11, color: "#aaa", lineHeight: 1.7, marginBottom: 12 }}>
          1. В основной версии откройте меню, затем «Настройки», нажмите СОХРАНИТЬ и выберите «Сохранить в Файлы».<br />
          2. Здесь нажмите кнопку ниже и выберите этот файл.<br />
          Загрузка только добавляет недостающие тренировки: ничего не удаляется и не дублируется.
        </div>
        <div style={{ fontSize: 10, color: "#666", marginBottom: 12 }}>
          Здесь сейчас тренировок: {countEntries(data)}{prod.error ? "" : " | в основной версии: " + prodCount}
        </div>
        <button onClick={() => fileRef.current && fileRef.current.click()}
          style={{ width: "100%", padding: "12px 8px", borderRadius: 9, border: "1px solid #f7a84460", background: "#f7a84412", color: "#f7a844", fontSize: 10, letterSpacing: 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minHeight: 48 }}>
          ЗАГРУЗИТЬ ФАЙЛ ИЗ ОСНОВНОЙ ВЕРСИИ
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
          onChange={e => { onFile(e.target.files && e.target.files[0]); e.target.value = ""; }} />
        {!prod.error && (
          <button onClick={copyFromProd}
            style={{ width: "100%", marginTop: 8, padding: "12px 8px", borderRadius: 9, border: "1px solid #2a2a2a", background: "#0c0c0f", color: "#999", fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit", minHeight: 48 }}>
            СКОПИРОВАТЬ НАПРЯМУЮ (ЕСЛИ ВИДНА ОСНОВНАЯ ВЕРСИЯ)
          </button>
        )}
      </BetaSection>

      {typeof ProfilePanel === "function" && <ProfilePanel data={data} setData={setData} showToast={showToast} />}
      {typeof BodyPanel === "function" && <BodyPanel data={data} setData={setData} showToast={showToast} />}
      {typeof CoachPanel === "function" && <CoachPanel data={data} setData={setData} />}
      {typeof SocialPanel === "function" && <SocialPanel data={data} setData={setData} />}
      {typeof ArenaPanel === "function" && <ArenaPanel data={data} setData={setData} />}
      {typeof CompetePanel === "function" && <CompetePanel data={data} />}
      {typeof SpotifyPanel === "function" && <SpotifyPanel data={data} setData={setData} showToast={showToast} />}
    </div>
  );
}
