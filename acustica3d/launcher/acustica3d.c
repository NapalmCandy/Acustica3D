/*
 * Acustica3D.exe — abre Acustica3D como una aplicación de ventana propia en Windows.
 *
 * 1. Sirve la carpeta "web" (junto al .exe) en http://localhost:8765 (o el siguiente puerto libre),
 *    solo en 127.0.0.1: no es accesible desde otros equipos.
 * 2. Abre la app en una ventana de Microsoft Edge en modo aplicación (sin pestañas ni barra de
 *    direcciones), con un perfil propio en %LOCALAPPDATA%\Acustica3D. Si no hay Edge, usa Chrome; si
 *    tampoco, el navegador predeterminado.
 * 3. Al cerrar esa ventana, Acustica3D termina.
 *
 * 4. Actualización automática: al arrancar, cada 6 horas y al volver a la ventana (como mucho una vez
 *    cada 5 minutos: GitHub limita las consultas sin identificar) consulta la última versión publicada en
 *    GitHub (NapalmCandy/Acustica3D). Si es más nueva, la descarga en segundo plano a la carpeta
 *    "actualizacion" y la instala al cerrar Acustica3D (o al momento con «Reiniciar ahora» en la app).
 *    La app pregunta el estado en GET /api/update, pide una consulta con POST /api/update/check y
 *    reiniciar con POST /api/update/restart.
 *
 * 5. El programa se llamó antes Sala3D.exe: si se arranca con ese nombre, se copia como Acustica3D.exe,
 *    abre esa copia y se cierra; la copia borra el Sala3D.exe antiguo.
 *
 * Opción --no-browser: solo servidor, sin ventana (para pruebas).
 * Variables para pruebas: ACUSTICA3D_UPDATE_URL (otra dirección para la consulta de versiones) y
 * ACUSTICA3D_CHECK_MIN_S (segundos mínimos entre consultas pedidas desde la app; 300 por defecto).
 */
#define WIN32_LEAN_AND_MEAN
#define UNICODE
#define _UNICODE
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <winhttp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#ifndef APP_VERSION
#define APP_VERSION "0.0.0-dev"
#endif
#define UPDATE_URL L"https://api.github.com/repos/NapalmCandy/Acustica3D/releases/latest"
#define PACK_NAME "Acustica3D_win64.pack"

static wchar_t g_root[MAX_PATH];   /* ...\web */
static wchar_t g_appdir[MAX_PATH]; /* carpeta del .exe */
static wchar_t g_exe[MAX_PATH];
static SOCKET g_listen = INVALID_SOCKET;
static int g_port = 0;
static int g_no_browser = 0;
static HANDLE g_browser = NULL; /* proceso de la ventana (para «Reiniciar ahora») */

/* ── estado de la actualización (compartido entre hilos) ── */
static CRITICAL_SECTION g_lock;
static char g_upd_state[16] = "idle"; /* idle | checking | none | downloading | ready | error */
static char g_upd_latest[32] = "";
static char g_upd_msg[256] = "";
static long long g_upd_done = 0, g_upd_total = 0;
static volatile LONG g_restart = 0;
static HANDLE g_check_evt = NULL;      /* despierta al hilo de actualización */
static volatile DWORD g_last_check = 0; /* GetTickCount() de la última consulta */
static DWORD g_check_min_ms = 300000;

static void set_state(const char *st, const char *msg)
{
    EnterCriticalSection(&g_lock);
    snprintf(g_upd_state, sizeof g_upd_state, "%s", st);
    snprintf(g_upd_msg, sizeof g_upd_msg, "%s", msg ? msg : "");
    LeaveCriticalSection(&g_lock);
}

static void fail(const wchar_t *msg)
{
    MessageBoxW(NULL, msg, L"Acustica3D", MB_OK | MB_ICONERROR);
    ExitProcess(1);
}

