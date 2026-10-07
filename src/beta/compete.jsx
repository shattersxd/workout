// ==== СОРЕВНОВАНИЯ ДЛЯ ТЕХ, КТО ТРЕНИРУЕТСЯ ПРЯМО СЕЙЧАС (тестовая версия) ====
// Сервера пока нет, сеть не используется. Здесь: форматы, подсчёт живого прогресса из текущей
// тренировки, боты для «холодного старта» и табло. Варианты и обоснования - docs/social-design.md.
//
// Правила, которые нельзя ломать:
//  - в живом пакете НЕТ весов штанги: только число подходов, процент плана, число рекордов;
//  - боты не выдаются за людей: у них bot: true, у имени значок 🤖, а в шапке комнаты написано, сколько
//    в ней людей и ботов-партнёров. Ведут они себя по-человечески (см. socialBotTimeline), но не скрываются:
//    в комнатах настоящие люди, и обманывать их нельзя. В постоянный рейтинг, серии и рекорды боты не попадают;
//  - боты - чистая функция от (зерно комнаты, прошедшие минуты): на всех телефонах одинаковые
//    без серверной логики, а люди по очереди вытесняют ботов с конца списка.

const SOCIAL_FORMATS = [
  { id: "sets", name: "Больше подходов", shares: "число закрытых подходов",
    desc: "Кто закроет больше подходов за время комнаты. Веса не публикуются, поэтому честно при разной силе." },
  { id: "plan", name: "Выполнение плана", shares: "процент плана",
    desc: "Какую долю запланированных на сегодня подходов вы уже закрыли. Подходит для разных программ." },
  { id: "records", name: "Личные рекорды", shares: "число улучшенных упражнений",
    desc: "Сколько упражнений вы сегодня подняли выше СВОЕГО прошлого максимума. Соревнуетесь с собой, а не с силой соседа." },
  { id: "team", name: "Командная цель", shares: "число закрытых подходов", team: true,
    desc: "Вместе набираете общую цель по подходам. Рейтинга нет: только общий прогресс, поэтому без соперничества." }
];

// ---- Живой прогресс из текущей тренировки ----

// Сколько подходов запланировано на тренировку (с учётом изменённого числа подходов, пропусков и добавленных)
function socialPlannedSets(d, workoutKey, sessionKey, programs) {
  const progs = programs || (typeof PROGRAM !== "undefined" ? PROGRAM : {});
  const prog = progs[workoutKey] || (d.customWorkouts || {})[workoutKey];
  const base = prog && prog.exercises ? prog.exercises : [];
  const added = (d.addedEx && d.addedEx[sessionKey]) || [];
  const skipped = (d.skipped && d.skipped[sessionKey]) || [];
  const cs = (d.customSets && d.customSets[sessionKey]) || {};
  return base.concat(added).filter(function (e) { return skipped.indexOf(e.id) < 0; })
    .reduce(function (n, e) { return n + (cs[e.id] !== undefined ? cs[e.id] : (e.sets || 0)); }, 0);
}

// Сколько упражнений сегодня выше собственного прошлого максимума (первое выполнение рекордом не считаем)
function socialRecordsToday(d, today) {
  const todayDn = dayNum(today);
  const best = {};
  coachExerciseSessions(coachEntries(d)).forEach(function (x) {
    const prior = x.sessions.filter(function (q) { return q.dn < todayDn; });
    best[x.id] = prior.length ? Math.max.apply(null, prior.map(function (q) { return q.maxW; })) : 0;
  });
  let n = 0;
  Object.keys(d.sessions || {}).forEach(function (k) {
    if (k.slice(0, 10) !== today) return;
    const skipped = (d.skipped && d.skipped[k]) || [];
    Object.keys(d.sessions[k] || {}).forEach(function (exId) {
      if (skipped.indexOf(exId) >= 0) return;
      const ws = Object.keys(d.sessions[k][exId] || {}).map(function (i) { return d.sessions[k][exId][i]; })
        .filter(function (s) { return s && s.done && s.weight; }).map(function (s) { return parseFloat(s.weight) || 0; });
      const mx = ws.length ? Math.max.apply(null, ws) : 0;
      if (mx > 0 && best[exId] > 0 && mx > best[exId]) n++;
    });
  });
  return n;
}

