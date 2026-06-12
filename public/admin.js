const state = {
  secret: localStorage.getItem("soondaeng_admin_secret") || "",
  overview: null,
  busy: false
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
  if (state.secret) loadOverview();
}

function bindEvents() {
  el.secretForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.secret = el.secretInput.value.trim();
    localStorage.setItem("soondaeng_admin_secret", state.secret);
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

async function loadOverview() {
  if (!state.secret) {
    toast("ADMIN_SECRET을 입력해 주세요.");
    return;
  }
  setBusy(true);
  try {
    state.overview = await adminApi("/api/admin/overview");
    render();
    toast("관리자 데이터가 갱신되었습니다.");
  } catch (error) {
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
        <button class="primary" type="button" data-user-id="${esc(user.id)}" data-user-action="approved"><svg><use href="#check"></use></svg><span>승인</span></button>
        <button class="danger" type="button" data-user-id="${esc(user.id)}" data-user-action="rejected"><svg><use href="#close"></use></svg><span>거절</span></button>
        <button class="ghost" type="button" data-user-id="${esc(user.id)}" data-user-action="pending">대기</button>
      </div>
    </article>
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
  const init = {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "X-Admin-Secret": state.secret
    }
  };
  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, init);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(body?.message || body?.error || "관리자 요청 중 오류가 발생했습니다.");
  }
  return body;
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
  }, 2600);
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
