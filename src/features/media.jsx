// ==== ГИФКИ И КАРТИНКИ УПРАЖНЕНИЙ ====
// Анимации берутся ПО ССЫЛКЕ из открытого репозитория hasaneyldrm/exercises-dataset (через CDN jsDelivr,
// закреплено на конкретном коммите, поэтому файлы не меняются под ногами). К нам в репозиторий они НЕ
// копируются. Важно знать:
//   - Права на гифки принадлежат Gym visual (https://gymvisual.com/). Лицензия MIT репозитория на них не
//     распространяется (см. его LICENSE и NOTICE.md); автор выложил их с разрешением правообладателя в
//     размере 180x180 и с обязательной подписью. Решение пользоваться ими в личном приложении для себя и
//     друзей принято владельцем приложения (вариант "по прямой ссылке"). Подпись под каждой гифкой обязательна
//     и не убирается, картинки не увеличиваются выше 180 пикселей.
//   - Гифки нужны только при открытой карточке "Техника" и грузятся тогда же. Без интернета при первом
//     просмотре покажется сообщение, всё остальное работает как раньше. Повторный просмотр берётся из кэша
//     браузера (jsDelivr отдаёт закреплённые файлы на год).
//   - Соответствие "упражнение приложения -> гифка" проверено глазами по всем 120 анимациям (docs/claude/
//     exercises-media.md); таблицы охватывают и прежние карточки основных тренировок, и новые карточки фулбади
//     из src/beta/fullbody.jsx (они есть только в бете). Если точной анимации в библиотеке нет, гифки нет совсем: лучше пустое место, чем
//     другое упражнение. Список таких - EXERCISE_MEDIA_NONE, тест требует, чтобы каждое упражнение пула было
//     либо в EXERCISE_MEDIA, либо в этом списке (новое упражнение без решения о гифке тест не пропустит).
//   - Второй источник - запасной, для упражнений, у которых гифки нет: статичные картинки (две позы, плавное
//     переключение) из репозитория RepDB/exercise-dataset, тоже по ссылке через jsDelivr и на закреплённом коммите.
//     Условия бесплатной версии RepDB (LICENSE-DATA.md): использование в приложениях, в том числе коммерческое,
//     разрешено при видимой подписи "Exercise data by RepDB (repdb.co)"; нельзя публиковать как набор данных
//     (поэтому картинки к нам не копируются) и использовать как материал для генеративных моделей. Анимации RepDB
//     платные, образцы из их папки premium-samples только для оценки и здесь не используются. Гифка из первого
//     источника всегда важнее картинки: EXERCISE_STILLS получают только упражнения без гифки (тест).

const EXERCISE_MEDIA_COMMIT = "7455efae41b330c265e7cd4b78dfa848e7ce5ebd";
const EXERCISE_MEDIA_BASE = "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@" + EXERCISE_MEDIA_COMMIT + "/videos/";
// Подпись именно в такой форме требует NOTICE репозитория (знак копирайта и тире записаны кодами: в строках
// кода допускаются только кириллица, градус и эмодзи)
const EXERCISE_MEDIA_CREDIT = "\u00A9 Gym visual \u2014 https://gymvisual.com/";