// Прогресс сегодняшней тренировки: { setsDone, setsPlanned, pct, recordsToday }
function socialLiveProgress(d, today, programs) {
  let done = 0, planned = 0;
  Object.keys(d.sessions || {}).forEach(function (k) {
    if (k.slice(0, 11) !== today + "_") return;
    const skipped = (d.skipped && d.skipped[k]) || [];
    Object.keys(d.sessions[k] || {}).forEach(function (exId) {
      if (skipped.indexOf(exId) >= 0) return;
      Object.keys(d.sessions[k][exId] || {}).forEach(function (i) {
        const s = d.sessions[k][exId][i];
        if (s && s.done) done++;
      });
    });
    planned += socialPlannedSets(d, k.slice(11), k, programs);
  });
  return {
    setsDone: done,
    setsPlanned: planned,
    pct: planned > 0 ? Math.min(100, Math.round(done / planned * 100)) : 0,
    recordsToday: socialRecordsToday(d, today)
  };
}

// Пакет, который участник публикует в комнату. Весов штанги здесь нет и быть не должно.
// changedAt - когда число подходов менялось в последний раз: при равенстве выигрывает тот, кто достиг раньше.
function socialLivePayload(d, today, changedAt) {
  const p = socialLiveProgress(d, today);
  return {
    userId: (d.identity && d.identity.userId) || "",
    name: (d.social && d.social.displayName) || "",
    setsDone: p.setsDone, pct: p.pct, recordsToday: p.recordsToday,
    at: changedAt || 0
  };
}

// ---- Счёт и табло ----

function socialCompScore(formatId, live) {
  if (formatId === "plan") return live.pct || 0;
  if (formatId === "records") return live.recordsToday || 0;
  return live.setsDone || 0;   // sets и team
}

// Табло: больше очков - выше; при равенстве раньше достиг (меньше at); затем по имени, чтобы порядок не прыгал
function socialCompRank(formatId, rows) {
  return rows.map(function (r) { return Object.assign({}, r, { score: socialCompScore(formatId, r) }); })
    .sort(function (a, b) {
      return b.score - a.score || (a.at || 0) - (b.at || 0) || ((a.name || "") < (b.name || "") ? -1 : (a.name || "") > (b.name || "") ? 1 : 0);
    })
    .map(function (r, i) { return Object.assign({}, r, { rank: i + 1 }); });
}

// Командная цель: сумма подходов всех участников против цели
function socialTeamProgress(rows, goal) {
  const total = rows.reduce(function (a, r) { return a + (r.setsDone || 0); }, 0);
  return { total: total, goal: goal, pct: goal > 0 ? Math.min(100, Math.round(total / goal * 100)) : 0, reached: goal > 0 && total >= goal };
}

// ---- Боты для холодного старта ----

function socialHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function socialRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SOCIAL_BOT_NAMES = ["Анна", "Борис", "Вика", "Глеб", "Дина", "Егор", "Зоя", "Игорь"];

// i-й бот комнаты: одно и то же зерно и номер всегда дают того же бота
function socialBot(seed, i) {
  const h = socialHash(seed + ":" + i);
  const r = socialRng(h);
  return {
    userId: "bot-" + h.toString(16),
    name: SOCIAL_BOT_NAMES[(socialHash(seed) + i) % SOCIAL_BOT_NAMES.length],
    skill: Math.round((0.75 + r() * 0.5) * 100) / 100,   // темп относительно эталонного, 0.75..1.25
    phase: Math.round(r() * 628) / 100
  };
}

// Эталонный темп (подходов в минуту) и длина тренировки по журналу пользователя; запасные значения для новичка
function socialReferencePace(d) {
  const sets = [];
  coachEntries(d).sort(function (a, b) { return b.ts - a.ts; }).slice(0, 10).forEach(function (e) {
    const n = (e.detail || []).reduce(function (a, x) { return a + (x.sets || []).filter(function (s) { return s && s.done; }).length; }, 0);
    if (n > 0) sets.push(n);
  });
  const avg = sets.length ? sets.reduce(function (a, b) { return a + b; }, 0) / sets.length : 18;
  return { planned: Math.max(6, Math.round(avg)), perMin: Math.max(6, Math.round(avg)) / 60 };
}

