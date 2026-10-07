// ==== ПРОФИЛЬ, ПОДБОР ПРОГРАММЫ, ВЕС ТЕЛА И САМОЧУВСТВИЕ (тестовая версия) ====
// Анкета при первом запуске -> рекомендация программы и расписания, ориентиры по питанию и
// безопасные заметки по травмам. Всё считается на телефоне; данные лежат в data.profile,
// data.bodyLog и data.feelLog (бета-хранилище). Это общие ориентиры, не медицинская рекомендация.

const PROFILE_GOALS = [["mass", "Набор массы"], ["strength", "Сила"], ["cut", "Похудение"], ["fit", "Форма и здоровье"]];
const PROFILE_LEVELS = [["new", "Новичок (до 6 мес)"], ["mid", "Опыт 6 мес - 2 года"], ["pro", "Опыт больше 2 лет"]];
const PROFILE_SEX = [["m", "Мужчина"], ["f", "Женщина"]];
const PROFILE_DAYS = [2, 3, 4, 5, 6];
const PROFILE_INJURIES = [["knees", "Колени"], ["back", "Поясница"], ["shoulders", "Плечи"], ["elbows", "Локти и запястья"]];
const PROFILE_FB = ["fullbody_a", "fullbody_b", "fullbody_c"];

// Число из поля ввода (принимает и запятую)
function profileNum(v) {
  const n = parseFloat(String(v === undefined || v === null ? "" : v).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

// Список ошибок анкеты (пустой = всё хорошо). Тексты показываются пользователю.
function profileValidate(p) {
  const e = [];
  const age = profileNum(p.age), h = profileNum(p.height), w = profileNum(p.weight);
  if (age < 14 || age > 90) e.push("Возраст: от 14 до 90 лет (для младших подбор программы лучше доверить тренеру)");
  if (h < 120 || h > 230) e.push("Рост: от 120 до 230 см");
  if (w < 30 || w > 250) e.push("Вес: от 30 до 250 кг");
  if (!p.sex) e.push("Выберите пол: он нужен только для расчёта калорий");
  if (!p.goal) e.push("Выберите цель");
  if (!p.level) e.push("Выберите опыт");
  if (!p.days) e.push("Выберите, сколько дней в неделю тренируетесь");
  return e;
}

function profileBmi(heightCm, weightKg) {
  const h = heightCm / 100;
  return h > 0 ? Math.round(weightKg / (h * h) * 10) / 10 : 0;
}

function profileBmiLabel(bmi) {
  if (bmi < 18.5) return "ниже нормы";
  if (bmi < 25) return "норма";
  if (bmi < 30) return "выше нормы";
  return "высокий";
}

// Ориентир по калориям и белку (Mifflin-St Jeor). null, если ориентир давать не стоит:
// моложе 16, старше 70 или крайние значения ИМТ - тут нужен врач или тренер, а не формула.
function profileEnergy(p, weightKg) {
  const age = profileNum(p.age), h = profileNum(p.height), w = weightKg || profileNum(p.weight);
  const bmi = profileBmi(h, w);
  if (age < 16 || age > 70 || bmi < 16 || bmi > 40 || !p.sex) return null;
  const bmr = 10 * w + 6.25 * h - 5 * age + (p.sex === "m" ? 5 : -161);
  const days = profileNum(p.days);
  const factor = days <= 2 ? 1.375 : days === 3 ? 1.45 : days === 4 ? 1.55 : 1.65;
  const tdee = bmr * factor;
  const adj = p.goal === "mass" ? 1.1 : p.goal === "cut" ? 0.85 : 1;
  const protein = { mass: 1.8, strength: 1.8, cut: 2.0, fit: 1.6 }[p.goal] || 1.6;
  return {
    bmr: Math.round(bmr / 10) * 10,
    tdee: Math.round(tdee / 10) * 10,
    target: Math.round(tdee * adj / 10) * 10,
    protein: Math.round(protein * w)
  };
}

const PROFILE_GOAL_TIPS = {
  mass: "Цель - масса: рабочие подходы 6-12 повторов, отдых 1.5-3 минуты, понемногу прибавляй вес и следи, чтобы вес тела рос медленно.",
  strength: "Цель - сила: в базовых упражнениях 3-6 повторов, отдых 3-5 минут, прибавки маленькие, но регулярные.",
  cut: "Цель - похудение: сохраняй рабочие веса в зале (это бережёт мышцы), добавь ходьбу, а снижение веса держи медленным.",
  fit: "Цель - форма и здоровье: регулярность важнее нагрузки, 2-3 хорошие тренировки в неделю уже дают результат."
};

const PROFILE_INJURY_NOTES = {
  knees: "Колени: приседай до комфортной глубины, добавляй жим ногами и выпады с небольшим весом; боль в суставе - стоп.",
  back: "Поясница: держи нейтральную спину, на старте предпочитай тяги с опорой и тренажёры становой тяге; боль - стоп.",
  shoulders: "Плечи: жим гантелями с нейтральным хватом, без широкого хвата и жима из-за головы; боль - стоп.",
  elbows: "Локти и запястья: нейтральный хват, не гонись за весом в упражнениях на трицепс и бицепс; боль - стоп."
};

// Рекомендация: расписание из готовых программ. schedule - 7 элементов (ПН..ВС), ключ программы или null.
function profileRecommend(p) {
  const level = p.level;
  const asked = Math.max(2, Math.min(6, profileNum(p.days) || 3));
  const days = level === "new" ? Math.min(asked, 3) : asked;
  const why = [];
  if (days < asked) why.push("Новичку хватает трёх тренировок: мышцы и техника растут на отдыхе, а не на объёме.");
  const s = [null, null, null, null, null, null, null];
  let title;
  if (days === 2) {
    s[0] = "fullbody_a"; s[3] = "fullbody_b";
    title = "Фулбади A/B, 2 дня";
    why.push("Две тренировки на всё тело: каждая мышца работает дважды в неделю даже при малом времени.");
  } else if (days === 3 && level === "pro") {
    s[0] = "push"; s[2] = "pull"; s[4] = "legs";
    title = "Push / Pull / Legs, 3 дня";
    why.push("Опытному удобно делить нагрузку по группам: больше объёма на каждую мышцу за тренировку.");
  } else if (days === 3) {
    s[0] = "fullbody_a"; s[2] = "fullbody_b"; s[4] = "fullbody_c";
    title = "Фулбади A/B/C, 3 дня";
    why.push("Три тренировки на всё тело через день: частота важнее объёма, особенно на старте.");
  } else if (days === 4) {
    s[0] = "push"; s[1] = "pull"; s[3] = "legs"; s[5] = "fullbody_a";
    title = "Push / Pull / Legs + общий день, 4 дня";
    why.push("Три раздельных дня и один общий: каждая группа получает вторую нагрузку к концу недели.");
  } else if (days === 5) {
    s[0] = "push"; s[1] = "pull"; s[2] = "legs"; s[4] = "push"; s[5] = "pull";
    title = "Push / Pull / Legs + Push / Pull, 5 дней";
    why.push("Жим и тяга дважды в неделю, ноги раз: подходит, когда силы и времени хватает на пять дней.");
  } else {
    s[0] = "push"; s[1] = "pull"; s[2] = "legs"; s[3] = "push"; s[4] = "pull"; s[5] = "legs";
    title = "Push / Pull / Legs дважды, 6 дней";
    why.push("Классика: каждая группа дважды в неделю. Следи за самочувствием, шесть дней требуют хорошего сна.");
  }
  return {
    days: days, title: title, schedule: s, why: why,
    goalTip: PROFILE_GOAL_TIPS[p.goal] || "",
    notes: (p.injuries || []).map(function (k) { return PROFILE_INJURY_NOTES[k]; }).filter(Boolean)
  };
}

// ---- Вес тела: [{ date, kg }] по возрастанию даты, одна запись на дату ----
function bodyLogAdd(log, date, kg) {
  const v = Math.round(profileNum(kg) * 10) / 10;
  if (!(v >= 30 && v <= 250)) return log;
  return (log || []).filter(function (r) { return r.date !== date; }).concat([{ date: date, kg: v }])
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

// Динамика за последние 4 недели: нужны две записи с промежутком не меньше 14 дней
function bodyTrend(log, today) {
  const t = dayNum(today);
  const pts = (log || []).filter(function (r) { const d = dayNum(r.date); return d <= t && d > t - 28; });
  if (pts.length < 2) return null;
  const a = pts[0], b = pts[pts.length - 1];
  const span = dayNum(b.date) - dayNum(a.date);
  if (span < 14) return null;
  const delta = Math.round((b.kg - a.kg) * 10) / 10;
  return { latest: b.kg, delta: delta, span: span, perWeek: Math.round(delta / (span / 7) * 100) / 100 };
}

function bodyLatest(log, fallback) {
  return log && log.length ? log[log.length - 1].kg : fallback;
}

// ---- Самочувствие: [{ date, score }] со score 1..5, одна запись на дату ----
function feelLogSet(log, date, score) {
  const sc = Math.round(profileNum(score));
  if (sc < 1 || sc > 5) return log;
  return (log || []).filter(function (r) { return r.date !== date; }).concat([{ date: date, score: sc }])
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

// Средняя оценка трёх последних тренировок за 14 дней; null, если данных меньше трёх
function feelRecent(log, today) {
  const t = dayNum(today);
  const recent = (log || []).filter(function (r) { const d = dayNum(r.date); return d <= t && d > t - 14; }).slice(-3);
  if (recent.length < 3) return null;
  return Math.round(recent.reduce(function (a, r) { return a + r.score; }, 0) / recent.length * 10) / 10;
}

const FEEL_LABELS = ["очень тяжело", "тяжело", "нормально", "хорошо", "отлично"];

// ---- Интерфейс ----
const PROFILE_DAY_LABELS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
const PROFILE_PRESET_NAMES = { push: "Жим", pull: "Тяга", legs: "Ноги", fullbody_a: "Фулбади A", fullbody_b: "Фулбади B", fullbody_c: "Фулбади C" };

function ChipRow(props) {
  const val = props.value;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {props.options.map(function (o) {
        const on = props.multi ? (val || []).indexOf(o[0]) >= 0 : val === o[0];
        return (
          <button key={String(o[0])} onClick={() => props.onChange(o[0])}
            style={{ minHeight: 44, padding: "0 14px", borderRadius: 10, border: "1px solid " + (on ? "#f7a844" : "#2a2a2a"), background: on ? "#f7a84418" : "#0c0c0f", color: on ? "#f7a844" : "#999", fontSize: 11, fontWeight: on ? 700 : 400, cursor: "pointer", fontFamily: "inherit" }}>
            {o[1]}
          </button>
        );
      })}
    </div>
  );
}

function FieldLabel(props) {
  return <div style={{ fontSize: 9, letterSpacing: 2, color: "#777", margin: "16px 0 8px" }}>{props.children}</div>;
}

const PROFILE_INPUT_STYLE = { width: "100%", boxSizing: "border-box", minHeight: 44, background: "#0c0c0f", border: "1px solid #2a2a2a", borderRadius: 10, padding: "10px 12px", color: "#fff", fontFamily: "inherit" };

function ProfileForm(props) {
  const init = props.initial || {};
  const [f, setF] = useState({
    sex: init.sex || "", age: init.age || "", height: init.height || "", weight: init.weight || "",
    goal: init.goal || "", level: init.level || "", days: init.days || 0, injuries: init.injuries || []
  });
  const [errors, setErrors] = useState([]);
  function set(k, v) { setF(prev => ({ ...prev, [k]: v })); }
  function toggleInjury(k) {
    setF(prev => ({ ...prev, injuries: prev.injuries.indexOf(k) >= 0 ? prev.injuries.filter(x => x !== k) : prev.injuries.concat([k]) }));
  }
  function submit() {
    const e = profileValidate(f);
    setErrors(e);
    if (e.length) return;
    props.onSubmit({
      sex: f.sex, age: profileNum(f.age), height: profileNum(f.height), weight: profileNum(f.weight),
      goal: f.goal, level: f.level, days: f.days, injuries: f.injuries
    });
  }
  return (
    <div>
      <FieldLabel>ПОЛ</FieldLabel>
      <ChipRow options={PROFILE_SEX} value={f.sex} onChange={v => set("sex", v)} />
      <div style={{ display: "flex", gap: 8 }}>
        {[["age", "ВОЗРАСТ", "лет"], ["height", "РОСТ", "см"], ["weight", "ВЕС", "кг"]].map(c => (
          <div key={c[0]} style={{ flex: 1 }}>
            <FieldLabel>{c[1]}</FieldLabel>
            <input value={f[c[0]]} onChange={e => set(c[0], e.target.value)} inputMode="decimal" placeholder={c[2]} style={PROFILE_INPUT_STYLE} />
          </div>
        ))}
      </div>
      <FieldLabel>ЦЕЛЬ</FieldLabel>
      <ChipRow options={PROFILE_GOALS} value={f.goal} onChange={v => set("goal", v)} />
      <FieldLabel>ОПЫТ</FieldLabel>
      <ChipRow options={PROFILE_LEVELS} value={f.level} onChange={v => set("level", v)} />
      <FieldLabel>ДНЕЙ В НЕДЕЛЮ</FieldLabel>
      <ChipRow options={PROFILE_DAYS.map(d => [d, String(d)])} value={f.days} onChange={v => set("days", v)} />
      <FieldLabel>ЕСТЬ ОГРАНИЧЕНИЯ? (МОЖНО НЕСКОЛЬКО)</FieldLabel>
      <ChipRow multi options={PROFILE_INJURIES} value={f.injuries} onChange={toggleInjury} />
      {errors.length > 0 && (
        <div style={{ fontSize: 11, color: "#ff8a6a", lineHeight: 1.7, marginTop: 14 }}>
          {errors.map(m => <div key={m}>{m}</div>)}
        </div>
      )}
      <button onClick={submit}
        style={{ width: "100%", minHeight: 48, marginTop: 18, padding: "12px 8px", borderRadius: 9, border: "1px solid #f7a84460", background: "#f7a84412", color: "#f7a844", fontSize: 11, letterSpacing: 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        ГОТОВО
      </button>
    </div>
  );
}

// Рекомендация: расписание, ориентиры по питанию, заметки. Используется и в анкете, и на вкладке
function RecommendationView(props) {
  const p = props.profile;
  const rec = profileRecommend(p);
  const w = props.weight || p.weight;
  const bmi = profileBmi(p.height, w);
  const en = profileEnergy(p, w);
  const goal = (PROFILE_GOALS.filter(g => g[0] === p.goal)[0] || [0, ""])[1];
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 6 }}>{rec.title}</div>
      <div style={{ display: "flex", gap: 4, margin: "10px 0" }}>
        {PROFILE_DAY_LABELS.map((d, i) => (
          <div key={d} style={{ flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 6, background: rec.schedule[i] ? "#f7a84412" : "#0c0c0f", border: "1px solid " + (rec.schedule[i] ? "#f7a84440" : "#1a1a22") }}>
            <div style={{ fontSize: 9, color: "#777", marginBottom: 3 }}>{d}</div>
            <div style={{ fontSize: 8, color: rec.schedule[i] ? "#f7a844" : "#333", minHeight: 20, lineHeight: 1.3 }}>{rec.schedule[i] ? PROFILE_PRESET_NAMES[rec.schedule[i]] : "-"}</div>
          </div>
        ))}
      </div>
      {rec.why.map(t => <div key={t} style={{ fontSize: 11, color: "#aaa", lineHeight: 1.6, marginBottom: 6 }}>{t}</div>)}
      {rec.goalTip && <div style={{ fontSize: 11, color: "#aaa", lineHeight: 1.6, marginBottom: 6 }}>{rec.goalTip}</div>}
      <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6, margin: "10px 0 6px" }}>
        ИМТ {bmi} ({profileBmiLabel(bmi)}){goal ? ", цель: " + goal.toLowerCase() : ""}. ИМТ не учитывает мышечную массу.
      </div>
      {en ? (
        <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6, marginBottom: 6 }}>
          Ориентир: около {en.target} ккал в день и {en.protein} г белка (поддержание {en.tdee} ккал). Это оценка, а не рекомендация врача: следи за самочувствием и динамикой веса.
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6, marginBottom: 6 }}>
          Для вашего возраста или показателей калории по формуле не считаем: с питанием лучше помочь врачу или тренеру.
        </div>
      )}
      {rec.notes.map(t => <div key={t} style={{ fontSize: 11, color: "#c9a96a", lineHeight: 1.6, marginBottom: 6 }}>{t}</div>)}
      {rec.notes.length > 0 && <div style={{ fontSize: 10, color: "#666", lineHeight: 1.6 }}>Это общие советы. Если боль не проходит, обратитесь к врачу.</div>}
    </div>
  );
}

