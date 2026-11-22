// ==== ПЕРЕСМОТР СПЛИТА (push, pull, legs) ====
// Разбор программы ПН/СР/ПТ: каждая мышца раз в неделю, поэтому объём и выбор упражнений должны быть без лишнего.
// Все упражнения берутся из пула, который уже есть в приложении (у них есть гифки); у слота меняется само
// упражнение, поэтому слот получает id нового упражнения, а прежнее уходит в его замены (журнал и подсказка веса
// ищут историю по id; прежняя история никуда не девается и подхватывается, если вернуть упражнение заменой).
//    - push: жим узким хватом -> разводка гантелей на растяжение (в грудь были одни жимы), французский жим ->
//      разгибания над головой на блоке (три тяжёлых жима на трицепс подряд, а длинная головка без работы);
//    - pull: тяга штанги в наклоне -> тяга гантелей с упором в грудь (поясница уже занята становой, а в пятницу
//      ещё румынская тяга);
//    - legs: сгибания ног -> сгибания сидя (задняя поверхность в растянутом положении), плюс ягодичный мостик
//      (ягодицы работали только косвенно) и подъёмы ног в висе (пресса в программе не было совсем).
// Подходов: push 25 (как было), pull 28 (как было), legs 26 -> 32.
// Фулбади файл не трогает: его пересмотр лежит в src/beta/fullbody.jsx. Файл идёт после exercises.jsx, поэтому
// новые упражнения уже лежат в пуле. Подробности - docs/claude/exercises-media.md.

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

// Забрать запись из пула (из любого списка замен): id остаётся в данных ровно один раз
function splTake(id) {
  let rec = null;
  Object.keys(ALTERNATIVES).forEach(function (k) {
    const list = ALTERNATIVES[k];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].id === id) rec = list.splice(i, 1)[0];
  });
  if (!rec) throw new Error("exercise not in the pool: " + id);
  return rec;
}

// Слот дня получает упражнение из пула, прежнее становится первой заменой нового. Замены прежнего слота,
// которые не пригодились новому, уходят в группу пула leftoverKey (из пула ничего не пропадает)
function splReplace(day, oldId, newId, altIds, leftoverKey) {
  const list = PROGRAM[day].exercises;
  let at = -1;
  for (let i = 0; i < list.length; i++) if (list[i].id === oldId) at = i;
  if (at < 0) throw new Error("exercise not in " + day + ": " + oldId);
  const oldRec = list[at];
  const rec = splTake(newId);
  const alts = altIds.map(splTake);
  const leftover = ALTERNATIVES[oldId] || [];
  if (leftover.length) {
    if (!leftoverKey) throw new Error("alternatives of " + oldId + " would be lost: " + leftover.map(function (e) { return e.id; }).join());
    ALTERNATIVES[leftoverKey] = (ALTERNATIVES[leftoverKey] || []).concat(leftover);
  }
  delete ALTERNATIVES[oldId];
  list[at] = rec;
  ALTERNATIVES[newId] = [oldRec].concat(alts);
}

// Новое упражнение дня из пула: после afterId (null - в конец)
function splAdd(day, afterId, newId, altIds) {
  const list = PROGRAM[day].exercises;
  let at = list.length;
  if (afterId) {
    at = -1;
    for (let i = 0; i < list.length; i++) if (list[i].id === afterId) at = i + 1;
    if (at < 0) throw new Error("exercise not in " + day + ": " + afterId);
  }
  const rec = splTake(newId);
  const alts = altIds.map(splTake);
  list.splice(at, 0, rec);
  ALTERNATIVES[newId] = alts;
}

(function splSplit() {
  // push
  splReplace("push", "cg_press", "chest_fly_stretch", ["pec_deck", "cable_fly_mid"], "cg_press_extra");
  splReplace("push", "french", "cable_overhead_ext", ["overhead_ext", "skull_crusher_db"]);
  // pull
  splReplace("pull", "bent_row", "chest_supported", ["tbar_row", "cable_row"]);
  // legs
  splReplace("legs", "leg_curl", "seated_leg_curl_2", ["nordic_curl_2", "glute_kickback_2"]);
  splAdd("legs", "leg_ext", "barbell_glute_bridge", ["hip_thrust", "cable_pull_through", "glute_kickback"]);
  splAdd("legs", null, "hanging_leg_raise", ["cable_crunch", "crunch", "pallof_press"]);
})();