static const char *mime_of(const char *path)
{
    const char *ext = strrchr(path, '.');
    if (!ext) return "application/octet-stream";
    if (!_stricmp(ext, ".html")) return "text/html; charset=utf-8";
    if (!_stricmp(ext, ".js")) return "text/javascript; charset=utf-8";
    if (!_stricmp(ext, ".css")) return "text/css; charset=utf-8";
    if (!_stricmp(ext, ".json")) return "application/json";
    if (!_stricmp(ext, ".svg")) return "image/svg+xml";
    if (!_stricmp(ext, ".png")) return "image/png";
    if (!_stricmp(ext, ".wasm")) return "application/wasm";
    if (!_stricmp(ext, ".txt")) return "text/plain; charset=utf-8";
    return "application/octet-stream";
}

static void send_all(SOCKET s, const char *buf, int len)
{
    while (len > 0) {
        int n = send(s, buf, len, 0);
        if (n <= 0) return;
        buf += n;
        len -= n;
    }
}

static void send_status(SOCKET s, const char *status)
{
    char hdr[256];
    int n = snprintf(hdr, sizeof hdr,
                     "HTTP/1.1 %s\r\nContent-Type: text/plain\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s",
                     status, (int)strlen(status), status);
    send_all(s, hdr, n);
}

static void send_json(SOCKET s, const char *body)
{
    char hdr[256];
    int n = snprintf(hdr, sizeof hdr,
                     "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n"
                     "Cache-Control: no-store\r\nConnection: close\r\n\r\n",
                     (int)strlen(body));
    send_all(s, hdr, n);
    send_all(s, body, (int)strlen(body));
}

/* Solo se aceptan peticiones que modifican algo desde la propia app (no desde otras webs). */
static int origin_ok(const char *req)
{
    const char *o = strstr(req, "\r\nOrigin:");
    if (!o) o = strstr(req, "\r\norigin:");
    if (!o) return 1; /* sin Origin: no es un navegador cruzando sitios */
    o += 9;
    while (*o == ' ') ++o;
    char a[64], b[64];
    snprintf(a, sizeof a, "http://localhost:%d\r", g_port);
    snprintf(b, sizeof b, "http://127.0.0.1:%d\r", g_port);
    return !strncmp(o, a, strlen(a)) || !strncmp(o, b, strlen(b));
}

static void handle_api(SOCKET s, const char *method, const char *url, const char *req)
{
    if (!strcmp(url, "/api/update") && !strcmp(method, "GET")) {
        char body[640];
        EnterCriticalSection(&g_lock);
        snprintf(body, sizeof body,
                 "{\"current\":\"%s\",\"state\":\"%s\",\"latest\":\"%s\",\"done\":%lld,\"total\":%lld,\"message\":\"%s\"}",
                 APP_VERSION, g_upd_state, g_upd_latest, g_upd_done, g_upd_total, g_upd_msg);
        LeaveCriticalSection(&g_lock);
        send_json(s, body);
        return;
    }
    if (!strcmp(url, "/api/update/check") && !strcmp(method, "POST")) {
        if (!origin_ok(req)) { send_status(s, "403 Forbidden"); return; }
        int idle;
        EnterCriticalSection(&g_lock);
        idle = !strcmp(g_upd_state, "none") || !strcmp(g_upd_state, "error");
        LeaveCriticalSection(&g_lock);
        int go = idle && GetTickCount() - g_last_check >= g_check_min_ms;
        if (go) SetEvent(g_check_evt);
        send_json(s, go ? "{\"checking\":true}" : "{\"checking\":false}");
        return;
    }
    if (!strcmp(url, "/api/update/restart") && !strcmp(method, "POST")) {
        if (!origin_ok(req)) { send_status(s, "403 Forbidden"); return; }
        int ready;
        EnterCriticalSection(&g_lock);
        ready = !strcmp(g_upd_state, "ready");
        LeaveCriticalSection(&g_lock);
        if (!ready) { send_status(s, "409 Conflict"); return; }
        send_json(s, "{\"ok\":true}");
        InterlockedExchange(&g_restart, 1);
        /* cerrar la ventana: el hilo principal instala la actualización y vuelve a abrir Acustica3D */
        if (g_browser) TerminateProcess(g_browser, 0);
        return;
    }
    send_status(s, "404 Not Found");
}

