import http from "node:http";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3001);
const PUBLIC_DIR = path.join(__dirname, "public");
const MAIN_APP_URL = trimTrailingSlash(process.env.MAIN_APP_URL || "https://soondaeng-live.onrender.com");
const MAIN_APP_TIMEOUT_MS = Number(process.env.MAIN_APP_TIMEOUT_MS || 90000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/healthz") {
      sendJson(res, 200, { ok: true, service: "soondaeng-admin" });
      return;
    }

    if (requestUrl.pathname.startsWith("/api/admin")) {
      await proxyAdminApi(req, res, requestUrl);
      return;
    }

    await serveStatic(res, requestUrl);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "SERVER_ERROR", message: "관리자 사이트 오류가 발생했습니다." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Soondaeng Admin running at http://localhost:${PORT}`);
  console.log(`Main app API: ${MAIN_APP_URL}`);
});

async function proxyAdminApi(req, res, requestUrl) {
  if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(req.method || "GET")) {
    sendJson(res, 405, { error: "METHOD_NOT_ALLOWED", message: "지원하지 않는 요청입니다." });
    return;
  }

  if (!isAllowedAdminPath(requestUrl.pathname)) {
    sendJson(res, 404, { error: "NOT_FOUND", message: "관리자 API를 찾을 수 없습니다." });
    return;
  }

  const target = new URL(`${MAIN_APP_URL}${requestUrl.pathname}${requestUrl.search}`);
  const headers = { Accept: "application/json" };
  const adminSecret = req.headers["x-admin-secret"];
  if (Array.isArray(adminSecret)) headers["X-Admin-Secret"] = adminSecret[0] || "";
  if (typeof adminSecret === "string") headers["X-Admin-Secret"] = adminSecret;

  const requestBody = ["POST", "PATCH", "PUT"].includes(req.method || "GET") ? await readRequestBody(req) : undefined;
  if (requestBody !== undefined) headers["Content-Type"] = req.headers["content-type"] || "application/json";

  let response;
  let timeout = null;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), MAIN_APP_TIMEOUT_MS);
    response = await fetch(target, {
      method: req.method,
      headers,
      body: requestBody,
      signal: controller.signal
    });
  } catch (error) {
    console.error("Main app proxy failed:", error);
    sendJson(res, 502, {
      error: error.name === "AbortError" ? "MAIN_APP_TIMEOUT" : "MAIN_APP_UNREACHABLE",
      message: error.name === "AbortError"
        ? "본사이트 서버 응답이 지연되고 있습니다. Render 무료 서버가 깨어나는 중일 수 있으니 30초 뒤 다시 시도해 주세요."
        : `본사이트에 연결하지 못했습니다. 관리자사이트 Render의 MAIN_APP_URL 값을 확인해 주세요. 현재 대상: ${MAIN_APP_URL}`
    });
    return;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const responseBody = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, {
    "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
    "Content-Length": responseBody.length,
    "Cache-Control": "no-store"
  });
  res.end(responseBody);
}

function isAllowedAdminPath(pathname) {
  if (pathname === "/api/admin/overview") return true;
  if (pathname === "/api/admin/backup") return true;
  if (pathname === "/api/admin/track-all") return true;
  if (pathname === "/api/admin/reports/latest") return true;
  if (pathname === "/api/admin/reports/export") return true;
  if (pathname === "/api/admin/reports/send") return true;
  if (pathname === "/api/admin/notices") return true;
  if (/^\/api\/admin\/notices\/[^/]+$/.test(pathname)) return true;
  if (/^\/api\/admin\/users\/[^/]+\/settings$/.test(pathname)) return true;
  if (/^\/api\/admin\/users\/[^/]+\/(?:force-delete|permanent-delete)$/.test(pathname)) return true;
  return false;
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveStatic(res, requestUrl) {
  const rawPath = decodeURIComponent(requestUrl.pathname);
  const cleanPath = rawPath === "/" ? "/index.html" : rawPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, cleanPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const ext = path.extname(filePath).toLowerCase();
    const body = readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
    });
    res.end(body);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function loadEnvFile(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const equalIndex = trimmed.indexOf("=");
      if (equalIndex === -1) return;
      const key = trimmed.slice(0, equalIndex).trim();
      let value = trimmed.slice(equalIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
  } catch {
    // .env is optional in hosted environments.
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}