// id упражнения -> имя файла гифки без расширения (videos/<имя>.gif)
const EXERCISE_MEDIA = {
  bench: "0025-EIeI8Vf",
  incline: "0314-ns0SIbU",
  dips: "1755-bZq4bwK",
  ohp: "1457-Kyd9Rz5",
  lateral: "0334-DsgkuIt",
  cg_press: "0030-J6Dx1Mu",
  french: "0061-iZop9xO",
  deadlift: "0032-ila4NZS",
  pullups: "0652-lBDjFxJ",
  bent_row: "0027-eZyBC3j",
  lat_pull: "0150-eYnzaCm",
  db_row: "0292-C0MA9bC",
  face_pull: "0203-wqNPGCg",
  barbell_curl: "0447-6TG6x2w",
  hammer: "0313-slDvUAU",
  squat: "0043-qXTaZnJ",
  leg_press: "0739-10Z2DXU",
  lunges: "0336-RRWFUcw",
  rdl: "0085-wQ2c4XD",
  leg_curl: "0586-17lJ1kr",
  leg_ext: "0585-my33uHU",
  calf: "1372-8ozhUIZ",
  fb_squat: "0043-qXTaZnJ",
  fb_bench: "0025-EIeI8Vf",
  fb_row_a: "0027-eZyBC3j",
  fb_ohp_a: "0426-A6wtbuL",
  fb_rdl_a: "1459-rR0LJzx",
  fb_hanging_a: "0472-I3tsCnC",
  fb_calf_a: "1372-8ozhUIZ",
  fb_leg_press: "0739-10Z2DXU",
  fb_incline_b: "0314-ns0SIbU",
  fb_pullup_b2: "0652-lBDjFxJ",
  fb_lateral_b: "0334-DsgkuIt",
  fb_hamstring_b: "0586-17lJ1kr",
  fb_tricep_b: "0201-3ZflifB",
  fb_pallof_b: "0979-9pa4H5m",
  fb_deadlift_c: "0032-ila4NZS",
  fb_goblet_c: "1760-yn8yg1r",
  fb_chest_fly_c: "0308-yz9nUhF",
  fb_cable_row_c: "0861-fUBheHs",
  fb_glute_bridge_c: "1409-qKBpF7I",
  fb_hammer_c: "0313-slDvUAU",
  fb_face_pull_c: "0203-wqNPGCg",
  bench_db: "0289-SpYC0Kp",
  bench_smith: "0748-trqKQv2",
  bench_cable: "0151-7xI5MXA",
  incline_smith: "0757-5v7KYld",
  incline_cable: "0179-FVmZVhk",
  incline_push: "0279-i5cEhka",
  dips_machine: "1451-BRImeP8",
  ohp_db: "0426-A6wtbuL",
  ohp_seated: "0091-kTbSH9h",
  arnold: "2137-Xy4jlWA",
  lateral_cable: "0178-goJ6ezq",
  lateral_machine: "0584-dRTfGZT",
  tricep_dip: "0814-X6C6i5Y",
  tricep_pushdown_bar: "0201-3ZflifB",
  overhead_ext: "2188-kont8Ut",
  skull_crusher_db: "0351-mpKZGWz",
  sumo: "0117-KgI0tqW",
  trap_bar: "0811-jQGwmxN",
  rdl_deadlift: "0085-wQ2c4XD",
  assisted_pullup: "0017-kiJ4Z2K",
  lat_pull_wide: "1325-CmEr4pM",
  neutral_pullup: "0651-0V2YQjW",
  tbar_row: "0606-aaXr7ld",
  cable_row: "0861-fUBheHs",
  chest_supported: "0327-7vG5o25",
  lat_pull_neutral: "0818-rkg41Fb",
  straight_arm: "0238-x69MAlq",
  seal_row: "0049-dmgMp3n",
  rear_delt_fly: "0380-v1qBec9",
  preacher_curl: "0070-qOgPVf6",
  concentration_curl: "0297-gvsWLQw",
  cross_curl: "0298-Qyk5J3p",
  rope_curl: "0165-HPlPoQA",
  pec_deck: "0596-v3xmPAR",
  cable_fly_mid: "0155-0CXGHya",
  upright_row: "0120-UDlhcO8",
  tricep_pushdown_rope: "0200-dU605di",
  bench_dip: "0129-RrLske5",
  good_morning: "0044-XlZ4lAC",
  negative_pullup: "0652-lBDjFxJ",
  chinup: "1326-T2mxWqc",
  pendlay_row: "3017-r0z6xzQ",
  iso_row: "1350-7I6LNUG",
  reverse_fly_machine: "0602-myfUsKf",
  spider_curl: "0454-Ye5Qxb0",
  incline_curl: "0318-ae9UoXQ",
  hack_squat: "0743-Qa55kX1",
  bulgarian_split: "0410-qx4fgX7",
  goblet_squat: "1760-yn8yg1r",
  step_up: "0431-aXtJhlg",
  reverse_lunge: "0381-SSsBDwB",
  single_rdl: "1757-gKozT8X",
  seated_calf: "0594-bOOdeyc",
  donkey_calf: "0284-u5ESqzH",
  decline_bench: "0033-GrO65fd",
  pushup_classic: "0662-I4hDWkc",
  cable_crossover_low: "0179-FVmZVhk",
  pullover_db: "0375-9XjtHvS",
  shrug: "0095-dG7tG5y",
  cable_curl: "0868-G08RZcQ",
  front_squat: "0042-zG0zs85",
  walking_lunge: "1460-IZVHb27",
  seated_leg_curl: "0599-Zg3XY7P",
  glute_kickback: "0228-Kpajagk",
  cable_pull_through: "0196-OM46QHm",
  db_pullover_chest: "0375-9XjtHvS",
  chest_fly_stretch: "0308-yz9nUhF",
  face_pull_posture: "0203-wqNPGCg",
  prone_yt_raise: "3541-PbzNu7c",
  hack_squat_2: "0743-Qa55kX1",
  front_squat_2: "0042-zG0zs85",
  goblet_squat_2: "1760-yn8yg1r",
  bulgarian_split_2: "0410-qx4fgX7",
  hack_squat_lp: "0743-Qa55kX1",
  goblet_squat_lp: "1760-yn8yg1r",
  bulgarian_split_lp: "0410-qx4fgX7",
  walking_lunge_2: "1460-IZVHb27",
  reverse_lunge_2: "0381-SSsBDwB",
  step_up_2: "0431-aXtJhlg",
  single_rdl_2: "1757-gKozT8X",
  cable_pull_through_2: "0196-OM46QHm",
  seated_leg_curl_2: "0599-Zg3XY7P",
  glute_kickback_2: "0228-Kpajagk",
  goblet_squat_le: "1760-yn8yg1r",
  hack_squat_le: "0743-Qa55kX1",
  seated_calf_alt: "0594-bOOdeyc",
  donkey_calf_2: "0284-u5ESqzH",
  fb_squat_alt1: "0743-Qa55kX1",
  fb_squat_alt2: "0410-qx4fgX7",
  fb_squat_alt3: "0739-10Z2DXU",
  fb_bench_alt1: "0289-SpYC0Kp",
  fb_bench_alt2: "0748-trqKQv2",
  fb_row_alt1: "0292-C0MA9bC",
  fb_row_alt2: "0861-fUBheHs",
  fb_row_alt3: "3017-r0z6xzQ",
  fb_ohp_alt1: "1457-Kyd9Rz5",
  fb_ohp_alt2: "0405-znQUdHY",
  fb_ohp_alt3: "2137-Xy4jlWA",
  fb_rdl_alt1: "0032-ila4NZS",
  fb_rdl_alt3: "0196-OM46QHm",
  fb_curl_alt1: "0447-6TG6x2w",
  fb_curl_alt2: "0070-qOgPVf6",
  fb_curl_alt3: "0313-slDvUAU",
  fb_calf_alt1: "0594-bOOdeyc",
  fb_calf_alt2: "0738-qCNVnaU",
  fb_legpress_alt1: "0043-qXTaZnJ",
  fb_legpress_alt2: "0743-Qa55kX1",
  fb_legpress_alt3: "0431-aXtJhlg",
  fb_incline_alt1: "0047-3TZduzM",
  fb_lateral_alt1: "0178-goJ6ezq",
  fb_lateral_alt2: "0203-wqNPGCg",
  fb_ham_alt1: "0085-wQ2c4XD",
  fb_ham_alt2: "0599-Zg3XY7P",
  fb_ham_alt3: "3645-rmEukuS",
  fb_tricep_alt1: "0030-J6Dx1Mu",
  fb_tricep_alt2: "0061-iZop9xO",
  fb_tricep_alt3: "0814-X6C6i5Y",
  fb_dead_alt1: "0117-KgI0tqW",
  fb_dead_alt2: "0811-jQGwmxN",
  fb_dead_alt3: "0085-wQ2c4XD",
  fb_goblet_alt1: "0042-zG0zs85",
  fb_goblet_alt2: "0336-RRWFUcw",
  fb_fly_alt1: "0155-0CXGHya",
  fb_fly_alt2: "0596-v3xmPAR",
  fb_lat_alt1: "1326-T2mxWqc",
  fb_lat_alt2: "0238-x69MAlq",
  fb_hammer_alt1: "0165-HPlPoQA",
  fb_hammer_alt2: "0318-ae9UoXQ",
  fb_face_alt1: "0380-v1qBec9",
  hanging_leg_raise: "0472-I3tsCnC",
  cable_crunch: "0175-WW95auq",
  pallof_press: "0979-9pa4H5m",
  russian_twist: "0687-XVDdcoj",
  crunch: "0274-TFqbd8t",
  back_extension: "0489-zhMwOwE",
  inverted_row: "0499-bZGHsAZ",
  rack_pull: "0074-za9Ni4z",
  chest_press_machine: "0577-T0yTjgW",
  shoulder_press_machine: "0869-vqsbmL0",
  front_raise: "0310-3eGE2JC",
  ohp_db_seated: "0405-znQUdHY",
  barbell_glute_bridge: "1409-qKBpF7I",
  smith_squat: "0770-jFtipLl",
  hip_abduction: "0597-CHpahtl",
  hip_adduction: "0598-oHsrypV",
  db_curl: "0294-NbVPDMW",
  zottman_curl: "0439-kXaIn5A",
  drag_curl: "0038-IENzBdA",
  reverse_curl: "0080-xNrS20v",
  wrist_curl: "0126-82LxxkW",
  tricep_kickback: "0333-W6PxUkg",
  single_arm_pushdown: "1723-qRZ5S1N",
  cable_overhead_ext: "0194-2IxROQ1",
  farmers_walk: "2133-qPEzJjA",
  fb_hang_alt1: "0175-WW95auq",
  fb_hang_alt2: "0274-TFqbd8t",
  fb_hang_alt3: "0979-9pa4H5m",
  fb_pullups_alt1: "0150-eYnzaCm",
  fb_pullups_alt2: "0970-r1XNRYB",
  fb_pullups_alt3: "0818-rkg41Fb",
  fb_plank_alt1: "0857-NAgVB3t",
  fb_plank_alt2: "0276-iny3m5y",
  fb_hip_alt1: "3013-u0cNiij",
  fb_hip_alt2: "0228-Kpajagk",
  fb_row_c_alt1: "0150-eYnzaCm",
  fb_row_c_alt2: "0327-7vG5o25",
  fb_row_c_alt3: "1350-7I6LNUG",
  // прежние карточки фулбади (в основной версии они остаются)
  fb_curl_a: "0031-25GPyDY",
  fb_pullups_b: "0652-lBDjFxJ",
  fb_lat_c: "0150-eYnzaCm",
};

