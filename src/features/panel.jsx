// ==== Общие части экранов ====
// Карточка раздела: заголовок мелкими буквами и рамка вокруг содержимого. Её используют панели тренера,
// профиля, сообщества и вкладка "БЕТА". Цвета - токены темы (см. head.html).

function PanelSection(props) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "var(--tx-666)", marginBottom: 10 }}>{props.title}</div>
      <div style={{ background: "var(--bg-0f0f12)", border: "1px solid var(--bd-1a1a22)", borderRadius: 10, padding: "14px 14px" }}>
        {props.children}
      </div>
    </div>
  );
}
