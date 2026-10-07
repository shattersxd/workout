// ==== ТРЕНЕР (тестовая версия) ====
// Локальный тренер на правилах: работает на телефоне, без сети и без ключей, данные никуда
// не уходят. Читает журнал (data.history) и расписание (data.schedule) и выдаёт сводку и советы.
// Правила и пороги - константы ниже; каждый совет имеет id, чтобы его можно было скрыть.
// Повторов приложение не хранит, поэтому судим только по весам, отметкам и датам.

const COACH_BREAK_DAYS = 10;        // перерыв, после которого советуем осторожный старт
const COACH_PLATEAU_STUCK = 3;      // столько тренировок подряд без нового максимума = застой
const COACH_PLATEAU_MIN_SESSIONS = 4;
const COACH_SPIKE_RATIO = 1.3;      // объём недели выше обычного во столько раз = резкий рост
const COACH_DELOAD_AFTER_WEEKS = 6; // столько недель подряд без лёгкой недели = пора разгрузиться
const COACH_SNOOZE_DAYS = 7;        // "Скрыть" прячет совет на неделю
const COACH_MAX_ADVICE = 6;

function coachPlural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// dayNum() - целое число суток с 1970-01-01 (UTC). 1970-01-01 был четвергом, поэтому 0 = понедельник:
function coachWeekday(dn) { return (dn + 3) % 7; }
function coachDateStr(dn) { return new Date(dn * 86400000).toISOString().slice(0, 10); }

function coachSchedule(d) {
  const s = d.schedule;
  return Array.isArray(s) && s.length === 7 ? s : ["push", null, "pull", null, "legs", null, null];
}

// Плоский список записей журнала с корректной датой
function coachEntries(d) {
  const out = [];
  Object.keys(d.history || {}).forEach(function (k) {
    (d.history[k] || []).forEach(function (e) {
      if (e && /^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) out.push(e);
    });
  });
  return out;
}

// Сумма весов отмеченных подходов - ровно то, что приложение называет "объёмом"
function coachEntryVolume(e) {
  return (e.detail || []).reduce(function (sum, x) {
    return sum + (x.sets || []).reduce(function (a, s) { return a + (s && s.done && s.w ? (parseFloat(s.w) || 0) : 0); }, 0);
  }, 0);
}

// По каждому упражнению: тренировки по возрастанию даты с максимальным рабочим весом
function coachExerciseSessions(entries) {
  const map = {};
  entries.forEach(function (e) {
    (e.detail || []).forEach(function (x) {
      if (!x || !x.id) return;
      const ws = (x.sets || []).filter(function (s) { return s && s.done && s.w; })
        .map(function (s) { return parseFloat(s.w) || 0; }).filter(function (w) { return w > 0; });
      if (!ws.length) return;
      const dn = dayNum(e.date);
      const mx = Math.max.apply(null, ws);
      const m = map[x.id] || (map[x.id] = { id: x.id, name: x.name || x.id, byDay: {} });
      if (!m.byDay[dn] || m.byDay[dn] < mx) m.byDay[dn] = mx;
      if (x.name) m.name = x.name;
    });
  });
  return Object.keys(map).map(function (id) {
    const m = map[id];
    const days = Object.keys(m.byDay).map(Number).sort(function (a, b) { return a - b; });
    return { id: id, name: m.name, sessions: days.map(function (dn) { return { dn: dn, maxW: m.byDay[dn] }; }) };
  });
}

// Сколько последних тренировок подряд не побили максимум (строго больше). 0 = последняя - рекорд
function coachStuck(sessions) {
  let best = 0, lastPr = 0;
  sessions.forEach(function (s, i) { if (s.maxW > best) { best = s.maxW; lastPr = i; } });
  return { best: best, stuck: sessions.length - 1 - lastPr };
}

// Недели (по понедельникам): { даты тренировок, объём }
function coachWeeks(entries) {
  const weeks = {};
  entries.forEach(function (e) {
    const dn = dayNum(e.date);
    const mon = dn - coachWeekday(dn);
    const w = weeks[mon] || (weeks[mon] = { dates: {}, volume: 0 });
    w.dates[e.date] = true;
    w.volume += coachEntryVolume(e);
  });
  Object.keys(weeks).forEach(function (k) { weeks[k].workouts = Object.keys(weeks[k].dates).length; });
  return weeks;
}