// Запасной источник: статичные картинки RepDB (две позы start/peak, у планки и виса одна - main). Только для
// упражнений, у которых гифки нет. id упражнения -> имя в репозитории (images/flat/<имя>-start.webp и т. д.)
const EXERCISE_STILLS_COMMIT = "66c4298af8d99b9dc397dad6699e508fb871d249";
const EXERCISE_STILLS_BASE = "https://cdn.jsdelivr.net/gh/RepDB/exercise-dataset@" + EXERCISE_STILLS_COMMIT + "/images/flat/";
// Подпись в том виде, как её просит ATTRIBUTION.md репозитория
const EXERCISE_STILLS_CREDIT = "Exercise data by RepDB (repdb.co)";
const EXERCISE_STILLS = {
  band_pull_apart: "band-pull-apart",
  band_pull_posture: "band-pull-apart",
  dead_hang: "dead-hang",
  fb_face_alt2: "band-pull-apart",
  fb_hip_alt3: "hip-thrust",
  fb_hip_thrust_c: "hip-thrust",
  fb_incline_alt2: "cable-fly",
  fb_plank: "plank",
  fb_plank_alt3: "plank",
  fb_rdl_alt2: "hip-thrust",
  hip_thrust: "hip-thrust",
  hip_thrust_2: "hip-thrust",
  nordic_curl: "nordic-hamstring-curl",
  nordic_curl_2: "nordic-hamstring-curl",
  pike_pushup: "pike-push-ups",
  somersault_squat: "db-somersault-squat",
};
// картинки с одной позой (main) вместо пары start и peak
const EXERCISE_STILLS_SINGLE = ["dead-hang", "plank"];

