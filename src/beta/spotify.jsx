// ==== SPOTIFY-ПУЛЬТ (тестовая версия) ====
// Музыку играет приложение Spotify на телефоне (встроенный плеер Spotify в Safari на iPhone
// не работает), а здесь - пульт: что играет, пауза, следующий и предыдущий трек.
// Вход - Authorization Code + PKCE: секретов нет, нужен только Client ID вашего приложения из
// developer.spotify.com/dashboard. Управление воспроизведением требует Spotify Premium и
// активного устройства (приложение Spotify, в котором недавно играла музыка).
//
// Токены лежат под ОТДЕЛЬНЫМ ключом, а не в data: иначе они попали бы в файл резервной копии.

const SPOTIFY_STORAGE_KEY = "ppl_spotify_beta";
const SPOTIFY_SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative";
const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_POLL_MS = 5000;
const SPOTIFY_PLAYLISTS_PATH = "/me/playlists?limit=20";

// Текущее время: переданное значение (в том числе 0) важнее часов
function spNow(now) { return now === undefined ? Date.now() : now; }

function spLoad() {
  try { return JSON.parse(localStorage.getItem(SPOTIFY_STORAGE_KEY)) || {}; } catch (e) { return {}; }
}
function spSave(o) {
  try { localStorage.setItem(SPOTIFY_STORAGE_KEY, JSON.stringify(o)); } catch (e) {}
}

function spBase64Url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function spRandomString(len) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  let s = "";
  for (let i = 0; i < len; i++) s += chars[a[i] % chars.length];
  return s;
}

async function spChallenge(verifier) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return spBase64Url(new Uint8Array(d));
}

// Адрес возврата должен ТОЧНО совпадать с тем, что записан в кабинете Spotify (включая слэш в конце)
function spRedirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, "");
}

function spFormBody(obj) {
  return Object.keys(obj).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]); }).join("&");
}

function spAuthUrl(clientId, redirect, challenge, state) {
  return SPOTIFY_AUTH_URL + "?" + spFormBody({
    response_type: "code", client_id: clientId, scope: SPOTIFY_SCOPES, redirect_uri: redirect,
    state: state, code_challenge_method: "S256", code_challenge: challenge
  });
}

// Начать вход: запоминаем verifier и state и уходим на страницу Spotify
async function spStartLogin(clientId) {
  const verifier = spRandomString(96);
  const state = spRandomString(24);
  const redirect = spRedirectUri();
  const store = spLoad();
  store.clientId = clientId;
  store.pending = { verifier: verifier, state: state, redirect: redirect, at: Date.now() };
  spSave(store);
  location.href = spAuthUrl(clientId, redirect, await spChallenge(verifier), state);
}

// Адрес после возврата: { code, state } | { error } | null
function spParseCallback(search) {
  const p = new URLSearchParams(search || "");
  if (p.get("error")) return { error: p.get("error") };
  if (p.get("code") && p.get("state")) return { code: p.get("code"), state: p.get("state") };
  return null;
}

async function spTokenRequest(fetchFn, params) {
  const res = await fetchFn(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: spFormBody(params)
  });
  let j = null;
  try { j = await res.json(); } catch (e) {}
  if (!res.ok || !j || !j.access_token) {
    return { error: (j && (j.error_description || j.error)) || ("Spotify ответил " + res.status), invalid: !!(j && j.error === "invalid_grant") };
  }
  return { json: j };
}

// Обмен кода на токены. Возвращает { store } или { error }
async function spExchange(cb, store, fetchFn, now) {
  const p = store.pending;
  if (!p || p.state !== cb.state) {
    return { error: "Вход завершился в другом окне, и приложение не нашло начатый вход. Попробуйте, пожалуйста, ещё раз" };
  }
  const r = await spTokenRequest(fetchFn, {
    grant_type: "authorization_code", code: cb.code, redirect_uri: p.redirect,
    client_id: store.clientId, code_verifier: p.verifier
  });
  if (r.error) return { error: r.error };
  return { store: { clientId: store.clientId, access: r.json.access_token, refresh: r.json.refresh_token || "", expiresAt: spNow(now) + r.json.expires_in * 1000, scope: r.json.scope || "" } };
}

