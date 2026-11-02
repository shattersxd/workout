// ==== ПЕРЕСМОТР ФУЛБАДИ (тестовая версия) ====
// Фулбади A/B/C по итогам разбора (подробно - в docs/claude/exercises-media.md). Пока только в бете: в основной
// версии фулбади прежние. Файл идёт после src/features/exercises.jsx, поэтому новые упражнения (hanging_leg_raise,
// pallof_press, barbell_glute_bridge и другие) уже лежат в пуле.
//    - тяга: в B и C были две вертикальные тяги (подтягивания и тяга блока), горизонтальная только одна.
//      Теперь C - тяга горизонтального блока, вертикальная тяга одна (подтягивания в B);
//    - кор: на неделю приходилось 3 подхода планки. Теперь в A подъёмы ног в висе вместо сгибаний со
//      штангой (бицепс остаётся в C и в тягах), а икры в A - 4 подхода вместо 3;
//    - три карточки с "или" в названии ("Подтягивания или тяга", "Становая тяга или RDL", "Планка или
//      ролик") теперь называют одно упражнение, остальное - в замене. Прогрессия по такой карточке
//      раньше смешивала разные упражнения;
//    - у каждого упражнения основных тренировок должна быть гифка, которая показывает ИМЕННО его. В библиотеке
//      нет статичной планки и хип-траста со скамьёй, поэтому в B вместо планки Pallof press (тоже кор,
//      антиротация), а в C вместо хип-траста мостик со штангой на полу. Планка и хип-траст остались в
//      списках замены (у них только статичные картинки).
// Новые id нужны там, где меняется само упражнение: журнал и подсказка веса ищут историю по id, и вес "тяги
// блока" не должен попасть в "тягу горизонтального блока". Там, где меняется только название (id прежний),
// история общая.

function exbFind(id) {
  let found = null;
  Object.keys(PROGRAM).forEach(function (k) { PROGRAM[k].exercises.forEach(function (e) { if (e.id === id) found = e; }); });
  Object.keys(ALTERNATIVES).forEach(function (k) { ALTERNATIVES[k].forEach(function (e) { if (e.id === id) found = e; }); });
  return found;
}

// Копия упражнения под новым id (техника та же, подходы и название можно поменять)
function exbClone(srcId, newId, over) {
  const src = exbFind(srcId);
  if (!src) throw new Error("exercise not found: " + srcId);
  return Object.assign({}, src, over || {}, { id: newId, steps: src.steps.slice() });
}

function exbSwap(day, oldId, rec) {
  const list = PROGRAM[day].exercises;
  for (let i = 0; i < list.length; i++) if (list[i].id === oldId) { list[i] = rec; return; }
  throw new Error("exercise not in " + day + ": " + oldId);
}

function exbRename(day, id, fields) {
  const list = PROGRAM[day].exercises;
  for (let i = 0; i < list.length; i++) if (list[i].id === id) { Object.assign(list[i], fields); return; }
  throw new Error("exercise not in " + day + ": " + id);
}

(function exbFullbody() {
  // 2. фулбади A: подъёмы ног в висе вместо сгибаний со штангой, икры 4 подхода
  exbSwap("fullbody_a", "fb_curl_a", exbClone("hanging_leg_raise", "fb_hanging_a", { sets: 3, reps: "10-15", rest: "90 сек" }));
  ALTERNATIVES.fb_hanging_a = [
    exbClone("cable_crunch", "fb_hang_alt1"),
    exbClone("crunch", "fb_hang_alt2"),
    exbClone("pallof_press", "fb_hang_alt3"),
  ];
  exbRename("fullbody_a", "fb_calf_a", { sets: 4, reps: "12-15", rest: "90 сек" });

  // 3. фулбади B: одно упражнение на вертикальную тягу и честное название планки
  exbSwap("fullbody_b", "fb_pullups_b", exbClone("pullups", "fb_pullup_b2", { name: "Подтягивания", sets: 3, reps: "8-12", rest: "3 мин" }));
  ALTERNATIVES.fb_pullup_b2 = ALTERNATIVES.fb_pullups_b;   // те же замены: тяга блока, подтягивания с резинкой, нейтральный хват
  delete ALTERNATIVES.fb_pullups_b;
  // кор: Pallof press вместо планки (у планки в библиотеке гифки нет); сама планка уходит в замену к нему
  const plankAlt = exbClone("fb_plank", "fb_plank_alt3", { name: "Планка", sets: 3, reps: "30-60 сек", rest: "60 сек" });
  exbSwap("fullbody_b", "fb_plank", exbClone("pallof_press", "fb_pallof_b", { sets: 3, reps: "10-12 на сторону", rest: "60 сек" }));
  ALTERNATIVES.fb_pallof_b = ALTERNATIVES.fb_plank.concat([plankAlt]);   // ролик, dead bug, планка
  delete ALTERNATIVES.fb_plank;

  // 4. фулбади C: тяга горизонтального блока вместо второй вертикальной тяги, одна "становая"
  exbRename("fullbody_c", "fb_deadlift_c", { name: "Становая тяга" });
  // ягодицы: мостик со штангой на полу вместо хип-траста (у хип-траста со скамьёй в библиотеке гифки нет), сам
  // хип-траст уходит в замену
  const hipAlt = exbClone("fb_hip_thrust_c", "fb_hip_alt3", { name: "Ягодичный мостик с штангой (Hip Thrust)" });
  exbSwap("fullbody_c", "fb_hip_thrust_c", exbClone("barbell_glute_bridge", "fb_glute_bridge_c", { sets: 3, reps: "10-15", rest: "2 мин" }));
  ALTERNATIVES.fb_glute_bridge_c = ALTERNATIVES.fb_hip_thrust_c.concat([hipAlt]);   // мостик на полу, отведение ноги, хип-траст
  delete ALTERNATIVES.fb_hip_thrust_c;
  exbSwap("fullbody_c", "fb_lat_c", exbClone("cable_row", "fb_cable_row_c", { name: "Тяга горизонтального блока", sets: 3, reps: "10-12", rest: "2 мин" }));
  ALTERNATIVES.fb_cable_row_c = [
    exbClone("lat_pull", "fb_row_c_alt1", { name: "Тяга верхнего блока к груди" }),
    exbClone("chest_supported", "fb_row_c_alt2"),
    exbClone("iso_row", "fb_row_c_alt3"),
  ];
})();