// Упражнения, для которых нет ни гифки, ни картинки: в обеих библиотеках нет подходящего упражнения (то, что
// есть, показывает другое упражнение или другой вариант)
const EXERCISE_MEDIA_NONE = ["pushup_weighted", "fb_bench_alt3", "meadows_row", "w_press", "rib_cage_expansion", "scapula_retraction", "wall_angels"];

function exerciseMediaKey(exId) {
  return Object.prototype.hasOwnProperty.call(EXERCISE_MEDIA, exId) ? EXERCISE_MEDIA[exId] : null;
}
function exerciseMediaUrl(exId) {
  const k = exerciseMediaKey(exId);
  return k ? EXERCISE_MEDIA_BASE + k + ".gif" : null;
}
// Адреса картинок упражнения: [start, peak] или [main]; null, если картинки нет
function exerciseStillsUrls(exId) {
  if (!Object.prototype.hasOwnProperty.call(EXERCISE_STILLS, exId)) return null;
  const slug = EXERCISE_STILLS[exId];
  const poses = EXERCISE_STILLS_SINGLE.indexOf(slug) >= 0 ? ["main"] : ["start", "peak"];
  return poses.map(function (p) { return EXERCISE_STILLS_BASE + slug + "-" + p + ".webp"; });
}

// ---- Интерфейс ----
// Заглушка загрузки и переключение поз двигаются, поэтому помечены app-anim: при включённом "уменьшить
// движение" остаётся спокойная серая плитка и первая поза.
const EXM_CSS = [
  "@keyframes exmShimmer{from{background-position:200% 0}to{background-position:-200% 0}}",
  ".exm-skel{background:linear-gradient(110deg,var(--bg-1a1a22) 30%,var(--bg-1e1e28) 50%,var(--bg-1a1a22) 70%);background-size:200% 100%;animation:exmShimmer 1.3s linear infinite}",
  "@keyframes exmPose{0%,40%{opacity:1}50%,90%{opacity:0}100%{opacity:1}}",
  ".exm-pose{animation:exmPose 2.6s ease-in-out infinite}",
].join("\n");