// Советы по анкете, весу тела и самочувствию (работают и без журнала). Нужен data.profile.
function coachProfileAdvice(d, today, planned) {
  const out = [];
  const p = d.profile;
  if (!p) return out;
  const log = d.bodyLog || [];
  const todayDn = dayNum(today);
  // 1. Давно не взвешивались
  const lastW = log.length ? dayNum(log[log.length - 1].date) : null;
  if (lastW === null || todayDn - lastW >= 14) {
    out.push({ id: "weigh", kind: "tip", title: "Самое время взвеситься",
      text: "Раз в 1-2 недели, утром, в одинаковых условиях: так видно тренд к вашей цели, а не колебания дня." });
  }
  // 2. Динамика веса относительно цели (нужны две записи с промежутком от 21 дня)
  const tr = bodyTrend(log, today);
  if (tr && tr.span >= 21) {
    if (p.goal === "mass" && tr.perWeek < 0.1) {
      out.push({ id: "trend-mass", kind: "tip", title: "Вес пока не растёт",
        text: "Цель - масса, а вес стоит на месте. Если тренировки идут по плану, можно добавить 200-300 ккал в день и оценить результат через 2-3 недели." });
    }
    if (p.goal === "cut" && tr.perWeek > -0.05) {
      out.push({ id: "trend-cut", kind: "tip", title: "Вес пока не снижается",
        text: "Цель - похудение. Стоит проверить питание и добавить ходьбу; спешить не нужно: 0,3-0,7 кг в неделю - нормальный темп." });
    }
    if (p.goal === "cut" && tr.perWeek < -(tr.latest * 0.01)) {
      out.push({ id: "trend-fast", kind: "warn", title: "Вес снижается довольно быстро",
        text: "Больше 1% веса тела в неделю: растёт риск потерять мышцы и силу. Стоит добавить немного еды." });
    }
  }
  // 3. Самочувствие: три последние оценки низкие
  const fe = feelRecent(d.feelLog, today);
  if (fe !== null && fe <= 2) {
    out.push({ id: "feel-low", kind: "warn", title: "Тренировки даются нелегко",
      text: "Средняя оценка трёх последних - " + String(fe).replace(".", ",") + " из 5. Попробуйте лёгкую неделю (веса на 10-20% ниже) или добавьте день отдыха и проверьте сон." });
  }
  // 4. В расписании меньше дней, чем рекомендовано по анкете
  const want = profileRecommend(p).days;
  if (planned < want) {
    out.push({ id: "plan-days", kind: "tip", title: "В расписании меньше тренировок, чем рекомендовано",
      text: "По анкете вам подходит " + want + " " + coachPlural(want, "тренировка", "тренировки", "тренировок") + " в неделю, а в расписании " + planned + ". Рекомендованное расписание можно применить в блоке ПРОФИЛЬ." });
  }
  return out;
}

const COACH_KIND_ORDER = { warn: 0, tip: 1, good: 2 };
const COACH_LAG_TITLE = { push: "Жимовых тренировок меньше других", pull: "Тяговых тренировок меньше других", legs: "Тренировок на ноги меньше других" };
const COACH_DAY_GEN = { push: "жимового дня", pull: "тягового дня", legs: "дня ног" };

