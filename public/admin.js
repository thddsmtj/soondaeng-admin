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
  logoutButton: document.getElementById("logoutButton"),
  userList: document.getElementById("userList"),
  productList: document.getElementById("productList"),
  apiUsagePanel: document.getElementById("apiUsagePanel"),
  noticeForm: document.getElementById("noticeForm"),
  noticeId: document.getElementById("noticeId"),
  noticeTitle: document.getElementById("noticeTitle"),
  noticeBody: document.getElementById("noticeBody"),
  noticeList: document.getElementById("noticeList"),
  cancelNoticeEdit: document.getElementById("cancelNoticeEdit"),
  kpiUsers: document.getElementById("kpiUsers"),
  kpiPending: document.getElementById("kpiPending"),
  kpiProducts: document.getElementById("kpiProducts"),
  kpiKeywords: document.getElementById("kpiKeywords"),
  kpiApiToday: document.getElementById("kpiApiToday"),
  kpiChecked: document.getElementById("kpiChecked"),
  kpiNotices: document.getElementById("kpiNotices"),
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
  el.logoutButton?.addEventListener("click", logoutAdmin);
  el.noticeForm?.addEventListener("submit", saveNotice);
  el.cancelNoticeEdit?.addEventListener("click", resetNoticeForm);
  el.noticeList?.addEventListener("click", async (event) => {
    const commentButton = event.target.closest("[data-notice-comment-action]");
    if (commentButton?.dataset.noticeCommentAction === "delete") {
      await deleteNoticeComment(commentButton.dataset.noticeId, commentButton.dataset.commentId);
      return;
    }
    const button = event.target.closest("[data-notice-action]");
    if (!button) return;
    const noticeId = button.dataset.noticeId;
    if (button.dataset.noticeAction === "edit") {
      editNotice(noticeId);
      return;
    }
    if (button.dataset.noticeAction === "delete") {
      await deleteNotice(noticeId);
    }
  });
  document.querySelectorAll("[data-scroll-target]").forEach((item) => {
    item.addEventListener("click", () => scrollToPanel(item.dataset.scrollTarget));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        scrollToPanel(item.dataset.scrollTarget);
      }
    });
  });
  el.userList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-user-action]");
    if (!button) return;
    const action = button.dataset.userAction;
    if (action === "update-limit") {
      await updateUserLimit(button.dataset.userId);
      return;
    }
    if (action === "force-delete" || action === "permanent-delete") {
      await deleteUser(button.dataset.userId, action);
      return;
    }
    await updateUserApproval(button.dataset.userId, action);
  });
  el.userList.addEventListener("change", (event) => {
    const select = event.target.closest("[data-limit-select]");
    if (!select) return;
    const row = select.closest(".user-row");
    const custom = row?.querySelector("[data-limit-custom]");
    if (custom) {
      custom.hidden = select.value !== "custom";
      if (select.value !== "custom") custom.value = "";
    }
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
    if (secretError) localStorage.removeItem("soondaeng_admin_secret");
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
  const notices = overview.notices || summary.notices || [];
  const pendingCount = users.filter((user) => approvalStatus(user) === "pending").length;
  const usage = summary.apiUsage || {};

  el.kpiUsers.textContent = formatNumber(summary.userCount || users.length || 0);
  el.kpiPending.textContent = formatNumber(pendingCount);
  el.kpiProducts.textContent = formatNumber(summary.keywordCount || products.length || 0);
  el.kpiKeywords.textContent = formatNumber(summary.collectedItemCount || 0);
  el.kpiApiToday.textContent = formatNumber(usage.todayCount || 0);
  el.kpiChecked.textContent = summary.lastCheckedAt ? formatTime(summary.lastCheckedAt) : "-";
  if (el.kpiNotices) el.kpiNotices.textContent = formatNumber(notices.length || 0);

  renderApiUsage(summary);
  renderNotices(notices);
  el.userList.innerHTML = users.length ? users.map(renderUser).join("") : emptyBlock("회원이 없습니다.");
  el.productList.innerHTML = products.length ? products.map(renderProduct).join("") : emptyBlock("등록된 키워드가 없습니다.");
}

function renderApiUsage(summary) {
  const usage = summary.apiUsage || {};
  const usageByUser = summary.usageByUser || [];
  const recentDays = usage.recentDays || [];
  el.apiUsagePanel.innerHTML = `
    <div class="api-cards">
      <article><span>오늘 호출</span><strong>${formatNumber(usage.todayCount || 0)}</strong></article>
      <article><span>잔여 추정</span><strong>${formatNumber(usage.remainingToday ?? 25000)}</strong></article>
      <article><span>누적 호출</span><strong>${formatNumber(usage.total || 0)}</strong></article>
      <article><span>일일 기준</span><strong>${formatNumber(usage.limit || 25000)}</strong></article>
    </div>
    <div class="api-detail-grid">
      <div>
        <h3>최근 7일</h3>
        <div class="usage-list">
          ${recentDays.length ? recentDays.map((day) => `<div><span>${esc(day.day)}</span><strong>${formatNumber(day.count)}</strong></div>`).join("") : `<div><span>기록 없음</span><strong>0</strong></div>`}
        </div>
      </div>
      <div>
        <h3>회원별 호출</h3>
        <div class="usage-list">
          ${usageByUser.length ? usageByUser.map((user) => `
            <div>
              <span>${esc(user.email || user.phone || "-")}</span>
              <strong>오늘 ${formatNumber(user.todayApiCalls || 0)} / 누적 ${formatNumber(user.totalApiCalls || 0)}</strong>
            </div>
          `).join("") : `<div><span>기록 없음</span><strong>0</strong></div>`}
        </div>
      </div>
    </div>
  `;
}

function renderNotices(notices = []) {
  if (!el.noticeList) return;
  el.noticeList.innerHTML = notices.length ? notices.map((notice) => `
    <article class="notice-row">
      <div>
        <strong>${esc(notice.title || "공지")}</strong>
        <span>${formatTime(notice.updatedAt || notice.createdAt)} · 댓글 ${(notice.comments || []).length}개</span>
        <p>${esc(notice.body || "")}</p>
        ${renderNoticeComments(notice.id, notice.comments || [])}
      </div>
      <div class="row-actions">
        <button class="ghost" type="button" data-notice-id="${esc(notice.id)}" data-notice-action="edit">수정</button>
        <button class="danger" type="button" data-notice-id="${esc(notice.id)}" data-notice-action="delete">삭제</button>
      </div>
    </article>
  `).join("") : emptyBlock("등록된 공지가 없습니다.");
}

function renderNoticeComments(noticeId, comments = []) {
  if (!comments.length) {
    return `<div class="notice-comment-list empty-comments">댓글이 아직 없습니다.</div>`;
  }
  return `
    <div class="notice-comment-list">
      <strong>댓글 내역</strong>
      ${comments.map((comment) => `
        <div class="notice-comment-row">
          <div>
            <span>${esc(comment.storeName || comment.userEmail || comment.userPhone || "회원")}</span>
            <small>${formatTime(comment.createdAt)}</small>
            <button class="danger mini-danger" type="button" data-notice-id="${esc(noticeId)}" data-comment-id="${esc(comment.id)}" data-notice-comment-action="delete">댓글 삭제</button>
          </div>
          <p>${esc(comment.body || "")}</p>
        </div>
      `).join("")}
    </div>
  `;
}

async function saveNotice(event) {
  event.preventDefault();
  const noticeId = el.noticeId.value.trim();
  const title = el.noticeTitle.value.trim();
  const body = el.noticeBody.value.trim();
  if (!title || !body) {
    toast("공지 제목과 내용을 입력해 주세요.");
    return;
  }

  setBusy(true);
  try {
    await adminApi(noticeId ? `/api/admin/notices/${encodeURIComponent(noticeId)}` : "/api/admin/notices", {
      method: noticeId ? "PATCH" : "POST",
      body: { title, body }
    });
    resetNoticeForm();
    await loadOverview();
    toast(noticeId ? "공지를 수정했습니다." : "공지를 등록했습니다.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

function editNotice(noticeId) {
  const notice = (state.overview?.notices || state.overview?.summary?.notices || []).find((item) => item.id === noticeId);
  if (!notice) return;
  el.noticeId.value = notice.id;
  el.noticeTitle.value = notice.title || "";
  el.noticeBody.value = notice.body || "";
  el.cancelNoticeEdit.hidden = false;
  el.noticeTitle.focus();
}

function resetNoticeForm() {
  if (!el.noticeForm) return;
  el.noticeForm.reset();
  el.noticeId.value = "";
  el.cancelNoticeEdit.hidden = true;
}

async function deleteNotice(noticeId) {
  const notice = (state.overview?.notices || state.overview?.summary?.notices || []).find((item) => item.id === noticeId);
  if (!notice) return;
  if (!confirm(`공지 "${notice.title || "공지"}"를 삭제할까요? 본사이트에서도 사라집니다.`)) return;
  setBusy(true);
  try {
    await adminApi(`/api/admin/notices/${encodeURIComponent(noticeId)}`, { method: "DELETE" });
    resetNoticeForm();
    await loadOverview();
    toast("공지를 삭제했습니다.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

async function deleteNoticeComment(noticeId, commentId) {
  const notice = (state.overview?.notices || state.overview?.summary?.notices || []).find((item) => item.id === noticeId);
  const comment = (notice?.comments || []).find((item) => item.id === commentId);
  if (!notice || !comment) return;
  if (!confirm("이 공지 댓글을 삭제할까요? 본사이트에서도 사라집니다.")) return;
  setBusy(true);
  try {
    await adminApi(`/api/admin/notices/${encodeURIComponent(noticeId)}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
    await loadOverview();
    toast("공지 댓글을 삭제했습니다.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

function renderUser(user) {
  const status = approvalStatus(user);
  const badge = { pending: "승인대기", approved: "승인완료", rejected: "거절" }[status] || status;
  return `
    <article class="user-row ${esc(status)}">
      <div>
        <strong>${esc(user.email || "-")}</strong>
        <span>${esc(user.phone || "")} · ${esc(user.storeName || "스토어명 없음")}</span>
        <details class="detail-box">
          <summary>상세보기</summary>
          <div class="detail-grid">
            <span>가입: ${formatTime(user.createdAt)}</span>
            <span>승인요청: ${formatTime(user.approvalRequestedAt)}</span>
            <span>키워드: ${formatNumber(user.productCount || 0)} / 한도 ${formatNumber(user.productLimit || 100)}</span>
            <span>오늘 API: ${formatNumber(user.todayApiCalls || 0)}</span>
            <span>누적 API: ${formatNumber(user.totalApiCalls || 0)}</span>
            <span>최근조회: ${formatTime(user.lastCheckedAt)}</span>
          </div>
          <div class="limit-editor">
            <label>
              한도 변경
              <select data-limit-select>
                ${[100, 300, 500, 1000].map((limit) => `<option value="${limit}" ${Number(user.productLimit || 100) === limit ? "selected" : ""}>${limit}</option>`).join("")}
                <option value="custom">직접입력</option>
              </select>
            </label>
            <input data-limit-custom type="number" min="100" max="1000" step="1" placeholder="100~1000" hidden>
            <button class="ghost" type="button" data-user-id="${esc(user.id)}" data-user-action="update-limit">한도 저장</button>
          </div>
        </details>
      </div>
      <div class="user-meta">
        <span class="status ${esc(status)}">${esc(badge)}</span>
        <small>키워드 ${user.productCount || 0} · 수집 ${user.keywordCount || 0}</small>
      </div>
      <div class="row-actions">
        ${userActions(user, status)}
      </div>
    </article>
  `;
}

function userActions(user, status) {
  const id = esc(user.id);
  const approvalButtons = status === "approved"
    ? `
      <button class="danger" type="button" data-user-id="${id}" data-user-action="rejected"><svg><use href="#close"></use></svg><span>거절</span></button>
      <button class="ghost" type="button" data-user-id="${id}" data-user-action="pending">대기</button>
    `
    : status === "rejected"
      ? `
        <button class="primary" type="button" data-user-id="${id}" data-user-action="approved"><svg><use href="#check"></use></svg><span>승인</span></button>
        <button class="ghost" type="button" data-user-id="${id}" data-user-action="pending">대기</button>
      `
      : `
        <button class="primary" type="button" data-user-id="${id}" data-user-action="approved"><svg><use href="#check"></use></svg><span>승인</span></button>
        <button class="danger" type="button" data-user-id="${id}" data-user-action="rejected"><svg><use href="#close"></use></svg><span>거절</span></button>
      `;
  return `
    ${approvalButtons}
    <button class="danger" type="button" data-user-id="${id}" data-user-action="force-delete">회원삭제</button>
    <button class="danger strong-danger" type="button" data-user-id="${id}" data-user-action="permanent-delete">완전삭제</button>
  `;
}

function renderProduct(product) {
  const keyword = (product.keywords || [])[0] || {};
  const items = (product.latestItems || []).slice(0, 50);
  return `
    <article class="product-row keyword-row-card">
      <div>
        <strong>${esc(product.term || product.name || keyword.term || "키워드")}</strong>
        <span>${esc(product.userEmail || "")} · ${esc(product.userPhone || "")}</span>
        <span>기준 ${(keyword.alertRanks || product.alertRanks || [15]).join(", ")}위 · 하락폭 ${keyword.dropThreshold || product.dropThreshold || 10}위 · 최신 ${product.resultCount || items.length || 0}개</span>
        <details class="detail-box">
          <summary>상세보기</summary>
          <div class="rank-table-wrap">
            <table class="rank-table">
              <thead><tr><th>순위</th><th>상품</th><th>스토어</th></tr></thead>
              <tbody>
                ${items.length ? items.map((item) => `
                  <tr>
                    <td>${item.rank || "-"}</td>
                    <td><a href="${esc(item.link || "")}" target="_blank" rel="noreferrer">${esc(item.title || "-")}</a></td>
                    <td>${esc(item.mallName || "-")}</td>
                  </tr>
                `).join("") : `<tr><td colspan="3">아직 수집 결과가 없습니다.</td></tr>`}
              </tbody>
            </table>
          </div>
        </details>
      </div>
      <div class="keyword-stack">
        <span>최근조회 ${formatTime(product.lastCheckedAt)}</span>
        <span>상태 ${esc(keyword.status || "pending")} ${keyword.lastError ? `· ${esc(keyword.lastError)}` : ""}</span>
        <span>API ${formatNumber(keyword.lastApiCalls || 0)}회</span>
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

async function updateUserLimit(userId) {
  const user = (state.overview?.users || []).find((item) => item.id === userId);
  if (!user) return;
  const row = document.querySelector(`[data-user-id="${cssEscape(userId)}"][data-user-action="update-limit"]`)?.closest(".user-row");
  const select = row?.querySelector("[data-limit-select]");
  const custom = row?.querySelector("[data-limit-custom]");
  const rawLimit = select?.value === "custom" ? custom?.value : select?.value;
  const productLimit = Number(rawLimit || 0);
  if (!Number.isInteger(productLimit) || productLimit < 100 || productLimit > 1000) {
    toast("한도는 100~1000 사이 숫자로 입력해 주세요.");
    return;
  }

  setBusy(true);
  try {
    await adminApi(`/api/admin/users/${encodeURIComponent(userId)}/settings`, {
      method: "POST",
      body: {
        productLimit,
        suspended: Boolean(user.restrictions?.suspended),
        productCreateBlocked: Boolean(user.restrictions?.productCreateBlocked),
        manualTrackBlocked: Boolean(user.restrictions?.manualTrackBlocked),
        reason: user.restrictions?.reason || "",
        approvalStatus: user.approvalStatus || "approved"
      }
    });
    await loadOverview();
    toast(`키워드 한도를 ${formatNumber(productLimit)}개로 변경했습니다.`);
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

async function deleteUser(userId, action) {
  const user = (state.overview?.users || []).find((item) => item.id === userId);
  if (!user) return;
  const permanent = action === "permanent-delete";
  const message = permanent
    ? `${user.email || user.phone || "회원"}을 완전삭제할까요? 회원, 키워드, 저장 순위가 모두 삭제됩니다.`
    : `${user.email || user.phone || "회원"}을 삭제 처리할까요? 키워드는 비활성화되고 기록은 보관됩니다.`;
  if (!confirm(message)) return;
  setBusy(true);
  try {
    await adminApi(`/api/admin/users/${encodeURIComponent(userId)}/${action}`, { method: "POST" });
    await loadOverview();
    toast(permanent ? "회원을 완전삭제했습니다." : "회원을 삭제 처리했습니다.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

async function trackAll() {
  setBusy(true);
  try {
    await adminApi("/api/admin/track-all", { method: "POST", timeoutMs: 180000 });
    await loadOverview();
    toast("전체 키워드 순위 수집을 실행했습니다.");
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
    const email = result.report?.email || {};
    toast(email.status === "sent" ? `회원 ${email.sentCount || 0}명에게 리포트를 발송했습니다.` : email.message || "리포트 기록을 생성했습니다.");
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

function logoutAdmin() {
  state.secret = "";
  state.overview = null;
  state.connected = false;
  el.secretInput.value = "";
  localStorage.removeItem("soondaeng_admin_secret");
  renderConnectionState("로그아웃했습니다. 관리자 비밀키를 다시 입력해 주세요.");
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

function scrollToPanel(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  document.querySelectorAll("button, input, select, textarea").forEach((item) => {
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
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(new Date(timestamp));
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value || "").replace(/["\\]/g, "\\$&");
}