// Расписание подходов бота: минуты, в которые он закрывает 1-й, 2-й... подход. Неровное, как у человека:
// приходит не к самому старту, отдых между подходами разный, изредка долгая пауза (вода, очередь на
// тренажёр, телефон), а каждый четвёртый бросает тренировку на середине. Полностью определяется ботом.
function socialBotTimeline(bot, planned, perMin) {
  const r = socialRng(socialHash(bot.userId + ":timeline"));
  const mean = 1 / Math.max(0.05, perMin * bot.skill);   // средний интервал между подходами, минуты
  const quitAt = r() < 0.25 ? Math.max(2, Math.floor(planned * (0.5 + r() * 0.4))) : planned;
  let t = r() * Math.min(8, mean * 3);
  const out = [];
  for (let k = 0; k < quitAt; k++) {
    t += mean * (0.6 + r() * 0.8);
    if (k > 0 && k % (5 + Math.floor(r() * 3)) === 0) t += mean * (1.5 + r());
    out.push(t);
  }
  return out;
}

// Прогресс бота через minutes минут после старта: сколько подходов из его расписания уже закрыто
function socialBotLive(bot, minutes, planned, perMin) {
  const tl = socialBotTimeline(bot, planned, perMin);
  let done = 0;
  while (done < tl.length && tl[done] <= minutes) done++;
  return {
    setsDone: done,
    pct: planned > 0 ? Math.min(100, Math.round(done / planned * 100)) : 0,
    recordsToday: (done / Math.max(1, planned) >= 0.6 && bot.skill > 1.1) ? 1 : 0
  };
}

// Участники комнаты: люди плюс боты до capacity. Люди вытесняют ботов с конца списка, остальные боты
// и их прогресс не меняются. opts: { seed, capacity, minutes, planned, perMin, startsAt }
function socialRoomBoard(formatId, humans, opts) {
  const nBots = Math.max(0, opts.capacity - humans.length);
  const rows = humans.slice(0, opts.capacity).map(function (h) { return Object.assign({}, h, { bot: false }); });
  for (let i = 0; i < nBots; i++) {
    const b = socialBot(opts.seed, i);
    const live = socialBotLive(b, opts.minutes, opts.planned, opts.perMin);
    const tl = socialBotTimeline(b, opts.planned, opts.perMin);
    const reachedMin = live.setsDone > 0 ? tl[live.setsDone - 1] : 0;
    rows.push(Object.assign({ userId: b.userId, name: b.name, bot: true, at: (opts.startsAt || 0) + Math.round(reachedMin * 60000) }, live));
  }
  return socialCompRank(formatId, rows);
}

// ---- Комнаты в локальной заглушке ----
// Люди публикуют живой пакет, остальные подписываются. Ботов хранилище не знает: их считает socialRoomBoard.
const SOCIAL_ROOM_METHODS = ["createRoom", "joinRoom", "publishLive", "getRoom", "subscribeRoom"];

function socialLocalRooms(store, nowFn) {
  const db = store || {};
  if (!db.rooms) db.rooms = {};
  if (!db.subs) db.subs = {};
  if (!db.seq) db.seq = 0;
  const now = nowFn || function () { return Date.now(); };
  const room = function (id) { return db.rooms[id] || null; };
  const notify = function (id) { (db.subs[id] || []).forEach(function (cb) { cb(); }); };
  return {
    createRoom: function (opts) {
      db.seq++;
      const id = "room-" + db.seq;
      db.rooms[id] = { id: id, code: socialHash(id + ":" + now()).toString(16).toUpperCase().slice(0, 6), seed: id + ":" + now(),
        format: opts.format || "sets", minutes: opts.minutes || 60, capacity: opts.capacity || 5, startsAt: now(), humans: {} };
      return Promise.resolve(db.rooms[id]);
    },
    joinRoom: function (code, userId) {
      const r = Object.keys(db.rooms).map(room).filter(function (x) { return x.code === String(code).toUpperCase(); })[0];
      if (!r) return Promise.resolve({ error: "Комната не найдена" });
      if (!r.humans[userId] && Object.keys(r.humans).length >= r.capacity) return Promise.resolve({ error: "Комната заполнена" });
      if (!r.humans[userId]) r.humans[userId] = { userId: userId, name: "", setsDone: 0, pct: 0, recordsToday: 0, at: now() };
      notify(r.id);
      return Promise.resolve({ ok: true, roomId: r.id });
    },
    publishLive: function (roomId, live) {
      const r = room(roomId);
      if (!r) return Promise.resolve({ error: "Комната не найдена" });
      if (!r.humans[live.userId]) return Promise.resolve({ error: "Сначала войдите в комнату" });
      // Время достижения меняется только вместе с числом подходов: так «кто раньше» нельзя подделать повторной отправкой
      const prev = r.humans[live.userId];
      r.humans[live.userId] = Object.assign({}, live, { at: live.setsDone !== prev.setsDone ? now() : prev.at });
      notify(roomId);
      return Promise.resolve({ ok: true });
    },
    getRoom: function (roomId) {
      const r = room(roomId);
      return Promise.resolve(r ? { room: r, humans: Object.keys(r.humans).map(function (u) { return r.humans[u]; }) } : null);
    },
    subscribeRoom: function (roomId, cb) {
      if (!db.subs[roomId]) db.subs[roomId] = [];
      db.subs[roomId].push(cb);
      return function () { db.subs[roomId] = db.subs[roomId].filter(function (x) { return x !== cb; }); };
    }
  };
}

