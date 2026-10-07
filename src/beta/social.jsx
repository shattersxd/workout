// ==== ЗАГОТОВКИ ПОД СОЦ-ФУНКЦИИ (тестовая версия) ====
// Сервера пока нет, поэтому ничего не отправляется. Здесь зафиксировано то, что нельзя
// безболезненно менять потом: идентификатор, согласия, ровно тот пакет данных, который в
// будущем уйдёт на сервер, и интерфейс бэкенда. Варианты и обоснования - docs/social-design.md.

const SOCIAL_SCHEMA_VERSION = 1;

// Что можно публиковать. По умолчанию всё закрыто: пользователь включает сам.
const SOCIAL_SHARE_KEYS = [
  ["workouts", "Число тренировок и серия недель"],
  ["volume", "Объём недели"],
  ["prs", "Рекорды в упражнениях"]
];

function socialUuid() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  a[6] = (a[6] & 15) | 64;
  a[8] = (a[8] & 63) | 128;
  const h = Array.prototype.map.call(a, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}

// Читаемый код друга из userId: XXXX-XXXX. Настоящие коды выдаст сервер; это для интерфейса и заглушки.
function socialFriendCode(userId) {
  const h = String(userId || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
  return h.length >= 8 ? h.slice(0, 4) + "-" + h.slice(4, 8) : "";
}

// Добавляет в данные то, что нужно под соц-функции. Чистая: исходный объект не меняется,
// существующие значения не затираются. mkId нужен только для тестов.
function socialEnsure(d, mkId) {
  const out = Object.assign({}, d);
  if (!out.schemaVersion) out.schemaVersion = SOCIAL_SCHEMA_VERSION;
  if (!out.identity || !out.identity.userId) out.identity = { userId: (mkId || socialUuid)(), createdAt: todayKey() };
  const s = out.social || {};
  out.social = {
    enabled: !!s.enabled,
    displayName: s.displayName || "",
    visibility: SOCIAL_VISIBILITY.some(function (v) { return v[0] === s.visibility; }) ? s.visibility : "public",
    consentAt: s.consentAt || "",
    share: Object.assign({ workouts: false, volume: false, prs: false }, s.share || {})
  };
  return out;
}

// Кто видит вас в живых соревнованиях. По умолчанию "все видят" (весь зал), но только ПОСЛЕ явного
// согласия: пока consentAt пуст, наружу не уходит ничего. Комнаты друзей - отдельная функция, она не зависит
// от открытого зала: можно быть скрытым от зала и играть с друзьями.
const SOCIAL_VISIBILITY = [["public", "Все видят"], ["friends", "Только друзья"], ["hidden", "Скрыт"]];

// Куда разрешено отправлять живой прогресс: { arena, friends }
function socialPublishTargets(d) {
  const s = d.social || {};
  if (!s.consentAt) return { arena: false, friends: false };
  const age = d.profile ? profileNum(d.profile.age) : 0;
  const minor = !!d.profile && age > 0 && age < 16;   // открытый зал с незнакомцами - только с 16 лет
  const v = s.visibility || "public";
  return { arena: v === "public" && !minor, friends: v !== "hidden" };
}

// Имя в комнатах: выбранное или нейтральное «Участник XXXX» из кода устройства (не раскрывает личность)
function socialDisplayName(d) {
  const n = d.social && d.social.displayName;
  if (n) return n;
  const code = socialFriendCode(d.identity && d.identity.userId);
  return code ? "Участник " + code.slice(0, 4) : "Участник";
}

// Ровно то, что увидят друзья. Собирается ТОЛЬКО из журнала и согласий: профиль, вес тела,
// самочувствие, травмы и сам журнал сюда не попадают ни при каких настройках.
function socialSummary(d, today) {
  const soc = (d.social && d.social.share) || {};
  const todayDn = dayNum(today);
  const monday = todayDn - coachWeekday(todayDn);
  const entries = coachEntries(d);
  const weeks = coachWeeks(entries);
  const cur = weeks[monday] || { workouts: 0, volume: 0 };
  const out = {
    v: SOCIAL_SCHEMA_VERSION,
    userId: (d.identity && d.identity.userId) || "",
    name: (d.social && d.social.displayName) || "",
    asOf: today
  };
  if (soc.workouts) {
    let streak = 0;
    const planned = coachSchedule(d).filter(Boolean).length;
    if (planned >= 2) {
      if (cur.workouts >= planned) streak = 1;
      for (let i = 1; weeks[monday - 7 * i] && weeks[monday - 7 * i].workouts >= planned; i++) streak++;
    }
    const days = {};
    entries.forEach(function (e) { days[e.date] = true; });
    const last = Object.keys(days).map(dayNum).sort(function (a, b) { return b - a; })[0];
    out.workoutsThisWeek = cur.workouts;
    out.workoutsLast28 = Object.keys(days).filter(function (k) { const n = dayNum(k); return n > todayDn - 28 && n <= todayDn; }).length;
    out.streakWeeks = streak;
    out.lastWorkoutDaysAgo = last === undefined ? null : todayDn - last;
  }
  if (soc.volume) out.volumeThisWeek = Math.round(cur.volume);
  if (soc.prs) {
    out.prs = coachExerciseSessions(entries).map(function (x) {
      const s = x.sessions;
      const st = coachStuck(s);
      const lastS = s[s.length - 1];
      return { x: x, st: st, lastS: lastS, ok: s.length >= 2 && st.stuck === 0 && todayDn - lastS.dn <= 14 };
    }).filter(function (r) { return r.ok; })
      .sort(function (a, b) { return b.lastS.dn - a.lastS.dn || b.lastS.maxW - a.lastS.maxW; })
      .slice(0, 3)
      .map(function (r) { return { name: r.x.name, kg: r.lastS.maxW, date: coachDateStr(r.lastS.dn) }; });
  }
  return out;
}

// Рейтинг по регулярности (число тренировок, затем серия) или по объёму. Не по абсолютному весу на
// штанге: так честнее для новичков. При равенстве - по имени, чтобы порядок не прыгал.
function socialLeaderboard(summaries, metric) {
  const key = metric === "volume" ? "volumeThisWeek" : "workoutsThisWeek";
  return summaries
    .filter(function (s) { return typeof s[key] === "number"; })
    .slice()
    .sort(function (a, b) {
      return b[key] - a[key] || (b.streakWeeks || 0) - (a.streakWeeks || 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    })
    .map(function (s, i) { return { rank: i + 1, name: s.name || "Без имени", userId: s.userId, value: s[key] }; });
}

// Интерфейс, который будет у настоящего бэкенда. Любая реализация обязана отдавать промисы.
const SOCIAL_BACKEND_METHODS = ["signIn", "publishSummary", "getFriends", "addFriendByCode", "getLeaderboard"];

// Локальная заглушка для разработки интерфейса до появления сервера: данные хранятся в переданном
// объекте-хранилище (в тестах - обычный объект) и никуда не отправляются.
function socialLocalBackend(store) {
  const db = store || {};
  if (!db.summaries) db.summaries = {};
  if (!db.friends) db.friends = {};
  return {
    signIn: function (identity) { db.me = identity.userId; return Promise.resolve({ userId: identity.userId }); },
    publishSummary: function (summary) { db.summaries[summary.userId] = summary; return Promise.resolve(true); },
    getFriends: function () {
      return Promise.resolve(Object.keys(db.friends).map(function (id) { return db.summaries[id] || { userId: id, name: db.friends[id] }; }));
    },
    // Код друга = socialFriendCode(userId). Находим среди известных заглушке пользователей.
    addFriendByCode: function (code) {
      const id = Object.keys(db.summaries).filter(function (u) { return socialFriendCode(u) === String(code).toUpperCase(); })[0];
      if (!id || id === db.me) return Promise.resolve({ error: id ? "Это вы" : "Код не найден" });
      db.friends[id] = db.summaries[id].name || "";
      return Promise.resolve({ ok: true, userId: id });
    },
    getLeaderboard: function (metric) {
      const ids = [db.me].concat(Object.keys(db.friends));
      return Promise.resolve(socialLeaderboard(ids.map(function (id) { return db.summaries[id]; }).filter(Boolean), metric));
    }
  };
}

function SocialPanel(props) {
  const data = props.data;
  const setData = props.setData;
  const today = todayKey();

  // Идентификатор и согласия создаются один раз, при первом показе
  useEffect(() => {
    if (!data.identity || !data.social || !data.schemaVersion) setData(prev => socialEnsure(prev));
  }, []);

  const soc = data.social || { share: {}, displayName: "" };
  const summary = socialSummary(socialEnsure(data, () => "00000000-0000-4000-8000-000000000000"), today);
  const code = socialFriendCode(data.identity && data.identity.userId);

  function setShare(k, v) {
    setData(prev => { const d = socialEnsure(prev); return { ...d, social: { ...d.social, share: { ...d.social.share, [k]: v } } }; });
  }
  function setName(v) {
    setData(prev => { const d = socialEnsure(prev); return { ...d, social: { ...d.social, displayName: v.slice(0, 24) } }; });
  }

  const LABELS = {
    workoutsThisWeek: "Тренировок на этой неделе", workoutsLast28: "Тренировок за 4 недели", streakWeeks: "Недель подряд по плану",
    lastWorkoutDaysAgo: "Последняя тренировка (дней назад)", volumeThisWeek: "Объём недели, кг", prs: "Новые рекорды"
  };
  const shown = Object.keys(summary).filter(k => ["v", "userId", "asOf", "name"].indexOf(k) < 0);
  return (
    <BetaSection title="ДРУЗЬЯ (СКОРО)">
      <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6, marginBottom: 12 }}>
        Сервера пока нет, поэтому <span style={{ color: "#f7a844" }}>ничего не отправляется</span>. Здесь вы заранее выбираете, что будут видеть друзья, и сразу видите, как это будет выглядеть.
        {code ? " Ваш код друга: " + code + "." : ""}
      </div>
      <input value={soc.displayName || ""} onChange={e => setName(e.target.value)} placeholder="Имя для друзей"
        style={{ width: "100%", boxSizing: "border-box", minHeight: 44, background: "#0c0c0f", border: "1px solid #2a2a2a", borderRadius: 10, padding: "10px 12px", color: "#fff", fontFamily: "inherit", marginBottom: 12 }} />
      {SOCIAL_SHARE_KEYS.map(k => {
        const on = !!(soc.share && soc.share[k[0]]);
        return (
          <button key={k[0]} onClick={() => setShare(k[0], !on)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", minHeight: 44, marginBottom: 6, padding: "0 12px", borderRadius: 9, border: "1px solid " + (on ? "#4a9a6a" : "#2a2a2a"), background: on ? "#4a9a6a18" : "#0c0c0f", color: on ? "#7fc79a" : "#999", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
            <span>{k[1]}</span><span style={{ fontWeight: 700 }}>{on ? "ВИДНО" : "СКРЫТО"}</span>
          </button>
        );
      })}
      <div style={{ fontSize: 9, letterSpacing: 2, color: "#777", margin: "14px 0 6px" }}>ЧТО УВИДЯТ ДРУЗЬЯ</div>
      <div style={{ background: "#0c0c0f", border: "1px solid #1a1a22", borderRadius: 10, padding: "10px 12px", fontSize: 11, color: "#bbb", lineHeight: 1.8 }}>
        {shown.length === 0 ? "Ничего: все категории скрыты." : shown.map(k => (
          <div key={k}>{LABELS[k] || k}: {k === "prs" ? (summary.prs.length ? summary.prs.map(r => r.name + " " + r.kg + " кг").join(", ") : "нет") : (summary[k] === null ? "-" : String(summary[k]))}</div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: "#666", lineHeight: 1.6, marginTop: 8 }}>
        Профиль, вес тела, самочувствие и журнал целиком друзьям не показываются никогда.
      </div>
    </BetaSection>
  );
}