async function spRefresh(store, fetchFn, now) {
  const r = await spTokenRequest(fetchFn, { grant_type: "refresh_token", refresh_token: store.refresh, client_id: store.clientId });
  if (r.error) return { error: r.error, invalid: r.invalid };
  return { store: { clientId: store.clientId, access: r.json.access_token, refresh: r.json.refresh_token || store.refresh, expiresAt: spNow(now) + r.json.expires_in * 1000, scope: r.json.scope || store.scope || "" } };
}

// Параметры запроса к API; тело (JSON) нужно только командам вроде PUT /me/player/play
function spInit(method, token, body) {
  const init = { method: method, headers: { Authorization: "Bearer " + token } };
  if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  return init;
}

// Запрос к API с обновлением токена: заранее, если истекает, и один раз после 401.
// Возвращает { status, json, store } (store мог обновиться) или { status: 401, error, store }
async function spCall(store, fetchFn, method, path, now, body) {
  const t = spNow(now);
  let st = store;
  if (!st.refresh) return { status: 401, error: "Spotify не подключён", store: st };
  if (!st.access || (st.expiresAt || 0) - 60000 < t) {
    const rr = await spRefresh(st, fetchFn, t);
    if (rr.error) return { status: 401, error: rr.error, store: st, expired: !!rr.invalid };
    st = rr.store;
  }
  let res = await fetchFn(SPOTIFY_API + path, spInit(method, st.access, body));
  if (res.status === 401) {
    const rr = await spRefresh(st, fetchFn, t);
    if (rr.error) return { status: 401, error: rr.error, store: st, expired: !!rr.invalid };
    st = rr.store;
    res = await fetchFn(SPOTIFY_API + path, spInit(method, st.access, body));
  }
  let json = null;
  if (res.status !== 204) { try { json = await res.json(); } catch (e) {} }
  return { status: res.status, json: json, store: st };
}

// Ответ GET /me/player -> то, что показываем
function spPlayerView(status, json) {
  if (status === 204 || status === 404 || !json) return { none: true };
  const it = json.item;
  return {
    playing: !!json.is_playing,
    title: it && it.name ? it.name : "",
    artist: it && it.artists ? it.artists.map(function (a) { return a.name; }).join(", ") : "",
    device: json.device && json.device.name ? json.device.name : ""
  };
}

// Понятное сообщение по коду ответа на команду (null = всё хорошо)
function spErrorText(status, json) {
  if (status >= 200 && status < 300) return null;
  const reason = json && json.error && json.error.reason;
  if (reason === "PREMIUM_REQUIRED" || status === 403) return "Для управления воспроизведением нужен Spotify Premium";
  if (reason === "NO_ACTIVE_DEVICE" || status === 404) return "Нет активного устройства: запустите музыку в приложении Spotify на телефоне и вернитесь сюда";
  if (status === 429) return "Spotify просит подождать, попробуйте через минуту";
  return "Spotify ответил " + status;
}

// ---- Выбор музыки: плейлисты и поиск ----

// Есть ли у токена нужный доступ. Токены, выданные до появления плейлистов, поля scope не имеют:
// считаем, что доступа нет, и предлагаем войти заново один раз.
function spHasScope(store, scope) {
  return (store.scope || "").split(" ").indexOf(scope) >= 0;
}

function spPlaylistsView(json) {
  return ((json && json.items) || []).filter(function (p) { return p && p.uri && p.name; })
    .map(function (p) { return { id: p.id, uri: p.uri, name: p.name, total: p.tracks && typeof p.tracks.total === "number" ? p.tracks.total : null }; });
}

function spSearchView(json) {
  return ((json && json.tracks && json.tracks.items) || []).filter(function (x) { return x && x.uri && x.name; })
    .map(function (x) { return { uri: x.uri, name: x.name, artist: (x.artists || []).map(function (a) { return a.name; }).join(", ") }; });
}

// В режиме разработки Spotify отдаёт в поиске не больше 10 результатов за раз
function spSearchPath(q) {
  return "/search?q=" + encodeURIComponent(q) + "&type=track&limit=10";
}

// Тело PUT /me/player/play: плейлист играет целиком (context_uri), трек - отдельно (uris)
function spPlayBody(kind, uri) {
  return kind === "playlist" ? { context_uri: uri } : { uris: [uri] };
}