// ---- Интерфейс: демо-комната с ботами ----
const COMPETE_DEMO_SPEED = 45;   // 1 секунда на экране = 45 секунд тренировки: час проходит за 80 секунд, изменения видны сразу
const COMPETE_DEMO_MINUTES = 60;
const COMPETE_DEMO_CAPACITY = 5;

function CompetePanel(props) {
  const data = props.data;
  const today = todayKey();
  const [fmt, setFmt] = useState("sets");
  const [demo, setDemo] = useState(null);      // { seed, startedAt, extra: [{ userId, name, skill }] } | null
  const [, setTick] = useState(0);
  const changeRef = useRef({ done: -1, at: 0 });

  const live = socialLiveProgress(data, today);
  if (changeRef.current.done !== live.setsDone) changeRef.current = { done: live.setsDone, at: Date.now() };
  const f = SOCIAL_FORMATS.filter(x => x.id === fmt)[0];

  useEffect(() => {
    if (!demo) return;
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [!!demo]);

  function startDemo() { setDemo({ seed: "demo:" + Date.now(), startedAt: Date.now(), extra: [] }); }
  function addHuman() {
    setDemo(prev => {
      if (!prev || prev.extra.length >= COMPETE_DEMO_CAPACITY - 1) return prev;
      const n = prev.extra.length + 1;
      return { ...prev, extra: prev.extra.concat([{ userId: "demo-human-" + n, name: "Игрок " + n, skill: 0.9 + n * 0.05, joinedAt: Date.now() }]) };
    });
  }

  let board = null, team = null;
  if (demo) {
    const minutes = Math.min(COMPETE_DEMO_MINUTES, (Date.now() - demo.startedAt) / 1000 * COMPETE_DEMO_SPEED / 60);
    const ref = socialReferencePace(data);
    const planned = live.setsPlanned > 0 ? live.setsPlanned : ref.planned;
    const me = { userId: "me", name: (data.social && data.social.displayName) || "Вы", setsDone: live.setsDone, pct: live.pct, recordsToday: live.recordsToday, at: changeRef.current.at };
    const humans = [me].concat(demo.extra.map(h => {
      const fake = socialBotLive({ userId: h.userId, skill: h.skill }, Math.max(0, minutes - (h.joinedAt - demo.startedAt) / 1000 * COMPETE_DEMO_SPEED / 60), planned, ref.perMin);
      return Object.assign({ userId: h.userId, name: h.name, at: h.joinedAt }, fake);
    }));
    board = socialRoomBoard(fmt, humans, { seed: demo.seed, capacity: COMPETE_DEMO_CAPACITY, minutes: minutes, planned: planned, perMin: ref.perMin, startsAt: demo.startedAt });
    if (f.team) team = socialTeamProgress(board, Math.round(planned * COMPETE_DEMO_CAPACITY * 0.8));
    board.minutes = Math.round(minutes);
  }

  return (
    <BetaSection title="СОРЕВНОВАНИЯ СЕЙЧАС (СКОРО)">
      <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6, marginBottom: 12 }}>
        Комнаты для тех, кто тренируется прямо сейчас. Веса не публикуются: только подходы, процент плана и рекорды. Если в комнате мало людей, места занимают боты-партнёры (они отмечены значком 🤖), а люди постепенно их вытесняют. <span style={{ color: "#f7a844" }}>Сервера пока нет, ничего не отправляется.</span>
      </div>
      <ChipRow options={SOCIAL_FORMATS.map(x => [x.id, x.name])} value={fmt} onChange={setFmt} />
      <div style={{ fontSize: 11, color: "#aaa", lineHeight: 1.6, margin: "10px 0 4px" }}>{f.desc}</div>
      <div style={{ fontSize: 10, color: "#666", lineHeight: 1.6, marginBottom: 12 }}>В комнату уходит: {f.shares}.</div>
      <div style={{ background: "#0c0c0f", border: "1px solid #1a1a22", borderRadius: 10, padding: "10px 12px", fontSize: 11, color: "#bbb", lineHeight: 1.7, marginBottom: 12 }}>
        Ваш прогресс сегодня: {live.setsDone}{live.setsPlanned ? " из " + live.setsPlanned : ""} {live.setsDone === 1 ? "подход" : "подходов"}{live.setsPlanned ? " (" + live.pct + "%)" : ""}, рекордов: {live.recordsToday}
      </div>
      {!demo ? (
        <button onClick={startDemo}
          style={{ width: "100%", minHeight: 48, borderRadius: 9, border: "1px solid #6ab0ff60", background: "#6ab0ff12", color: "#6ab0ff", fontSize: 10, letterSpacing: 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          ДЕМО-КОМНАТА С БОТАМИ
        </button>
      ) : (
        <>
          <div style={{ fontSize: 9, letterSpacing: 2, color: "#6ab0ff", marginBottom: 4 }}>ДЕМО: ОКНО {board.minutes} ИЗ {COMPETE_DEMO_MINUTES} МИН (УСКОРЕННО)</div>
          <div style={{ fontSize: 10, color: "#888", marginBottom: 8 }}>
            В комнате: {board.filter(r => !r.bot).length} {coachPlural(board.filter(r => !r.bot).length, "человек", "человека", "человек")} и {board.filter(r => r.bot).length} {coachPlural(board.filter(r => r.bot).length, "бот-партнёр", "бота-партнёра", "ботов-партнёров")}
          </div>
          {team && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#bbb", marginBottom: 4 }}>Общая цель: {team.total} из {team.goal} подходов{team.reached ? " - достигнута!" : ""}</div>
              <div style={{ height: 6, background: "#1a1a22", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: team.pct + "%", background: "#4a9a6a" }} /></div>
            </div>
          )}
          {board.map(r => (
            <div key={r.userId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", marginBottom: 6, borderRadius: 9, background: r.userId === "me" ? "#f7a84412" : "#0c0c0f", border: "1px solid " + (r.userId === "me" ? "#f7a84440" : "#1a1a22") }}>
              <div style={{ width: 22, fontSize: 13, fontWeight: 700, color: r.rank === 1 ? "#f7a844" : "#777" }}>{f.team ? "-" : r.rank}</div>
              <div style={{ flex: 1, fontSize: 12, color: "#ddd" }}>{r.name || "Без имени"}{r.bot && <span title="бот-партнёр" style={{ marginLeft: 6, fontSize: 11 }}>🤖</span>}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{r.score}{fmt === "plan" ? "%" : ""}</div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button onClick={addHuman} disabled={demo.extra.length >= COMPETE_DEMO_CAPACITY - 1}
              style={{ flex: 1, minHeight: 48, borderRadius: 9, border: "1px solid #2a2a2a", background: "#0c0c0f", color: "#ddd", fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}>
              ПОДКЛЮЧИТЬ ЧЕЛОВЕКА
            </button>
            <button onClick={() => setDemo(null)}
              style={{ flex: 1, minHeight: 48, borderRadius: 9, border: "1px solid #2a2a2a", background: "#0c0c0f", color: "#999", fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}>
              ЗАКРЫТЬ ДЕМО
            </button>
          </div>
          <div style={{ fontSize: 10, color: "#666", lineHeight: 1.6, marginTop: 8 }}>
            Ваши подходы настоящие, берутся из текущей тренировки. Соперники и «подключённые люди» - имитация, боты отмечены значком 🤖. Каждый подключившийся человек вытесняет одного бота.
          </div>
        </>
      )}
    </BetaSection>
  );
}
