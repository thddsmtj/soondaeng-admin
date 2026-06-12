const state = {
  secret: localStorage.getItem("soondaeng_admin_secret") || "",
  overview: null,
  busy: false,
  connected: false
};

const el = {
  secretForm: document.getElementById("secretForm"),
  secretInput: document.getElementById("secretInput"),
  refreshButton: document.getElementById("refreshButton"),
  trackAllButton: document.getElementById("trackAllButton"),
  downloadReportButton: document.getElementById("downloadReportButton"),
  sendReportButton: document.getElementById("sendReportButton"),
  userList: document.getElementById("userList"),
  productList: document.getElementById("productList"),
  kpiUsers: document.getElementById("kpiUsers"),
  kpiPending: document.getElementById("kpiPending"),
  kpiProducts: document.getElementById("kpiProducts"),
  kpiKeywords: document.getElementById("kpiKeywords"),
  kpiChecked: document.getElementById("kpiChecked"),
  toast: document.getElementById("toast")
};

init();

function init() {
  el.secretInput.value = state.secret;
  bindEvents();
  ensureConnectionMessage();
  renderConnectionState();
  if (state.secret) loadOverview({ auto: true });
}

function bindEvents() {
  el.secretForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.secret = el.secretInput.value.trim();
    loadOverview();
  });
  el.refreshButton.addEventListener("click", loadOverview);
  el.trackAllButton.addEventListener("click", trackAll);
  el.downloadReportButton.addEventListener("click", downloadReport);
  el.sendReportButton.addEventListener("click", sendReport);
  el.userList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-user-action]");
    if (!button) return;
    await updateUserApproval(button.dataset.userId, button.dataset.userAction);
  });
}