// ---- Общий доступ к API: мини-плеер на главной и панель на вкладке БЕТА работают с одним хранилищем ----

let spQueue = Promise.resolve();

// Запросы идут по очереди, и каждый раз токены читаются заново: два компонента не обновят токен одновременно
// (при ротации refresh-токена это сломало бы вход).
function spSharedCall(method, path, body) {
  const run = spQueue.then(async function () {
    const before = spLoad();
    const r = await spCall(before, fetch, method, path, undefined, body);
    if (r.store && r.store !== before) spSave(r.store);
    if (r.status === 401 && r.expired) spSave({ clientId: before.clientId });
    return r;
  });
  spQueue = run.catch(function () {});
  return run;
}

// Общее состояние плеера. Опрос идёт, пока есть хотя бы один подписчик и приложение на экране.
const SPOTIFY_FEED = { subs: [], timer: null, view: null, msg: "" };

function spFeedNotify() {
  SPOTIFY_FEED.subs.slice().forEach(function (cb) { cb(); });
}

async function spFeedRefresh() {
  if (!SPOTIFY_FEED.subs.length) return;
  if (!spLoad().refresh) { SPOTIFY_FEED.view = null; SPOTIFY_FEED.msg = ""; spFeedNotify(); return; }
  try {
    const r = await spSharedCall("GET", "/me/player");
    if (r.status === 401) {
      SPOTIFY_FEED.view = null;
      SPOTIFY_FEED.msg = r.error || "Пожалуйста, войдите заново";
    } else {
      SPOTIFY_FEED.view = spPlayerView(r.status, r.json);
      SPOTIFY_FEED.msg = (r.status === 200 || r.status === 204) ? "" : (spErrorText(r.status, r.json) || "");
    }
  } catch (e) {
    SPOTIFY_FEED.msg = "Не получилось связаться со Spotify";
  }
  spFeedNotify();
}

function spFeedSubscribe(cb) {
  SPOTIFY_FEED.subs.push(cb);
  if (SPOTIFY_FEED.subs.length === 1) {
    spFeedRefresh();
    SPOTIFY_FEED.timer = setInterval(function () { if (document.visibilityState === "visible") spFeedRefresh(); }, SPOTIFY_POLL_MS);
  } else {
    cb();
  }
  return function () {
    SPOTIFY_FEED.subs = SPOTIFY_FEED.subs.filter(function (x) { return x !== cb; });
    if (!SPOTIFY_FEED.subs.length && SPOTIFY_FEED.timer) { clearInterval(SPOTIFY_FEED.timer); SPOTIFY_FEED.timer = null; }
  };
}

// Команда плееру (пауза, следующий трек, запуск плейлиста). Возвращает { ok, err }, ошибку видят все подписчики.
async function spCommand(method, path, body) {
  let err = null;
  try {
    const r = await spSharedCall(method, path, body);
    err = r.status === 401 ? (r.error || "Пожалуйста, войдите заново") : spErrorText(r.status, r.json);
  } catch (e) {
    err = "Не получилось связаться со Spotify";
  }
  SPOTIFY_FEED.msg = err || "";
  spFeedNotify();
  setTimeout(spFeedRefresh, 500);
  return { ok: !err, err: err };
}

// Завершение входа при загрузке страницы (после возврата со Spotify в адресе ?code=...)
const SPOTIFY_BOOT = { error: "", done: false, onDone: null };

async function spBoot() {
  try {
    const cb = spParseCallback(location.search);
    if (cb) {
      if (cb.error) {
        SPOTIFY_BOOT.error = cb.error === "access_denied" ? "Вход отменён" : "Spotify: " + cb.error;
      } else {
        const r = await spExchange(cb, spLoad(), fetch);
        if (r.error) SPOTIFY_BOOT.error = r.error; else spSave(r.store);
      }
      try { history.replaceState(null, "", spRedirectUri()); } catch (e) {}
    }
  } catch (e) {
    SPOTIFY_BOOT.error = "Не получилось завершить вход в Spotify";
  }
  SPOTIFY_BOOT.done = true;
  if (SPOTIFY_BOOT.onDone) SPOTIFY_BOOT.onDone();
  spFeedRefresh();
}
spBoot();