// d - данные приложения (history, schedule), today - "YYYY-MM-DD". Возвращает { stats, advice }
function coachAnalyze(d, today) {
  const todayDn = dayNum(today);
  const entries = coachEntries(d);
  const sched = coachSchedule(d);
  const planned = sched.filter(Boolean).length;

  const dates = {};
  entries.forEach(function (e) { dates[e.date] = true; });
  const dnList = Object.keys(dates).map(dayNum).sort(function (a, b) { return a - b; });
  const monday = todayDn - coachWeekday(todayDn);
  const last = dnList.length ? dnList[dnList.length - 1] : null;
  const lastAgo = last === null ? null : todayDn - last;
  const in28 = dnList.filter(function (n) { return n > todayDn - 28 && n <= todayDn; }).length;
  const stats = {
    planned: planned,
    doneThisWeek: dnList.filter(function (n) { return n >= monday && n <= todayDn; }).length,
    lastAgo: lastAgo,
    perWeek: Math.round(in28 / 4 * 10) / 10,
    total: dnList.length
  };
  const advice = coachProfileAdvice(d, today, planned);
  if (!dnList.length) {
    advice.sort(function (a, b) { return COACH_KIND_ORDER[a.kind] - COACH_KIND_ORDER[b.kind]; });
    return { stats: stats, advice: advice.slice(0, COACH_MAX_ADVICE) };
  }

  // 1. Перерыв
  const onBreak = lastAgo >= COACH_BREAK_DAYS;
  if (onBreak) {
    advice.push({ id: "break", kind: "warn", title: "Перерыв " + lastAgo + " " + coachPlural(lastAgo, "день", "дня", "дней"),
      text: "Начните с 80-90% рабочих весов и не гонитесь за рекордами первую неделю: связки и техника возвращаются медленнее, чем кажется." });
  }

  // 2. Пропуски по расписанию за 2 недели (после перерыва они уже учтены)
  if (!onBreak) {
    const from = Math.max(todayDn - 14, dnList[0]);
    let plannedDays = 0, missed = 0;
    for (let n = from; n < todayDn; n++) {
      if (sched[coachWeekday(n)]) {
        plannedDays++;
        if (!dates[coachDateStr(n)]) missed++;
      }
    }
    if (plannedDays >= 3 && missed >= 2 && missed / plannedDays >= 0.4) {
      advice.push({ id: "missed", kind: "warn", title: "Пропущено " + missed + " из " + plannedDays + " по плану",
        text: "За две недели. Если расписание неудобно, поправьте дни в меню, в разделе Мой план: лучше меньше тренировок, но регулярно." });
    }
  }

  // 3-4. Застой и рекорды по упражнениям
  const exs = coachExerciseSessions(entries);
  const plateaus = [], records = [];
  exs.forEach(function (x) {
    const s = x.sessions;
    const lastS = s[s.length - 1];
    const st = coachStuck(s);
    if (s.length >= COACH_PLATEAU_MIN_SESSIONS && st.stuck >= COACH_PLATEAU_STUCK && todayDn - lastS.dn <= 30) {
      plateaus.push({ x: x, st: st });
    }
    if (s.length >= 2 && st.stuck === 0 && todayDn - lastS.dn <= 7) {
      const prevBest = Math.max.apply(null, s.slice(0, -1).map(function (q) { return q.maxW; }));
      records.push({ x: x, w: lastS.maxW, delta: lastS.maxW - prevBest });
    }
  });
  plateaus.sort(function (a, b) { return b.st.stuck - a.st.stuck || (a.x.name < b.x.name ? -1 : 1); });
  plateaus.slice(0, 3).forEach(function (p) {
    advice.push({ id: "plateau:" + p.x.id, kind: "tip", title: p.x.name,
      text: "Максимум " + p.st.best + " кг не растёт уже " + p.st.stuck + " " + coachPlural(p.st.stuck, "тренировку", "тренировки", "тренировок") +
        " подряд. Можно попробовать разгрузочную неделю (-10% веса), другую схему повторов или замену упражнения." });
  });
  records.sort(function (a, b) { return b.delta - a.delta; });
  records.slice(0, 3).forEach(function (r) {
    advice.push({ id: "pr:" + r.x.id + ":" + r.w, kind: "good", title: "Новый рекорд: " + r.x.name,
      text: r.w + " кг (+" + Math.round(r.delta * 100) / 100 + " к прошлому максимуму)." });
  });

  // 5. Перекос между днями жим/тяга/ноги за 4 недели (только дни, которые есть в расписании)
  const keys = ["push", "pull", "legs"].filter(function (k) { return sched.indexOf(k) >= 0; });
  if (keys.length >= 2) {
    const seen = {}, counts = {};
    keys.forEach(function (k) { counts[k] = 0; });
    entries.forEach(function (e) {
      const dn = dayNum(e.date);
      const key = e.date + "|" + e.workout;
      if (counts[e.workout] === undefined || seen[key] || dn <= todayDn - 28 || dn > todayDn) return;
      seen[key] = true;
      counts[e.workout]++;
    });
    const total = keys.reduce(function (a, k) { return a + counts[k]; }, 0);
    const top = keys.reduce(function (a, k) { return counts[k] > counts[a] ? k : a; }, keys[0]);
    if (total >= 6 && counts[top] >= 3) {
      keys.forEach(function (k) {
        if (k !== top && counts[k] / total < 0.15) {
          advice.push({ id: "balance:" + k, kind: "warn", title: COACH_LAG_TITLE[k],
            text: counts[k] + " " + coachPlural(counts[k], "тренировка", "тренировки", "тренировок") + " за 4 недели против " + counts[top] +
              " у " + COACH_DAY_GEN[top] + ". Сильный перекос в одну сторону нагружает суставы и тормозит прогресс." });
        }
      });
    }
  }

  // 6-8. Недели: резкий рост объёма, пора разгрузиться, серия недель по плану
  const weeks = coachWeeks(entries);
  const cur = weeks[monday];
  const prev = [1, 2, 3].map(function (i) { return weeks[monday - 7 * i]; }).filter(Boolean);
  if (cur && prev.length >= 2) {
    const avg = prev.reduce(function (a, w) { return a + w.volume; }, 0) / prev.length;
    if (avg > 0 && cur.volume > avg * COACH_SPIKE_RATIO) {
      advice.push({ id: "spike", kind: "warn", title: "Объём недели вырос на " + Math.round((cur.volume / avg - 1) * 100) + "%",
        text: "Это заметно выше обычного. Следите за восстановлением и не добавляйте вес во всех упражнениях сразу." });
    }
  }
  const streak = [];
  for (let i = 1; weeks[monday - 7 * i] && weeks[monday - 7 * i].workouts >= 2; i++) streak.push(weeks[monday - 7 * i]);
  if (streak.length >= COACH_DELOAD_AFTER_WEEKS) {
    const avg = streak.reduce(function (a, w) { return a + w.volume; }, 0) / streak.length;
    const light = streak.some(function (w) { return w.volume < avg * 0.7; });
    if (!light) {
      advice.push({ id: "deload", kind: "tip", title: streak.length + " " + coachPlural(streak.length, "неделя", "недели", "недель") + " подряд без разгрузки",
        text: "Неделя с весами на 10-20% ниже или с меньшим числом подходов поможет восстановиться и вернуться сильнее." });
    }
  }
  if (planned >= 2) {
    let ok = cur && cur.workouts >= planned ? 1 : 0;
    for (let i = 1; weeks[monday - 7 * i] && weeks[monday - 7 * i].workouts >= planned; i++) ok++;
    if (ok >= 3) {
      advice.push({ id: "streak:" + ok, kind: "good", title: ok + " " + coachPlural(ok, "неделя", "недели", "недель") + " подряд по плану",
        text: "Регулярность важнее любой программы. Отличный результат!" });
    }
  }

  advice.sort(function (a, b) { return COACH_KIND_ORDER[a.kind] - COACH_KIND_ORDER[b.kind]; });
  return { stats: stats, advice: advice.slice(0, COACH_MAX_ADVICE) };
}