// Гифка (а если её нет - картинка с двумя позами) в карточке "Техника". key={id упражнения} снаружи: при смене
// упражнения состояние начинается заново.
function ExerciseMedia(props) {
  const url = exerciseMediaUrl(props.exId);
  const stills = url ? null : exerciseStillsUrls(props.exId);
  const [state, setState] = useState("loading");   // loading | ok | failed
  const [loaded, setLoaded] = useState(0);
  if (!url && !stills) return null;
  const fill = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 };
  const ok = url ? state === "ok" : state !== "failed" && loaded >= stills.length;
  const credit = url ? { href: "https://gymvisual.com/", text: EXERCISE_MEDIA_CREDIT } : { href: "https://repdb.co", text: EXERCISE_STILLS_CREDIT };
  const picStyle = Object.assign({ display: "block", width: 180, height: 180 }, stills ? fill : {});
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "0 0 12px" }}>
      <style>{EXM_CSS}</style>
      <div style={{ position: "relative", width: 180, height: 180, borderRadius: 14, overflow: "hidden", background: "var(--bg-1a1a22)", border: "1px solid var(--bd-1a1a22)" }}>
        {!ok && state !== "failed" && <div className="app-anim exm-skel" style={fill} />}
        {url && state !== "failed" && (
          <img src={url} width="180" height="180" alt={"Анимация упражнения: " + props.name} referrerPolicy="no-referrer" decoding="async" draggable="false"
            onLoad={() => setState("ok")} onError={() => setState("failed")}
            style={{ display: "block", width: 180, height: 180, opacity: state === "ok" ? 1 : 0, transition: "opacity .3s ease" }} />
        )}
        {stills && state !== "failed" && (
          <div style={Object.assign({ opacity: ok ? 1 : 0, transition: "opacity .3s ease" }, fill)}>
            {stills.length > 1 && (
              <img src={stills[1]} width="180" height="180" alt="" aria-hidden="true" referrerPolicy="no-referrer" decoding="async" draggable="false"
                onLoad={() => setLoaded(n => n + 1)} onError={() => setState("failed")} style={picStyle} />
            )}
            <img className={stills.length > 1 ? "app-anim exm-pose" : undefined} src={stills[0]} width="180" height="180" alt={"Упражнение: " + props.name} referrerPolicy="no-referrer" decoding="async" draggable="false"
              onLoad={() => setLoaded(n => n + 1)} onError={() => setState("failed")} style={picStyle} />
          </div>
        )}
        {state === "failed" && (
          <div style={Object.assign({ display: "flex", alignItems: "center", justifyContent: "center", padding: 18, textAlign: "center", fontSize: 11, lineHeight: 1.5, color: "var(--tx-666)" }, fill)}>
            {(url ? "Анимация" : "Картинка") + " не загрузилась. Нужен интернет при первом просмотре."}
          </div>
        )}
      </div>
      <a href={credit.href} target="_blank" rel="noopener noreferrer"
        style={{ display: "inline-block", padding: "10px 8px 2px", fontSize: 9, letterSpacing: 0.5, color: "var(--tx-666)", textDecoration: "none" }}>
        {credit.text}
      </a>
    </div>
  );
}
