// ==== НАВИГАЦИЯ ВНИЗУ (тестовая версия) ====
// Раньше вкладки стояли в шапке: мелкие (9.5 пикселя), на самом верху большого телефона, а сама шапка с названием
// и неделей висела над списком и занимала почти четверть экрана. Теперь:
//   - вкладки внизу, под большим пальцем, с значками; повторное нажатие на открытую вкладку прокручивает наверх
//     (так добираются до меню и недели);
//   - шапка обычная, уезжает вместе со страницей - список упражнений занимает весь экран;
//   - ход тренировки виден всегда: линия по верхнему краю панели и счёт подходов под значком тренировки.
// Таймер отдыха, подсказки и плашка отмены поднимаются на высоту панели (NV_H), чтобы не перекрываться.
// Тексты без "ты" и "вы". Всё, что тесты исполняют, лежит выше разделителя "Интерфейс" (его строка ниже).

const NV_H = 58;    // высота панели без нижней безопасной зоны

// Подпись под значком: у тренировки, пока она идёт, вместо названия счёт подходов
function nvLabel(id, label, prog) {
  if (id === "workout" && prog && prog.total > 0 && prog.done > 0) return prog.done + "/" + prog.total;
  return label;
}

// Ширина линии хода тренировки в процентах (0 - линии нет)
function nvLine(prog) {
  if (!prog || !(prog.total > 0) || !(prog.done > 0)) return 0;
  return Math.max(2, Math.min(100, Math.round(prog.done / prog.total * 100)));
}

// ---- Интерфейс ----
const NV_ICONS = {
  workout: ["M6.5 6.5v11", "M17.5 6.5v11", "M3 9.5v5", "M21 9.5v5", "M6.5 12h11"],
  warmup: ["M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 .3 1.6 1 2.5 2 3 .2-3-.3-5.5 1-8.5z"],
  journal: ["M6 4h12v16H6z", "M9 9h6", "M9 13h6", "M9 17h3"],
  achievements: ["M8 4h8v5a4 4 0 0 1-8 0z", "M8 6H5a3 3 0 0 0 3 3", "M16 6h3a3 3 0 0 1-3 3", "M12 13v4", "M8.5 20h7"],
  beta: ["M10 3h4", "M10.5 3v6l-5 9a1.5 1.5 0 0 0 1.3 2.2h10.4a1.5 1.5 0 0 0 1.3-2.2l-5-9V3", "M8 15h8"],
};

function NvIcon(props) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={props.on ? 2.3 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(NV_ICONS[props.name] || NV_ICONS.journal).map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// Нижняя панель вкладок. tabs: [[id, подпись]], active, onPick(id), prog - ход тренировки ({ done, total })
function NvBar(props) {
  const line = nvLine(props.prog);
  const pick = id => {
    const same = id === props.active;
    props.onPick(id);
    try {
      let calm = false;
      try { calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
      // другая вкладка открывается с начала; та же - плавно возвращает наверх, к шапке и меню
      if (same && !calm && window.scrollTo) window.scrollTo({ top: 0, behavior: "smooth" });
      else window.scrollTo(0, 0);
    } catch (e) {}
  };
  return (
    <>
      {/* полоса под часами и зарядом: шапка больше не висит наверху, без полосы текст просвечивал бы под ними */}
      <div aria-hidden="true" style={{ position: "fixed", top: 0, left: 0, right: 0, height: "env(safe-area-inset-top)", background: "var(--bg-0c0c0f)", zIndex: 95, pointerEvents: "none" }} />
      <nav aria-label="Разделы" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 90, background: "var(--bg-0c0c0f)", borderTop: "1px solid var(--bd-1a1a22)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {line > 0 && <div aria-hidden="true" style={{ position: "absolute", top: -2, left: 0, height: 3, width: line + "%", background: props.color, borderRadius: "0 3px 3px 0", transition: "width 0.5s" }} />}
        <div style={{ display: "flex", maxWidth: 560, margin: "0 auto" }}>
          {props.tabs.map(t => {
            const on = props.active === t[0];
            return (
              <button key={t[0]} onClick={() => pick(t[0])} aria-current={on ? "page" : undefined}
                style={{ flex: 1, minWidth: 0, height: NV_H, minHeight: 44, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, background: "none", border: "none", padding: "0 2px", color: on ? props.ink(props.color) : "var(--tx-666)", cursor: "pointer", fontFamily: "inherit" }}>
                <NvIcon name={t[0]} on={on} />
                <span style={{ fontSize: 9, letterSpacing: 0.5, fontWeight: on ? 700 : 400, whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>{nvLabel(t[0], t[1], props.prog)}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