static void handle(SOCKET s)
{
    char req[4096];
    int got = recv(s, req, sizeof req - 1, 0);
    if (got <= 0) return;
    req[got] = 0;
    char method[8] = {0}, url[2048] = {0};
    if (sscanf(req, "%7s %2047s", method, url) != 2) { send_status(s, "400 Bad Request"); return; }
    if (!strncmp(url, "/api/", 5)) { handle_api(s, method, url, req); return; }
    if (strcmp(method, "GET") && strcmp(method, "HEAD")) { send_status(s, "405 Method Not Allowed"); return; }
    char *q = strpbrk(url, "?#");
    if (q) *q = 0;
    if (strstr(url, "..") || strchr(url, ':') || strchr(url, '\\')) { send_status(s, "403 Forbidden"); return; }
    char rel[2048];
    if (!strcmp(url, "/")) strcpy(rel, "index.html");
    else snprintf(rel, sizeof rel, "%s", url + 1);
    for (char *p = rel; *p; ++p) if (*p == '/') *p = '\\';
    wchar_t wrel[2048];
    if (!MultiByteToWideChar(CP_UTF8, 0, rel, -1, wrel, 2048)) { send_status(s, "400 Bad Request"); return; }
    wchar_t full[MAX_PATH * 2];
    _snwprintf(full, MAX_PATH * 2, L"%ls\\%ls", g_root, wrel);
    HANDLE f = CreateFileW(full, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (f == INVALID_HANDLE_VALUE) { send_status(s, "404 Not Found"); return; }
    LARGE_INTEGER size;
    GetFileSizeEx(f, &size);
    char hdr[512];
    int n = snprintf(hdr, sizeof hdr,
                     "HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %lld\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
                     mime_of(rel), (long long)size.QuadPart);
    send_all(s, hdr, n);
    if (!strcmp(method, "GET")) {
        static char buf[65536];
        DWORD rd;
        while (ReadFile(f, buf, sizeof buf, &rd, NULL) && rd > 0) send_all(s, buf, (int)rd);
    }
    CloseHandle(f);
}

static DWORD WINAPI server_thread(LPVOID unused)
{
    (void)unused;
    for (;;) {
        SOCKET c = accept(g_listen, NULL, NULL);
        if (c == INVALID_SOCKET) {
            if (WSAGetLastError() == WSAENOTSOCK || WSAGetLastError() == WSAEINTR) return 0; /* cerrado al salir */
            continue;
        }
        handle(c);
        shutdown(c, SD_SEND);
        closesocket(c);
    }
    return 0;
}

static int file_exists(const wchar_t *p)
{
    DWORD a = GetFileAttributesW(p);
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

/* Busca un navegador por "App Paths" del registro y por rutas habituales. */
static int find_browser(const wchar_t *exe, const wchar_t *const *fallbacks, wchar_t *out)
{
    wchar_t key[256];
    _snwprintf(key, 256, L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\%ls", exe);
    HKEY roots[2] = {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    for (int i = 0; i < 2; ++i) {
        DWORD sz = MAX_PATH * sizeof(wchar_t);
        if (RegGetValueW(roots[i], key, NULL, RRF_RT_REG_SZ, NULL, out, &sz) == ERROR_SUCCESS && file_exists(out)) return 1;
    }
    for (int i = 0; fallbacks[i]; ++i) {
        wchar_t expanded[MAX_PATH];
        ExpandEnvironmentStringsW(fallbacks[i], expanded, MAX_PATH);
        if (file_exists(expanded)) { wcscpy(out, expanded); return 1; }
    }
    return 0;
}

/* ───────────────────────── actualización ───────────────────────── */

/* GET por HTTPS (o HTTP en pruebas) con WinHTTP; sigue redirecciones. Devuelve el cuerpo en *out
 * (malloc) o, si `file` no es NULL, lo escribe en ese archivo. 0 = correcto. */
static int http_get(const wchar_t *url, char **out, size_t *out_len, HANDLE file)
{
    URL_COMPONENTS uc;
    wchar_t host[256], path[2048];
    memset(&uc, 0, sizeof uc);
    uc.dwStructSize = sizeof uc;
    uc.lpszHostName = host;
    uc.dwHostNameLength = 256;
    uc.lpszUrlPath = path;
    uc.dwUrlPathLength = 2048;
    if (!WinHttpCrackUrl(url, 0, 0, &uc)) return -1;
    HINTERNET ses = WinHttpOpen(L"Acustica3D-actualizador", 4 /* WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY */, NULL, NULL, 0);
    if (!ses) ses = WinHttpOpen(L"Acustica3D-actualizador", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, NULL, NULL, 0);
    if (!ses) return -2;
    WinHttpSetTimeouts(ses, 10000, 10000, 15000, 30000);
    int rc = -3;
    HINTERNET con = WinHttpConnect(ses, host, uc.nPort, 0);
    HINTERNET rq = con ? WinHttpOpenRequest(con, L"GET", path, NULL, NULL, NULL,
                                            uc.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0)
                       : NULL;
    if (rq && WinHttpSendRequest(rq, L"Accept: application/vnd.github+json, application/octet-stream\r\n", (DWORD)-1, NULL, 0, 0, 0) &&
        WinHttpReceiveResponse(rq, NULL)) {
        DWORD status = 0, sz = sizeof status;
        WinHttpQueryHeaders(rq, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, NULL, &status, &sz, NULL);
        if (status == 200) {
            wchar_t clen[32];
            DWORD cl = sizeof clen;
            long long total = 0;
            if (WinHttpQueryHeaders(rq, WINHTTP_QUERY_CONTENT_LENGTH, NULL, clen, &cl, NULL)) total = _wtoi64(clen);
            if (file) {
                EnterCriticalSection(&g_lock);
                g_upd_total = total;
                g_upd_done = 0;
                LeaveCriticalSection(&g_lock);
            }
            size_t cap = 65536, len = 0;
            char *buf = file ? NULL : (char *)malloc(cap);
            static char chunk[65536];
            rc = 0;
            for (;;) {
                DWORD rd = 0;
                if (!WinHttpReadData(rq, chunk, sizeof chunk, &rd)) { rc = -5; break; }
                if (!rd) break;
                if (file) {
                    DWORD wr;
                    if (!WriteFile(file, chunk, rd, &wr, NULL) || wr != rd) { rc = -6; break; }
                    EnterCriticalSection(&g_lock);
                    g_upd_done += rd;
                    LeaveCriticalSection(&g_lock);
                } else {
                    if (len + rd + 1 > cap) {
                        while (len + rd + 1 > cap) cap *= 2;
                        buf = (char *)realloc(buf, cap);
                    }
                    memcpy(buf + len, chunk, rd);
                    len += rd;
                }
            }
            if (file && total > 0 && g_upd_done != total) rc = -7;
            if (!file) {
                buf[len] = 0;
                if (rc == 0) { *out = buf; *out_len = len; } else free(buf);
            }
        } else rc = (int)status;
    }
    if (rq) WinHttpCloseHandle(rq);
    if (con) WinHttpCloseHandle(con);
    WinHttpCloseHandle(ses);
    return rc;
}

/* Valor de texto de una clave JSON a partir de `from` (sin un parser completo: la respuesta de GitHub es fija). */
static int json_str(const char *from, const char *key, char *out, size_t n, const char **after)
{
    char pat[64];
    snprintf(pat, sizeof pat, "\"%s\"", key);
    const char *p = strstr(from, pat);
    if (!p) return 0;
    p += strlen(pat);
    while (*p == ' ' || *p == ':') ++p;
    if (*p != '"') return 0;
    ++p;
    size_t i = 0;
    while (*p && *p != '"' && i + 1 < n) out[i++] = *p++;
    out[i] = 0;
    if (after) *after = p;
    return 1;
}

/* "v1.2.3" > "1.2.2" ? */
static int newer(const char *a, const char *b)
{
    int x[3] = {0}, y[3] = {0};
    sscanf(a + (*a == 'v'), "%d.%d.%d", &x[0], &x[1], &x[2]);
    sscanf(b + (*b == 'v'), "%d.%d.%d", &y[0], &y[1], &y[2]);
    for (int i = 0; i < 3; ++i)
        if (x[i] != y[i]) return x[i] > y[i];
    return 0;
}

static void delete_tree(const wchar_t *dir)
{
    wchar_t from[MAX_PATH + 2];
    memset(from, 0, sizeof from);
    wcsncpy(from, dir, MAX_PATH);
    SHFILEOPSTRUCTW op;
    memset(&op, 0, sizeof op);
    op.wFunc = FO_DELETE;
    op.pFrom = from; /* doble terminador nulo */
    op.fFlags = FOF_NO_UI;
    if (GetFileAttributesW(dir) != INVALID_FILE_ATTRIBUTES) SHFileOperationW(&op);
}

/* Paquete de actualización: "A3DPACK1", luego [u32 long. ruta][ruta UTF-8 con '/'][u64 tamaño][datos]...,
 * y al final u32 0 + "A3DEND!!". Se extrae en `dest`. 0 = correcto. */
static int extract_pack(const wchar_t *pack, const wchar_t *dest)
{
    HANDLE f = CreateFileW(pack, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (f == INVALID_HANDLE_VALUE) return -1;
    DWORD rd;
    char magic[8];
    int rc = -2;
    if (!ReadFile(f, magic, 8, &rd, NULL) || rd != 8 || memcmp(magic, "A3DPACK1", 8)) goto done;
    for (;;) {
        unsigned int plen = 0;
        if (!ReadFile(f, &plen, 4, &rd, NULL) || rd != 4) goto done;
        if (plen == 0) {
            char end[8];
            rc = (ReadFile(f, end, 8, &rd, NULL) && rd == 8 && !memcmp(end, "A3DEND!!", 8)) ? 0 : -3;
            goto done;
        }
        if (plen > 1000) goto done;
        char rel[1024];
        if (!ReadFile(f, rel, plen, &rd, NULL) || rd != plen) goto done;
        rel[plen] = 0;
        /* rutas seguras: relativas, sin "..", sin unidades ni barras invertidas */
        if (rel[0] == '/' || strstr(rel, "..") || strchr(rel, ':') || strchr(rel, '\\')) { rc = -4; goto done; }
        unsigned long long size = 0;
        if (!ReadFile(f, &size, 8, &rd, NULL) || rd != 8) goto done;
        for (char *c = rel; *c; ++c) if (*c == '/') *c = '\\';
        wchar_t wrel[1024], full[MAX_PATH * 2];
        MultiByteToWideChar(CP_UTF8, 0, rel, -1, wrel, 1024);
        _snwprintf(full, MAX_PATH * 2, L"%ls\\%ls", dest, wrel);
        wchar_t dir[MAX_PATH * 2];
        wcscpy(dir, full);
        wchar_t *sl = wcsrchr(dir, L'\\');
        if (sl) { *sl = 0; SHCreateDirectoryExW(NULL, dir, NULL); }
        HANDLE o = CreateFileW(full, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
        if (o == INVALID_HANDLE_VALUE) { rc = -5; goto done; }
        static char buf[65536];
        while (size > 0) {
            DWORD want = size > sizeof buf ? (DWORD)sizeof buf : (DWORD)size, wr;
            if (!ReadFile(f, buf, want, &rd, NULL) || rd != want || !WriteFile(o, buf, rd, &wr, NULL)) { CloseHandle(o); goto done; }
            size -= rd;
        }
        CloseHandle(o);
    }
done:
    CloseHandle(f);
    return rc;
}

static void staging_dir(wchar_t *out) { _snwprintf(out, MAX_PATH, L"%ls\\actualizacion", g_appdir); }

/* Busca, descarga y prepara la actualización. Devuelve 1 si queda lista para instalar. */
static int check_update(void)
{
    set_state("checking", "");
    g_last_check = GetTickCount();
    wchar_t api[1024];
    DWORD n = GetEnvironmentVariableW(L"ACUSTICA3D_UPDATE_URL", api, 1024);
    if (!n || n >= 1024) wcscpy(api, UPDATE_URL);
    char *json = NULL;
    size_t len = 0;
    int rc = http_get(api, &json, &len, NULL);
    if (rc) {
        char m[64];
        snprintf(m, sizeof m, rc == 404 ? "Aún no hay versiones publicadas" : "Sin conexión con GitHub (%d)", rc);
        set_state(rc == 404 ? "none" : "error", m);
        return 0;
    }
    char tag[32] = "", dl[1024] = "";
    json_str(json, "tag_name", tag, sizeof tag, NULL);
    const char *a = strstr(json, "\"name\": \"" PACK_NAME "\"");
    if (!a) a = strstr(json, "\"name\":\"" PACK_NAME "\"");
    if (a) json_str(a, "browser_download_url", dl, sizeof dl, NULL);
    free(json);
    EnterCriticalSection(&g_lock);
    snprintf(g_upd_latest, sizeof g_upd_latest, "%s", tag + (tag[0] == 'v'));
    LeaveCriticalSection(&g_lock);
    if (!tag[0] || !newer(tag, APP_VERSION)) { set_state("none", "Tienes la última versión"); return 0; }
    if (!dl[0]) { set_state("error", "La versión nueva no tiene paquete de actualización"); return 0; }

    set_state("downloading", "");
    wchar_t stage[MAX_PATH], pack[MAX_PATH], wdl[1024];
    staging_dir(stage);
    delete_tree(stage);
    SHCreateDirectoryExW(NULL, stage, NULL);
    _snwprintf(pack, MAX_PATH, L"%ls\\paquete.pack", stage);
    MultiByteToWideChar(CP_UTF8, 0, dl, -1, wdl, 1024);
    HANDLE f = CreateFileW(pack, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (f == INVALID_HANDLE_VALUE) { set_state("error", "No puedo escribir en la carpeta de Acustica3D"); return 0; }
    rc = http_get(wdl, NULL, NULL, f);
    CloseHandle(f);
    if (rc) { set_state("error", "Descarga incompleta"); delete_tree(stage); return 0; }
    wchar_t files[MAX_PATH];
    _snwprintf(files, MAX_PATH, L"%ls\\nuevo", stage);
    if (extract_pack(pack, files)) { set_state("error", "Paquete dañado"); delete_tree(stage); return 0; }
    wchar_t probe1[MAX_PATH], probe2[MAX_PATH];
    _snwprintf(probe1, MAX_PATH, L"%ls\\Acustica3D.exe", files);
    _snwprintf(probe2, MAX_PATH, L"%ls\\web\\index.html", files);
    if (!file_exists(probe1) || !file_exists(probe2)) { set_state("error", "Paquete incompleto"); delete_tree(stage); return 0; }
    DeleteFileW(pack);
    set_state("ready", "Se instalará al cerrar Acustica3D");
    return 1;
}

static DWORD WINAPI update_thread(LPVOID unused)
{
    (void)unused;
    for (;;) {
        if (check_update()) return 0;
        WaitForSingleObject(g_check_evt, 6 * 3600 * 1000); /* 6 horas, o antes si la app lo pide */
    }
}

/* Sustituye el .exe y la carpeta web por los de "actualizacion\nuevo". El .exe en marcha no se puede
 * borrar, pero sí renombrar: queda como Acustica3D.exe.old y se borra en el siguiente arranque. */
static int apply_update(void)
{
    wchar_t stage[MAX_PATH], nuevo[MAX_PATH], from[MAX_PATH * 2], to[MAX_PATH * 2], old[MAX_PATH * 2];
    staging_dir(stage);
    _snwprintf(nuevo, MAX_PATH, L"%ls\\nuevo", stage);
    WIN32_FIND_DATAW fd;
    wchar_t pat[MAX_PATH * 2];
    _snwprintf(pat, MAX_PATH * 2, L"%ls\\*", nuevo);
    HANDLE h = FindFirstFileW(pat, &fd);
    if (h == INVALID_HANDLE_VALUE) return 0;
    int ok = 1;
    do {
        if (!wcscmp(fd.cFileName, L".") || !wcscmp(fd.cFileName, L"..")) continue;
        _snwprintf(from, MAX_PATH * 2, L"%ls\\%ls", nuevo, fd.cFileName);
        _snwprintf(to, MAX_PATH * 2, L"%ls\\%ls", g_appdir, fd.cFileName);
        _snwprintf(old, MAX_PATH * 2, L"%ls.old", to);
        delete_tree(old);
        DeleteFileW(old);
        int had = GetFileAttributesW(to) != INVALID_FILE_ATTRIBUTES;
        if (had && !MoveFileExW(to, old, MOVEFILE_REPLACE_EXISTING)) { ok = 0; continue; }
        if (!MoveFileExW(from, to, MOVEFILE_REPLACE_EXISTING)) {
            if (had) MoveFileExW(old, to, 0); /* deshacer */
            ok = 0;
            continue;
        }
        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) delete_tree(old);
        else DeleteFileW(old); /* falla con el .exe en marcha: se borra en el próximo arranque */
    } while (FindNextFileW(h, &fd));
    FindClose(h);
    if (ok) delete_tree(stage);
    return ok;
}

/* Restos de una actualización anterior (y del nombre antiguo, Sala3D.exe). */
static void cleanup_old(void)
{
    wchar_t p[MAX_PATH * 2];
    _snwprintf(p, MAX_PATH * 2, L"%ls.old", g_exe);
    DeleteFileW(p);
    _snwprintf(p, MAX_PATH * 2, L"%ls\\Sala3D.exe.old", g_appdir);
    DeleteFileW(p);
    _snwprintf(p, MAX_PATH * 2, L"%ls\\Sala3D.exe", g_appdir);
    if (_wcsicmp(p, g_exe)) /* el antiguo puede estar terminando de cerrarse: se reintenta un poco */
        for (int i = 0; i < 15 && GetFileAttributesW(p) != INVALID_FILE_ATTRIBUTES && !DeleteFileW(p); ++i) Sleep(200);
    _snwprintf(p, MAX_PATH * 2, L"%ls\\web.old", g_appdir);
    delete_tree(p);
}

/* Al salir: si hay actualización lista, se instala; con «Reiniciar ahora», se vuelve a abrir. */
static int finish(int code)
{
    int ready;
    EnterCriticalSection(&g_lock);
    ready = !strcmp(g_upd_state, "ready");
    LeaveCriticalSection(&g_lock);
    if (ready) {
        closesocket(g_listen); /* deja de servir la carpeta web antes de cambiarla */
        Sleep(200);
        if (apply_update() && g_restart) {
            wchar_t cmd[MAX_PATH + 32];
            _snwprintf(cmd, MAX_PATH + 32, L"\"%ls\"%ls", g_exe, g_no_browser ? L" --no-browser" : L"");
            STARTUPINFOW si;
            PROCESS_INFORMATION pi;
            memset(&si, 0, sizeof si);
            si.cb = sizeof si;
            if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, g_appdir, &si, &pi)) {
                CloseHandle(pi.hProcess);
                CloseHandle(pi.hThread);
            }
        }
    }
    return code;
}

int main(int argc, char **argv)
{
    int no_browser = argc > 1 && !strcmp(argv[1], "--no-browser");
    g_no_browser = no_browser;
    InitializeCriticalSection(&g_lock);

    GetModuleFileNameW(NULL, g_exe, MAX_PATH);
    wcscpy(g_appdir, g_exe);
    wchar_t *slash = wcsrchr(g_appdir, L'\\');
    if (slash) *slash = 0;
    _snwprintf(g_root, MAX_PATH, L"%ls\\web", g_appdir);

    /* nombre antiguo: pasar a Acustica3D.exe */
    const wchar_t *base = wcsrchr(g_exe, L'\\');
    base = base ? base + 1 : g_exe;
    if (!_wcsicmp(base, L"Sala3D.exe")) {
        wchar_t nuevo[MAX_PATH], cmd[MAX_PATH + 32];
        _snwprintf(nuevo, MAX_PATH, L"%ls\\Acustica3D.exe", g_appdir);
        _snwprintf(cmd, MAX_PATH + 32, L"\"%ls\"%ls", nuevo, no_browser ? L" --no-browser" : L"");
        STARTUPINFOW si;
        PROCESS_INFORMATION pi;
        memset(&si, 0, sizeof si);
        si.cb = sizeof si;
        if (CopyFileW(g_exe, nuevo, FALSE) && CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, g_appdir, &si, &pi)) {
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);
            return 0;
        }
    }
    cleanup_old();
    wchar_t probe[MAX_PATH * 2];
    _snwprintf(probe, MAX_PATH * 2, L"%ls\\index.html", g_root);
    if (!file_exists(probe))
        fail(L"No encuentro la carpeta \"web\" junto a Acustica3D.exe.\n\n"
             L"Descomprime el zip completo y abre Acustica3D.exe desde esa carpeta.");

    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
    g_listen = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    int port = 8765, bound = 0;
    for (int tries = 0; tries < 20 && !bound; ++tries, ++port) {
        addr.sin_port = htons((u_short)port);
        if (bind(g_listen, (struct sockaddr *)&addr, sizeof addr) == 0) bound = 1;
    }
    if (!bound) fail(L"No hay ningún puerto libre entre 8765 y 8784.");
    --port;
    g_port = port;
    listen(g_listen, 64);
    g_check_evt = CreateEventW(NULL, FALSE, FALSE, NULL);
    wchar_t minbuf[16];
    if (GetEnvironmentVariableW(L"ACUSTICA3D_CHECK_MIN_S", minbuf, 16)) g_check_min_ms = (DWORD)_wtoi(minbuf) * 1000;
    CreateThread(NULL, 0, update_thread, NULL, 0, NULL);

    if (no_browser) {
        /* modo de pruebas: sirve hasta que se pida reiniciar para actualizar */
        CreateThread(NULL, 0, server_thread, NULL, 0, NULL);
        while (!g_restart) Sleep(100);
        return finish(0);
    }
    CreateThread(NULL, 0, server_thread, NULL, 0, NULL);

    wchar_t url[64];
    _snwprintf(url, 64, L"http://localhost:%d/", port);

    static const wchar_t *const edge_paths[] = {
        L"%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe",
        L"%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe",
        L"%LOCALAPPDATA%\\Microsoft\\Edge\\Application\\msedge.exe", NULL};
    static const wchar_t *const chrome_paths[] = {
        L"%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
        L"%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
        L"%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe", NULL};
    wchar_t browser[MAX_PATH];
    int found = find_browser(L"msedge.exe", edge_paths, browser) || find_browser(L"chrome.exe", chrome_paths, browser);

    if (found) {
        // perfil propio: ventana independiente de tu navegador y se puede esperar a que se cierre
        wchar_t profile[MAX_PATH];
        ExpandEnvironmentStringsW(L"%LOCALAPPDATA%\\Acustica3D\\perfil_ventana", profile, MAX_PATH);
        SHCreateDirectoryExW(NULL, profile, NULL);
        wchar_t cmd[2048];
        _snwprintf(cmd, 2048,
                   L"\"%ls\" --app=%ls --user-data-dir=\"%ls\" --no-first-run --no-default-browser-check "
                   L"--disable-extensions --disable-sync --window-size=1600,1000",
                   browser, url, profile);
        STARTUPINFOW si;
        PROCESS_INFORMATION pi;
        memset(&si, 0, sizeof si);
        si.cb = sizeof si;
        if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
            DWORD t0 = GetTickCount();
            g_browser = pi.hProcess;
            WaitForSingleObject(pi.hProcess, INFINITE);
            g_browser = NULL;
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);
            if (GetTickCount() - t0 > 4000 || g_restart) return finish(0); // ventana cerrada: fin
            // el proceso pasó la ventana a otra instancia: no podemos saber cuándo se cierra
            MessageBoxW(NULL, L"Acustica3D está abierta.\n\nPulsa Aceptar cuando quieras cerrarla.", L"Acustica3D",
                        MB_OK | MB_ICONINFORMATION);
            return finish(0);
        }
    }
    ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
    MessageBoxW(NULL,
                L"Acustica3D se ha abierto en tu navegador (no he encontrado Edge ni Chrome para abrirla en su propia "
                L"ventana).\n\nPulsa Aceptar cuando quieras cerrarla.",
                L"Acustica3D", MB_OK | MB_ICONINFORMATION);
    return finish(0);
}