async function loadOverview(options = {}) {
  if (!state.secret) {
    state.connected = false;
    renderConnectionState("ADMIN_SECRET을 입력해 주세요.");
    return;
  }
  const wasConnected = state.connected;
  setBusy(true);
  renderConnectionState(options.auto ? "저장된 비밀키로 연결 확인 중입니다." : "관리자 비밀키를 확인하고 있습니다.");
  try {
    state.overview = await adminApi("/api/admin/overview", { retries: 3, timeoutMs: 65000 });
    state.connected = true;
    localStorage.setItem("soondaeng_admin_secret", state.secret);
    render();
    renderConnectionState();
    toast("관리자 화면에 연결됐습니다.");
  } catch (error) {
    const secretError = /ADMIN_SECRET|비밀키|일치하지|맞지/.test(error.message);
    state.connected = wasConnected && !secretError;
    if (secretError) {
      localStorage.removeItem("soondaeng_admin_secret");
    }
    renderConnectionState(error.message);
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

function render() {
  const overview = state.overview || {};
  const summary = overview.summary || {};
  const users = overview.users || [];
  const products = overview.products || [];
  const pendingCount = users.filter((user) => approvalStatus(user) === "pending").length;

  el.kpiUsers.textContent = summary.userCount || users.length || 0;
  el.kpiPending.textContent = pendingCount;
  el.kpiProducts.textContent = summary.productCount || products.length || 0;
  el.kpiKeywords.textContent = summary.keywordCount || 0;
  el.kpiChecked.textContent = summary.lastCheckedAt ? formatTime(summary.lastCheckedAt) : "-";

  el.userList.innerHTML = users.length ? users.map(renderUser).join("") : emptyBlock("회원이 없습니다.");
  el.productList.innerHTML = products.length ? products.map(renderProduct).join("") : emptyBlock("등록된 상품이 없습니다.");
}

function renderUser(user) {
  const status = approvalStatus(user);
  const badge = {
    pending: "승인대기",
    approved: "승인완료",
    rejected: "거절"
  }[status] || status;
  const actions = userActions(user, status);
  return `
    <article class="user-row ${esc(status)}">
      <div>
        <strong>${esc(user.email || "-")}</strong>
        <span>${esc(user.phone || "")} · ${esc(user.storeName || "스토어명 없음")}</span>
      </div>
      <div class="user-meta">
        <span class="status ${esc(status)}">${esc(badge)}</span>
        <small>상품 ${user.productCount || 0} · 키워드 ${user.keywordCount || 0}</small>
      </div>
      <div class="row-actions">
        ${actions}
      </div>
    </article>
  `;
}

function userActions(user, status) {
  const id = esc(user.id);
  if (status === "approved") {
    return `
      <button class="danger" type="button" data-user-id="${id}" data-user-action="rejected"><svg><use href="#close"></use></svg><span>거절</span></button>
      <button class="ghost" type="button" data-user-id="${id}" data-user-action="pending">대기로 변경</button>
    `;
  }
  if (status === "rejected") {
    return `
      <button class="primary" type="button" data-user-id="${id}" data-user-action="approved"><svg><use href="#check"></use></svg><span>승인</span></button>
      <button class="ghost" type="button" data-user-id="${id}" data-user-action="pending">대기로 변경</button>
    `;
  }
  return `
    <button class="primary" type="button" data-user-id="${id}" data-user-action="approved"><svg><use href="#check"></use></svg><span>승인</span></button>
    <button class="danger" type="button" data-user-id="${id}" data-user-action="rejected"><svg><use href="#close"></use></svg><span>거절</span></button>
  `;
}

function renderProduct(product) {
  return `
    <article class="product-row">
      <div>
        <strong>${esc(product.name || "상품 확인중")}</strong>
        <span>${esc(product.userEmail || "")} · ${esc(product.store || product.userStoreName || "")}</span>
        <a href="${esc(product.url || "")}" target="_blank" rel="noreferrer">${esc(product.url || "")}</a>
      </div>
      <div class="keyword-stack">
        ${(product.keywords || []).map((keyword) => `
          <span>${esc(keyword.term)} · ${keyword.rank ? `${keyword.rank}위` : "50위 밖"} · 기준 ${(keyword.alertRanks || [10]).join(", ")} · 하락 ${keyword.dropThreshold || 15}</span>
        `).join("")}
      </div>
    </article>
  `;
}

async function updateUserApproval(userId, status) {
  const user = (state.overview?.users || []).find((item) => item.id === userId);
  if (!user) return;
  setBusy(true);
  try {
    await adminApi(`/api/admin/users/${encodeURIComponent(userId)}/settings`, {
      method: "POST",
      body: {
        productLimit: user.productLimit || 100,
        suspended: Boolean(user.restrictions?.suspended),
        productCreateBlocked: Boolean(user.restrictions?.productCreateBlocked),
        manualTrackBlocked: Boolean(user.restrictions?.manualTrackBlocked),
        reason: user.restrictions?.reason || "",
        approvalStatus: status
      }
    });
    await loadOverview();
    toast(status === "approved" ? "승인했습니다." : status === "rejected" ? "거절했습니다." : "대기 상태로 변경했습니다.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

async function trackAll() {
  setBusy(true);
  try {
    await adminApi("/api/admin/track-all", { method: "POST" });
    await loadOverview();
    toast("전체 순위 조회를 실행했습니다.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

function downloadReport() {
  if (!state.secret) {
    toast("ADMIN_SECRET을 입력해 주세요.");
    return;
  }
  window.location.href = `/api/admin/reports/export?admin_secret=${encodeURIComponent(state.secret)}`;
}

async function sendReport() {
  setBusy(true);
  try {
    const result = await adminApi("/api/admin/reports/send", { method: "POST" });
    toast(result.report?.email?.status === "sent" ? "리포트 이메일을 발송했습니다." : result.report?.email?.message || "리포트 기록을 생성했습니다.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

async function adminApi(path, options = {}) {
  const method = options.method || "GET";
  const init = {
    method,
    headers: {
      Accept: "application/json",
      "X-Admin-Secret": state.secret
    }
  };
  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const retries = Number.isInteger(options.retries) ? options.retries : (method === "GET" ? 2 : 0);
  const timeoutMs = options.timeoutMs || 45000;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      response = await fetchWithTimeout(path, init, timeoutMs);
    } catch {
      if (attempt < retries) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      throw new Error("본사이트 서버 연결이 잠시 불안정합니다. Render 배포 또는 절전 해제 중일 수 있으니 20~30초 뒤 다시 시도해 주세요.");
    }

    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json().catch(() => ({})) : await response.text().catch(() => "");
    if (response.ok) return body;
    if (isRetryableStatus(response.status) && attempt < retries) {
      await sleep(800 * (attempt + 1));
      continue;
    }
    throw new Error(readableAdminError(response, body));
  }

  throw new Error("관리자 요청 중 오류가 발생했습니다.");
}

function readableAdminError(response, body) {
  const rawMessage = typeof body === "string" ? body : body?.message || body?.error || "";
  const message = String(rawMessage || "").trim();
  if (response.status === 401) return message || "ADMIN_SECRET이 맞지 않습니다. Render 본사이트 환경변수와 같은 값을 입력해 주세요.";
  if (response.status === 404 || /not\s*found/i.test(message)) {
    return "관리자 API 경로를 찾지 못했습니다. 본사이트 배포가 끝났는지 확인한 뒤 Ctrl+F5로 새로고침해 주세요.";
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return message || "본사이트 서버가 잠시 깨어나는 중입니다. 20~30초 뒤 다시 눌러 주세요.";
  }
  return message || `관리자 요청 중 오류가 발생했습니다. (${response.status})`;
}

function renderConnectionState(message = "") {
  document.body.classList.toggle("admin-locked", !state.connected);
  document.body.classList.toggle("admin-connected", state.connected);
  const connectionMessage = ensureConnectionMessage();
  connectionMessage.textContent = message || (state.connected ? "" : "관리자 비밀키를 입력하면 화면이 열립니다.");
  connectionMessage.hidden = state.connected && !message;
}

function ensureConnectionMessage() {
  let message = document.getElementById("connectionMessage");
  if (!message) {
    message = document.createElement("p");
    message.id = "connectionMessage";
    message.className = "connection-message";
    el.secretForm.appendChild(message);
  }
  return message;
}

async function fetchWithTimeout(path, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function approvalStatus(user) {
  return user.approvalStatus || "approved";
}

function emptyBlock(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

function setBusy(value) {
  state.busy = Boolean(value);
  document.querySelectorAll("button, input").forEach((item) => {
    item.disabled = state.busy;
  });
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.toast.hidden = true;
  }, 5600);
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(new Date(timestamp));
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