// Экран первого запуска и редактирования анкеты. Показывается поверх всего, пока нет профиля.
function BetaOverlay(props) {
  const data = props.data;
  const setData = props.setData;
  const showToast = props.showToast;
  const [done, setDone] = useState(null);
  const open = (!data.profile && !data.profileSkipped) || !!data.profileEdit;
  const visible = open || !!done;

  // Пока анкета открыта, основное приложение скрыто: на iPhone фиксированное окно иногда не доходит до
  // нижнего края, и под ним просвечивали карточки упражнений. Анкета рисуется отдельно, прямо в body.
  useEffect(() => {
    const r = document.getElementById("root");
    if (!r || !visible) return;
    r.style.visibility = "hidden";
    return () => { r.style.visibility = ""; };
  }, [visible]);

  if (!visible) return null;

  function save(p) {
    const profile = Object.assign({}, p, { createdAt: todayKey() });
    setData(prev => ({ ...prev, profile: profile, profileEdit: false, profileSkipped: "", bodyLog: bodyLogAdd(prev.bodyLog || [], todayKey(), p.weight) }));
    setDone(profile);
  }
  function skip() {
    setData(prev => ({ ...prev, profileSkipped: todayKey(), profileEdit: false }));
  }
  function applySchedule() {
    setData(prev => ({ ...prev, schedule: profileRecommend(done).schedule }));
    showToast("Расписание применено");
    setDone(null);
  }

  const wrap = { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 300, background: "#0c0c0f", overflowY: "auto", WebkitOverflowScrolling: "touch", paddingTop: "env(safe-area-inset-top)", paddingBottom: "calc(40px + env(safe-area-inset-bottom))" };
  return ReactDOM.createPortal(
    <div style={wrap}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "24px 20px 0" }}>
        {done ? (
          <>
            <div style={{ fontSize: 9, letterSpacing: 3, color: "#f7a844", marginBottom: 6 }}>РЕКОМЕНДАЦИЯ</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 14 }}>Ваша программа</div>
            <RecommendationView profile={done} />
            <button onClick={applySchedule}
              style={{ width: "100%", minHeight: 48, marginTop: 18, padding: "12px 8px", borderRadius: 9, border: "1px solid #f7a84460", background: "#f7a84412", color: "#f7a844", fontSize: 11, letterSpacing: 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              ПРИМЕНИТЬ РАСПИСАНИЕ
            </button>
            <button onClick={() => setDone(null)}
              style={{ width: "100%", minHeight: 48, marginTop: 8, padding: "12px 8px", borderRadius: 9, border: "1px solid #2a2a2a", background: "#0c0c0f", color: "#999", fontSize: 11, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}>
              ОСТАВИТЬ КАК ЕСТЬ
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 9, letterSpacing: 3, color: "#f7a844", marginBottom: 6 }}>ПЕРВЫЙ ЗАПУСК</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 8 }}>Расскажите о себе</div>
            <div style={{ fontSize: 11, color: "#888", lineHeight: 1.7 }}>
              Подберём программу под вашу цель и опыт, а тренер будет учитывать их в советах. Данные хранятся только на этом телефоне.
            </div>
            <ProfileForm initial={data.profile} onSubmit={save} />
            {!data.profileEdit && (
              <button onClick={skip}
                style={{ width: "100%", minHeight: 44, marginTop: 8, background: "none", border: "none", color: "#666", fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}>
                ПОТОМ
              </button>
            )}
            {data.profileEdit && (
              <button onClick={() => setData(prev => ({ ...prev, profileEdit: false }))}
                style={{ width: "100%", minHeight: 44, marginTop: 8, background: "none", border: "none", color: "#666", fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}>
                ОТМЕНА
              </button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

function ProfilePanel(props) {
  const data = props.data;
  const setData = props.setData;
  const showToast = props.showToast;
  const p = data.profile;
  return (
    <BetaSection title="ПРОФИЛЬ И ПРОГРАММА">
      {!p ? (
        <>
          <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6, marginBottom: 12 }}>
            Анкета подберёт программу под цель и опыт и поможет тренеру давать точнее советы.
          </div>
          <button onClick={() => setData(prev => ({ ...prev, profileEdit: true }))}
            style={{ width: "100%", minHeight: 48, borderRadius: 9, border: "1px solid #f7a84460", background: "#f7a84412", color: "#f7a844", fontSize: 10, letterSpacing: 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            ЗАПОЛНИТЬ АНКЕТУ
          </button>
        </>
      ) : (
        <>
          <RecommendationView profile={p} weight={bodyLatest(data.bodyLog, p.weight)} />
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={() => { setData(prev => ({ ...prev, schedule: profileRecommend(p).schedule })); showToast("Расписание применено"); }}
              style={{ flex: 1, minHeight: 48, borderRadius: 9, border: "1px solid #f7a84460", background: "#f7a84412", color: "#f7a844", fontSize: 10, letterSpacing: 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              ПРИМЕНИТЬ РАСПИСАНИЕ
            </button>
            <button onClick={() => setData(prev => ({ ...prev, profileEdit: true }))}
              style={{ flex: 1, minHeight: 48, borderRadius: 9, border: "1px solid #2a2a2a", background: "#0c0c0f", color: "#999", fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}>
              ИЗМЕНИТЬ АНКЕТУ
            </button>
          </div>
        </>
      )}
    </BetaSection>
  );
}

function BodyPanel(props) {
  const data = props.data;
  const setData = props.setData;
  const showToast = props.showToast;
  const [kg, setKg] = useState("");
  const today = todayKey();
  const log = data.bodyLog || [];
  const feel = data.feelLog || [];
  const trend = bodyTrend(log, today);
  const todayFeel = feel.filter(r => r.date === today)[0];
  const hadWorkoutToday = Object.keys(data.history || {}).some(k => (data.history[k] || []).some(e => e && e.date === today));

  function addWeight() {
    const next = bodyLogAdd(log, today, kg);
    if (next === log) { showToast("Вес: от 30 до 250 кг"); return; }
    setData(prev => ({ ...prev, bodyLog: bodyLogAdd(prev.bodyLog || [], today, kg) }));
    setKg("");
    showToast("Вес записан");
  }

  const last = log.slice(-5).reverse();
  return (
    <BetaSection title="ВЕС ТЕЛА И САМОЧУВСТВИЕ">
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input value={kg} onChange={e => setKg(e.target.value)} inputMode="decimal" placeholder={log.length ? String(log[log.length - 1].kg).replace(".", ",") + " кг" : "Вес, кг"}
          style={{ ...PROFILE_INPUT_STYLE, flex: 1, width: "auto" }} />
        <button onClick={addWeight}
          style={{ minWidth: 110, minHeight: 44, borderRadius: 9, border: "1px solid #f7a84460", background: "#f7a84412", color: "#f7a844", fontSize: 10, letterSpacing: 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          ЗАПИСАТЬ
        </button>
      </div>
      {trend ? (
        <div style={{ fontSize: 11, color: "#aaa", lineHeight: 1.6, marginBottom: 8 }}>
          За {trend.span} дн.: {trend.delta > 0 ? "+" : ""}{String(trend.delta).replace(".", ",")} кг ({trend.perWeek > 0 ? "+" : ""}{String(trend.perWeek).replace(".", ",")} кг в неделю)
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "#777", lineHeight: 1.6, marginBottom: 8 }}>Динамика появится, когда будут две записи с промежутком от двух недель. Взвешивайтесь раз в 1-2 недели, утром, в одинаковых условиях.</div>
      )}
      {last.length > 0 && (
        <div style={{ fontSize: 10, color: "#666", lineHeight: 1.8, marginBottom: 14 }}>
          {last.map(r => new Date(r.date + "T12:00:00").toLocaleDateString("ru", { day: "numeric", month: "short" }) + ": " + String(r.kg).replace(".", ",") + " кг").join("  |  ")}
        </div>
      )}
      <div style={{ fontSize: 9, letterSpacing: 2, color: "#777", marginBottom: 8 }}>КАК ПРОШЛА ТРЕНИРОВКА СЕГОДНЯ</div>
      <div style={{ display: "flex", gap: 6 }}>
        {[1, 2, 3, 4, 5].map(n => {
          const on = todayFeel && todayFeel.score === n;
          return (
            <button key={n} onClick={() => setData(prev => ({ ...prev, feelLog: feelLogSet(prev.feelLog || [], today, n) }))}
              style={{ flex: 1, minHeight: 48, borderRadius: 9, border: "1px solid " + (on ? "#f7a844" : "#2a2a2a"), background: on ? "#f7a84418" : "#0c0c0f", color: on ? "#f7a844" : "#999", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              {n}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: "#666", lineHeight: 1.6, marginTop: 8 }}>
        {todayFeel ? FEEL_LABELS[todayFeel.score - 1] + ". Тренер смотрит на последние три оценки." : (hadWorkoutToday ? "1 - очень тяжело, 5 - отлично. Тренер учтёт это в советах." : "Оценка появится в советах, когда будет хотя бы три тренировки с оценкой.")}
      </div>
    </BetaSection>
  );
}
