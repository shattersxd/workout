// ==== МЕНЮ В ШАПКЕ (тестовая версия) ====
// Кнопка в шапке на месте "+ПЛАН" и боковая панель с пунктами. Пункты - это данные (betaMenuItems),
// а что открыть, решает App по item.screen ("list" - Мой план, "settings" - Настройки).
// Если меню приживётся, этот файл переезжает в основную версию вместе с экраном настроек.
// Цвета - только токены темы (var(--...)): так экран не придётся переделывать при переносе.

// Куда ведут пункты: значения planScreen в App (тест сверяет список с App)
const BETA_MENU_SCREENS = ["list", "settings"];

function betaMenuItems() {
  return [
    { id: "plan", screen: "list", title: "МОЙ ПЛАН", sub: "Расписание недели, программы, свои тренировки" },
    { id: "settings", screen: "settings", title: "НАСТРОЙКИ", sub: "Тема, экран, вес гантелей, резервная копия" },
  ];
}

// Три полоски вместо значка из шрифта: символы вне кириллицы и эмодзи в строках запрещены (CLAUDE.md)
function BetaMenuButton(props) {
  const bar = { display: "block", width: 18, height: 2, borderRadius: 1, background: "var(--tx-888)" };
  return (
    <button onClick={props.onClick} aria-label="Меню" aria-haspopup="dialog"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, width: 44, height: 44, padding: 0, borderRadius: 8, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-0f0f12)", cursor: "pointer", flexShrink: 0 }}>
      <span style={bar} /><span style={bar} /><span style={bar} />
    </button>
  );
}

function BetaMenu(props) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Меню" onClick={props.onClose}
      style={{ position: "fixed", inset: 0, background: "var(--scrim-lite)", zIndex: 600, display: "flex", justifyContent: "flex-end", animation: "betaMenuFade 0.18s ease-out" }}>
      <style>{"@keyframes betaMenuFade{from{opacity:0}to{opacity:1}} @keyframes betaMenuSlide{from{transform:translateX(100%)}to{transform:none}} @media (prefers-reduced-motion: reduce){.beta-menu{animation:none!important}}"}</style>
      <div className="beta-menu" onClick={e => e.stopPropagation()}
        style={{ width: "min(84vw, 340px)", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", background: "var(--bg-0c0c0f)", borderLeft: "1px solid var(--bd-2a2a2a)", padding: "calc(16px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom))", overflowY: "auto", WebkitOverflowScrolling: "touch", animation: "betaMenuSlide 0.22s ease-out" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ fontSize: 10, letterSpacing: 4, color: "var(--tx-777)" }}>МЕНЮ</div>
          <button onClick={props.onClose} aria-label="Закрыть меню"
            style={{ width: 44, height: 44, borderRadius: 10, border: "1px solid var(--bd-2a2a2a)", background: "var(--bg-0f0f12)", color: "var(--tx-888)", fontSize: 18, cursor: "pointer", fontFamily: "inherit" }}>x</button>
        </div>

        {props.items.map(it => (
          <button key={it.id} onClick={() => props.onSelect(it)}
            style={{ width: "100%", minHeight: 60, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", marginBottom: 8, borderRadius: 10, border: "1px solid var(--bd-1a1a22)", background: "var(--bg-0f0f12)", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--tx-fff)", marginBottom: 3 }}>{it.title}</div>
              <div style={{ fontSize: 10, color: "var(--tx-666)", lineHeight: 1.5 }}>{it.sub}</div>
            </div>
            <div style={{ fontSize: 16, color: "var(--tx-555)", flexShrink: 0 }}>{">"}</div>
          </button>
        ))}

        <div style={{ marginTop: "auto", paddingTop: 20 }}>
          <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--tx-f7a844)", marginBottom: 4 }}>ТЕСТОВАЯ ВЕРСИЯ</div>
          <div style={{ fontSize: 10, color: "var(--tx-666)", lineHeight: 1.6 }}>
            Данные здесь хранятся отдельно от основной версии.
          </div>
        </div>
      </div>
    </div>
  );
}