// После возврата со Spotify открываем вкладку БЕТА, а не тренировку
function betaInitialTab() {
  try { return /[?&](code|error)=/.test(location.search) ? "beta" : "workout"; } catch (e) { return "workout"; }
}

function SpotifyPanel(props) {
  const showToast = props.showToast;
  const [store, setStore] = useState(spLoad);
  const [clientId, setClientId] = useState(spLoad().clientId || "");
  const [bootMsg, setBootMsg] = useState(SPOTIFY_BOOT.error || "");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const connected = !!store.refresh;
  const feed = SPOTIFY_FEED;
  const player = feed.view;

  // Вход мог завершиться уже после показа панели
  useEffect(() => {
    SPOTIFY_BOOT.onDone = () => { setStore(spLoad()); setBootMsg(SPOTIFY_BOOT.error || ""); };
    if (SPOTIFY_BOOT.done) SPOTIFY_BOOT.onDone();
    return () => { SPOTIFY_BOOT.onDone = null; };
  }, []);

  // Состояние плеера общее с мини-плеером на главной: панель только подписывается на него
  useEffect(() => spFeedSubscribe(() => { setStore(spLoad()); setTick(n => n + 1); }), []);

  async function command(method, path) {
    if (busy) return;
    setBusy(true);
    await spCommand(method, path);
    setBusy(false);
  }

  function login() {
    const id = clientId.trim();
    if (id.length < 16) { showToast("Вставьте Client ID из кабинета Spotify"); return; }
    spStartLogin(id).catch(() => setBootMsg("Не получилось начать вход"));
  }

  function logout() {
    spSave({ clientId: store.clientId });
    setStore({ clientId: store.clientId });
    SPOTIFY_FEED.view = null;
    SPOTIFY_FEED.msg = "";
    spFeedNotify();
  }

  const btn = { flex: 1, minHeight: 48, padding: "12px 6px", borderRadius: 9, border: "1px solid #2a2a2a", background: "#0c0c0f", color: "#ddd", fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" };
  const uri = spRedirectUri();
  const msg = feed.msg || bootMsg;

  return (
    <BetaSection title="МУЗЫКА (SPOTIFY)">
      {!connected ? (
        <>
          <div style={{ fontSize: 11, color: "#888", lineHeight: 1.7, marginBottom: 12 }}>
            Пульт для Spotify: что играет, пауза, следующий и предыдущий трек, выбор плейлиста или трека. Нужен Spotify Premium.<br />
            1. На developer.spotify.com/dashboard создайте приложение (Web API).<br />
            2. В Redirect URIs добавьте этот адрес ровно как есть:
          </div>
          <input readOnly value={uri} onFocus={e => e.target.select()}
            style={{ width: "100%", boxSizing: "border-box", minHeight: 44, background: "#0c0c0f", border: "1px solid #2a2a2a", borderRadius: 10, padding: "10px 12px", color: "#f7a844", fontFamily: "inherit", marginBottom: 12 }} />
          <div style={{ fontSize: 11, color: "#888", lineHeight: 1.7, marginBottom: 8 }}>3. Вставьте Client ID приложения:</div>
          <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Client ID" autoCapitalize="off" autoCorrect="off" spellCheck="false"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 44, background: "#0c0c0f", border: "1px solid #2a2a2a", borderRadius: 10, padding: "10px 12px", color: "#fff", fontFamily: "inherit", marginBottom: 12 }} />
          <button onClick={login}
            style={{ width: "100%", minHeight: 48, padding: "12px 8px", borderRadius: 9, border: "1px solid #4a9a6a", background: "#4a9a6a18", color: "#7fc79a", fontSize: 10, letterSpacing: 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            ВОЙТИ В SPOTIFY
          </button>
        </>
      ) : (
        <>
          <div style={{ background: "#0c0c0f", border: "1px solid #1a1a22", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
            {player && !player.none ? (
              <>
                <div style={{ fontSize: 9, letterSpacing: 2, color: player.playing ? "#4a9a6a" : "#666", marginBottom: 6 }}>{player.playing ? "ИГРАЕТ" : "ПАУЗА"}{player.device ? "  |  " + player.device : ""}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 3 }}>{player.title || "-"}</div>
                <div style={{ fontSize: 11, color: "#888" }}>{player.artist}</div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6 }}>{player ? "Сейчас ничего не играет. Запустите музыку в приложении Spotify или выберите её ниже." : "Загрузка..."}</div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button style={btn} onClick={() => command("POST", "/me/player/previous")}>НАЗАД</button>
            <button style={{ ...btn, border: "1px solid #4a9a6a", background: "#4a9a6a18", color: "#7fc79a", fontWeight: 700 }}
              onClick={() => command("PUT", player && player.playing ? "/me/player/pause" : "/me/player/play")}>
              {player && player.playing ? "ПАУЗА" : "ИГРАТЬ"}
            </button>
            <button style={btn} onClick={() => command("POST", "/me/player/next")}>ДАЛЬШЕ</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: picker ? 12 : 0 }}>
            <button style={btn} onClick={() => setPicker(!picker)}>{picker ? "СКРЫТЬ ВЫБОР" : "ВЫБРАТЬ МУЗЫКУ"}</button>
            <a href="spotify://" style={{ ...btn, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>ОТКРЫТЬ SPOTIFY</a>
            <button style={btn} onClick={logout}>ВЫЙТИ</button>
          </div>
          {picker && <SpotifyPicker onDone={() => setPicker(false)} />}
        </>
      )}
      {msg && <div style={{ fontSize: 11, color: "#f7a844", lineHeight: 1.6, marginTop: 12 }}>{msg}</div>}
    </BetaSection>
  );
}

// Выбор музыки без собственного сервера: плейлисты пользователя и поиск треков (до 10 результатов)
function SpotifyPicker(props) {
  const [tab, setTab] = useState("playlists");
  const [lists, setLists] = useState(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState(null);
  const [msg, setMsg] = useState("");
  const canLists = spHasScope(spLoad(), "playlist-read-private");

  useEffect(() => {
    if (tab !== "playlists" || !canLists || lists !== null) return;
    let alive = true;
    spSharedCall("GET", SPOTIFY_PLAYLISTS_PATH).then(r => {
      if (!alive) return;
      if (r.status === 200) setLists(spPlaylistsView(r.json));
      else { setLists([]); setMsg(spErrorText(r.status, r.json) || "Не получилось загрузить плейлисты"); }
    }).catch(() => { if (alive) { setLists([]); setMsg("Не получилось связаться со Spotify"); } });
    return () => { alive = false; };
  }, [tab]);

  function search() {
    const text = q.trim();
    if (!text) return;
    setMsg("");
    setFound(null);
    spSharedCall("GET", spSearchPath(text)).then(r => {
      if (r.status === 200) setFound(spSearchView(r.json));
      else { setFound([]); setMsg(spErrorText(r.status, r.json) || "Не получилось выполнить поиск"); }
    }).catch(() => { setFound([]); setMsg("Не получилось связаться со Spotify"); });
  }

  async function play(kind, uri) {
    const r = await spCommand("PUT", "/me/player/play", spPlayBody(kind, uri));
    if (r.ok) props.onDone(); else setMsg(r.err);
  }

  const chip = on => ({ flex: 1, minHeight: 44, borderRadius: 9, border: "1px solid " + (on ? "#4a9a6a" : "#2a2a2a"), background: on ? "#4a9a6a18" : "#0c0c0f", color: on ? "#7fc79a" : "#999", fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" });
  const row = (key, title, sub, onPlay) => (
    <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #14141a" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "#ddd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        {sub && <div style={{ fontSize: 10, color: "#777", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
      </div>
      <button onClick={onPlay} style={{ minHeight: 44, minWidth: 80, borderRadius: 9, border: "1px solid #4a9a6a", background: "#4a9a6a18", color: "#7fc79a", fontSize: 10, letterSpacing: 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>ИГРАТЬ</button>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button style={chip(tab === "playlists")} onClick={() => setTab("playlists")}>ПЛЕЙЛИСТЫ</button>
        <button style={chip(tab === "search")} onClick={() => setTab("search")}>ПОИСК ТРЕКА</button>
      </div>
      {tab === "playlists" && (!canLists ? (
        <div>
          <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6, marginBottom: 10 }}>Чтобы показать ваши плейлисты, нужен ещё один доступ. Один раз войдите заново, это займёт несколько секунд.</div>
          <button onClick={() => spStartLogin(spLoad().clientId).catch(() => setMsg("Не получилось начать вход"))}
            style={{ width: "100%", minHeight: 48, borderRadius: 9, border: "1px solid #4a9a6a", background: "#4a9a6a18", color: "#7fc79a", fontSize: 10, letterSpacing: 1, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>ВОЙТИ ЗАНОВО</button>
        </div>
      ) : lists === null ? (
        <div style={{ fontSize: 11, color: "#888" }}>Загрузка...</div>
      ) : lists.length === 0 ? (
        <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6 }}>Плейлистов не нашлось. Создайте или сохраните плейлист в приложении Spotify.</div>
      ) : lists.map(pl => row(pl.id || pl.uri, pl.name, pl.total !== null ? pl.total + " треков" : "", () => play("playlist", pl.uri))))}
      {tab === "search" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") search(); }} placeholder="Название или исполнитель" autoCapitalize="off" autoCorrect="off"
              style={{ flex: 1, minWidth: 0, boxSizing: "border-box", minHeight: 44, background: "#0c0c0f", border: "1px solid #2a2a2a", borderRadius: 10, padding: "10px 12px", color: "#fff", fontFamily: "inherit" }} />
            <button onClick={search} style={{ minHeight: 44, minWidth: 80, borderRadius: 9, border: "1px solid #2a2a2a", background: "#0c0c0f", color: "#ddd", fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" }}>НАЙТИ</button>
          </div>
          {found === null && <div style={{ fontSize: 10, color: "#666", lineHeight: 1.6 }}>Показываются первые 10 результатов: таково ограничение Spotify для личных приложений.</div>}
          {found && found.length === 0 && !msg && <div style={{ fontSize: 11, color: "#888" }}>Ничего не нашлось. Попробуйте другое название.</div>}
          {found && found.map(x => row(x.uri, x.name, x.artist, () => play("track", x.uri)))}
        </div>
      )}
      {msg && <div style={{ fontSize: 11, color: "#f7a844", lineHeight: 1.6, marginTop: 10 }}>{msg}</div>}
    </div>
  );
}

// Мини-плеер на каждой вкладке (шов в App, только в тестовой сборке): что играет и переключение треков
function BetaMiniPlayer() {
  const [connected, setConnected] = useState(!!spLoad().refresh);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => spFeedSubscribe(() => { setConnected(!!spLoad().refresh); setTick(n => n + 1); }), []);
  if (!connected) return null;

  const v = SPOTIFY_FEED.view;
  const playing = !!(v && !v.none && v.playing);
  async function command(method, path) {
    if (busy) return;
    setBusy(true);
    await spCommand(method, path);
    setBusy(false);
  }
  const b = { flex: 1, minHeight: 44, borderRadius: 9, border: "1px solid #2a2a2a", background: "#0c0c0f", color: "#ddd", fontSize: 9, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" };

  return (
    <div style={{ background: "#0f0f12", border: "1px solid #1a1a22", borderRadius: 12, padding: "10px 12px", margin: "14px 0 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 14 }}>🎵</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "#fff", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {v && !v.none ? (v.title || "-") : "Сейчас ничего не играет"}
          </div>
          <div style={{ fontSize: 10, color: "#777", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {v && !v.none ? v.artist : "Запустите музыку в Spotify или выберите её здесь"}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={b} onClick={() => command("POST", "/me/player/previous")}>НАЗАД</button>
        <button style={{ ...b, border: "1px solid #4a9a6a", background: "#4a9a6a18", color: "#7fc79a", fontWeight: 700 }}
          onClick={() => command("PUT", playing ? "/me/player/pause" : "/me/player/play")}>{playing ? "ПАУЗА" : "ИГРАТЬ"}</button>
        <button style={b} onClick={() => command("POST", "/me/player/next")}>ДАЛЬШЕ</button>
        <button style={b} onClick={() => setOpen(!open)}>{open ? "СКРЫТЬ" : "ВЫБРАТЬ"}</button>
      </div>
      {SPOTIFY_FEED.msg && <div style={{ fontSize: 10, color: "#f7a844", lineHeight: 1.6, marginTop: 8 }}>{SPOTIFY_FEED.msg}</div>}
      {open && <div style={{ marginTop: 12 }}><SpotifyPicker onDone={() => setOpen(false)} /></div>}
    </div>
  );
}
