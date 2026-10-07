// ==== SPOTIFY-ПУЛЬТ (тестовая версия) ====
// Музыку играет приложение Spotify на телефоне (встроенный плеер Spotify в Safari на iPhone
// не работает), а здесь - пульт: что играет, пауза, следующий и предыдущий трек.
// Вход - Authorization Code + PKCE: секретов нет, нужен только Client ID вашего приложения из
// developer.spotify.com/dashboard. Управление воспроизведением требует Spotify Premium и
// активного устройства (приложение Spotify, в котором недавно играла музыка).
//
// Токены лежат под ОТДЕЛЬНЫМ ключом, а не в data: иначе они попали бы в файл резервной копии.

const SPOTIFY_STORAGE_KEY = "ppl_spotify_beta";
const SPOTIFY_SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing";
const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_POLL_MS = 5000;

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
    return { error: "Вход завершился в другом окне и не нашёл начатый вход. Попробуйте ещё раз" };
  }
  const r = await spTokenRequest(fetchFn, {
    grant_type: "authorization_code", code: cb.code, redirect_uri: p.redirect,
    client_id: store.clientId, code_verifier: p.verifier
  });
  if (r.error) return { error: r.error };
  return { store: { clientId: store.clientId, access: r.json.access_token, refresh: r.json.refresh_token || "", expiresAt: spNow(now) + r.json.expires_in * 1000 } };
}

async function spRefresh(store, fetchFn, now) {
  const r = await spTokenRequest(fetchFn, { grant_type: "refresh_token", refresh_token: store.refresh, client_id: store.clientId });
  if (r.error) return { error: r.error, invalid: r.invalid };
  return { store: { clientId: store.clientId, access: r.json.access_token, refresh: r.json.refresh_token || store.refresh, expiresAt: spNow(now) + r.json.expires_in * 1000 } };
}

// Запрос к API с обновлением токена: заранее, если истекает, и один раз после 401.
// Возвращает { status, json, store } (store мог обновиться) или { status: 401, error, store }
async function spCall(store, fetchFn, method, path, now) {
  const t = spNow(now);
  let st = store;
  if (!st.refresh) return { status: 401, error: "Spotify не подключён", store: st };
  if (!st.access || (st.expiresAt || 0) - 60000 < t) {
    const rr = await spRefresh(st, fetchFn, t);
    if (rr.error) return { status: 401, error: rr.error, store: st, expired: !!rr.invalid };
    st = rr.store;
  }
  let res = await fetchFn(SPOTIFY_API + path, { method: method, headers: { Authorization: "Bearer " + st.access } });
  if (res.status === 401) {
    const rr = await spRefresh(st, fetchFn, t);
    if (rr.error) return { status: 401, error: rr.error, store: st, expired: !!rr.invalid };
    st = rr.store;
    res = await fetchFn(SPOTIFY_API + path, { method: method, headers: { Authorization: "Bearer " + st.access } });
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
  if (reason === "PREMIUM_REQUIRED" || status === 403) return "Управление воспроизведением требует Spotify Premium";
  if (reason === "NO_ACTIVE_DEVICE" || status === 404) return "Нет активного устройства: запустите музыку в приложении Spotify на телефоне и вернитесь сюда";
  if (status === 429) return "Spotify просит подождать, попробуйте через минуту";
  return "Spotify ответил " + status;
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
    SPOTIFY_BOOT.error = "Не удалось завершить вход в Spotify";
  }
  SPOTIFY_BOOT.done = true;
  if (SPOTIFY_BOOT.onDone) SPOTIFY_BOOT.onDone();
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
  const [player, setPlayer] = useState(null);
  const [msg, setMsg] = useState(SPOTIFY_BOOT.error || "");
  const [busy, setBusy] = useState(false);
  const storeRef = useRef(store);
  storeRef.current = store;
  const connected = !!store.refresh;

  // Вход мог завершиться уже после показа панели
  useEffect(() => {
    SPOTIFY_BOOT.onDone = () => { setStore(spLoad()); setMsg(SPOTIFY_BOOT.error || ""); };
    if (SPOTIFY_BOOT.done) SPOTIFY_BOOT.onDone();
    return () => { SPOTIFY_BOOT.onDone = null; };
  }, []);

  async function call(method, path) {
    const r = await spCall(storeRef.current, fetch, method, path);
    if (r.store && r.store !== storeRef.current) { spSave(r.store); setStore(r.store); }
    if (r.status === 401) {
      if (r.expired) { spSave({ clientId: storeRef.current.clientId }); setStore({ clientId: storeRef.current.clientId }); }
      setMsg(r.error || "Нужно войти заново");
    }
    return r;
  }

  async function refreshPlayer() {
    try {
      const r = await call("GET", "/me/player");
      if (r.status === 401) return;
      setPlayer(spPlayerView(r.status, r.json));
      setMsg(r.status === 200 || r.status === 204 ? "" : (spErrorText(r.status, r.json) || ""));
    } catch (e) {
      setMsg("Нет связи со Spotify");
    }
  }

  // Опрос раз в 5 секунд, пока панель открыта и приложение на экране
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    refreshPlayer();
    const id = setInterval(() => { if (alive && document.visibilityState === "visible") refreshPlayer(); }, SPOTIFY_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [connected]);

  async function command(method, path) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await call(method, path);
      const err = r.status === 401 ? null : spErrorText(r.status, r.json);
      if (err) setMsg(err); else setMsg("");
      setTimeout(refreshPlayer, 500);
    } catch (e) {
      setMsg("Нет связи со Spotify");
    }
    setBusy(false);
  }

  function login() {
    const id = clientId.trim();
    if (id.length < 16) { showToast("Вставьте Client ID из кабинета Spotify"); return; }
    spStartLogin(id).catch(() => setMsg("Не удалось начать вход"));
  }

  function logout() {
    spSave({ clientId: store.clientId });
    setStore({ clientId: store.clientId });
    setPlayer(null);
    setMsg("");
  }

  const btn = { flex: 1, minHeight: 48, padding: "12px 6px", borderRadius: 9, border: "1px solid #2a2a2a", background: "#0c0c0f", color: "#ddd", fontSize: 10, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit" };
  const uri = spRedirectUri();

  return (
    <BetaSection title="МУЗЫКА (SPOTIFY)">
      {!connected ? (
        <>
          <div style={{ fontSize: 11, color: "#888", lineHeight: 1.7, marginBottom: 12 }}>
            Пульт для Spotify: что играет, пауза, следующий и предыдущий трек. Нужен Spotify Premium.<br />
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
              <div style={{ fontSize: 11, color: "#888", lineHeight: 1.6 }}>{player ? "Сейчас ничего не играет. Запустите музыку в приложении Spotify." : "Загружаю..."}</div>
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
          <div style={{ display: "flex", gap: 8 }}>
            <a href="spotify://" style={{ ...btn, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>ОТКРЫТЬ SPOTIFY</a>
            <button style={btn} onClick={logout}>ВЫЙТИ</button>
          </div>
        </>
      )}
      {msg && <div style={{ fontSize: 11, color: "#f7a844", lineHeight: 1.6, marginTop: 12 }}>{msg}</div>}
    </BetaSection>
  );
}