// Скрытые советы: { id: "YYYY-MM-DD" } - прячем на COACH_SNOOZE_DAYS
function coachVisible(advice, dismissed, today) {
  return advice.filter(function (a) {
    return !(dismissed && dismissed[a.id] && dayNum(today) - dayNum(dismissed[a.id]) < COACH_SNOOZE_DAYS);
  });
}

const COACH_KIND_STYLE = {
  warn: { color: "#f7a844", border: "#f7a84440", bg: "#1a1206", icon: "🟠" },
  tip: { color: "#6ab0ff", border: "#6ab0ff40", bg: "#0a1220", icon: "💡" },
  good: { color: "#4a9a6a", border: "#4a9a6a40", bg: "#0e1a13", icon: "🏆" }
};

function CoachPanel(props) {
  const data = props.data;
  const setData = props.setData;
  const today = todayKey();
  const res = coachAnalyze(data, today);
  const visible = coachVisible(res.advice, data.coachDismissed, today);
  const st = res.stats;
  const tiles = [
    ["НА НЕДЕЛЕ", st.doneThisWeek + " из " + st.planned],
    ["ПОСЛЕДНЯЯ", st.lastAgo === null ? "-" : (st.lastAgo === 0 ? "сегодня" : st.lastAgo + " дн. назад")],
    ["ТЕМП", String(st.perWeek).replace(".", ",") + " в нед."]
  ];

  function dismiss(id) {
    setData(prev => ({ ...prev, coachDismissed: { ...(prev.coachDismissed || {}), [id]: todayKey() } }));
  }

  return (
    <BetaSection title="ТРЕНЕР">
      {st.total > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {tiles.map(t => (
            <div key={t[0]} style={{ flex: 1, background: "#0c0c0f", border: "1px solid #1a1a22", borderRadius: 10, padding: "10px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#ddd", marginBottom: 3 }}>{t[1]}</div>
              <div style={{ fontSize: 8, color: "#666", letterSpacing: 1 }}>{t[0]}</div>
            </div>
          ))}
        </div>
      )}
      {visible.length === 0 && (
        <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6 }}>
          {st.total === 0
            ? "Пока данных для анализа нет. Перенесите историю из основной версии (блок ДАННЫЕ выше) или завершите пару тренировок здесь."
            : "Замечаний нет, всё в порядке. Тренер следит за перерывами, пропусками, застоем в весах, перекосами между днями, ростом нагрузки, весом тела и самочувствием."}
        </div>
      )}
      {visible.map(a => {
        const k = COACH_KIND_STYLE[a.kind];
        return (
          <div key={a.id} style={{ background: k.bg, border: "1px solid " + k.border, borderRadius: 10, padding: "12px 12px 10px 14px", marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: k.color, marginBottom: 5 }}>{k.icon} {a.title}</div>
            <div style={{ fontSize: 11, color: "#bbb", lineHeight: 1.6 }}>{a.text}</div>
            <div style={{ textAlign: "right", marginTop: 2 }}>
              <button onClick={() => dismiss(a.id)}
                style={{ minHeight: 44, padding: "0 12px", background: "none", border: "none", color: "#666", fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}>
                СКРЫТЬ НА НЕДЕЛЮ
              </button>
            </div>
          </div>
        );
      })}
    </BetaSection>
  );
}
