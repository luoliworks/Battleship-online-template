(() => {
  const TOKEN_KEY = "battleship_admin_token";

  const loginView = document.getElementById("login-view");
  const dashboardView = document.getElementById("dashboard-view");
  const loginForm = document.getElementById("login-form");
  const tokenInput = document.getElementById("admin-token-input");
  const loginError = document.getElementById("login-error");

  const dashboardFeedback = document.getElementById("dashboard-feedback");
  const createRoomForm = document.getElementById("create-room-form");
  const noteInput = document.getElementById("room-note-input");
  const ttlSelect = document.getElementById("room-ttl-select");
  const maxPlayersInput = document.getElementById("room-max-players-input");

  const createdRoomBox = document.getElementById("created-room-box");
  const createdRoomCode = document.getElementById("created-room-code");
  const createdRoomLink = document.getElementById("created-room-link");
  const copyCreatedLinkBtn = document.getElementById("copy-created-link-btn");
  const openCreatedRoomLink = document.getElementById("open-created-room-link");

  const roomsTableBody = document.getElementById("rooms-table-body");
  const roomsEmpty = document.getElementById("rooms-empty");
  const roomsCount = document.getElementById("rooms-count");
  const refreshRoomsBtn = document.getElementById("refresh-rooms-btn");
  const logoutBtn = document.getElementById("logout-btn");

  let latestCreatedFullUrl = "";

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function showLoginError(message) {
    loginError.textContent = message;
    loginError.classList.remove("hidden");
  }

  function hideLoginError() {
    loginError.textContent = "";
    loginError.classList.add("hidden");
  }

  function showFeedback(type, message) {
    dashboardFeedback.className = `alert ${type}`;
    dashboardFeedback.textContent = message;
    dashboardFeedback.classList.remove("hidden");
  }

  function hideFeedback() {
    dashboardFeedback.classList.add("hidden");
    dashboardFeedback.textContent = "";
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleString();
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!ok) {
      throw new Error("Copy failed");
    }
  }

  async function copyJoinLink(code) {
    const url = `${location.origin}/?code=${encodeURIComponent(code)}`;
    try {
      await copyText(url);
      showFeedback("success", `已复制房间 ${code} 的邀请链接：${url}`);
    } catch {
      window.prompt("复制以下邀请链接：", url);
    }
  }

  async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(path, {
      ...options,
      headers,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function switchToLogin(errorMsg) {
    clearToken();
    dashboardView.classList.add("hidden");
    loginView.classList.remove("hidden");
    createdRoomBox.classList.add("hidden");
    hideFeedback();
    if (errorMsg) {
      showLoginError(errorMsg);
    }
  }

  function renderRooms(rooms) {
    roomsTableBody.replaceChildren();
    roomsCount.textContent = `共 ${rooms.length} 个房间`;

    if (rooms.length === 0) {
      roomsEmpty.classList.remove("hidden");
      return;
    }
    roomsEmpty.classList.add("hidden");

    for (const room of rooms) {
      const tr = document.createElement("tr");

      const codeTd = document.createElement("td");
      codeTd.className = "mono";
      codeTd.textContent = room.code;
      tr.appendChild(codeTd);

      const noteTd = document.createElement("td");
      noteTd.textContent = room.note || "—";
      tr.appendChild(noteTd);

      const maxTd = document.createElement("td");
      maxTd.textContent = String(room.maxPlayers);
      tr.appendChild(maxTd);

      const createdTd = document.createElement("td");
      createdTd.textContent = formatTime(room.createdAt);
      tr.appendChild(createdTd);

      const expiresTd = document.createElement("td");
      expiresTd.textContent = formatTime(room.expiresAt);
      tr.appendChild(expiresTd);

      const statusTd = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `badge ${room.expired ? "expired" : "valid"}`;
      badge.textContent = room.expired ? "已过期" : "有效";
      statusTd.appendChild(badge);
      tr.appendChild(statusTd);

      const actionsTd = document.createElement("td");
      const actionsWrap = document.createElement("div");
      actionsWrap.className = "row-actions";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn-secondary btn-sm";
      copyBtn.textContent = "复制链接";
      copyBtn.addEventListener("click", () => {
        void copyJoinLink(room.code);
      });
      actionsWrap.appendChild(copyBtn);

      const openLink = document.createElement("a");
      openLink.href = `/?code=${encodeURIComponent(room.code)}`;
      openLink.target = "_blank";
      openLink.rel = "noopener";
      openLink.className = "btn btn-secondary btn-sm";
      openLink.textContent = "打开";
      actionsWrap.appendChild(openLink);

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "btn-secondary btn-sm";
      resetBtn.textContent = "重置";
      resetBtn.addEventListener("click", () => {
        void handleResetRoom(room.code);
      });
      actionsWrap.appendChild(resetBtn);

      const destroyBtn = document.createElement("button");
      destroyBtn.type = "button";
      destroyBtn.className = "btn-danger btn-sm";
      destroyBtn.textContent = "销毁";
      destroyBtn.addEventListener("click", () => {
        void handleDestroyRoom(room.code);
      });
      actionsWrap.appendChild(destroyBtn);

      actionsTd.appendChild(actionsWrap);
      tr.appendChild(actionsTd);
      roomsTableBody.appendChild(tr);
    }
  }

  async function loadRooms() {
    const { res, data } = await apiFetch("/api/admin/rooms");
    if (res.status === 401) {
      switchToLogin(data.message || "管理员认证失败，请重新登录");
      return false;
    }
    if (!res.ok) {
      showFeedback("error", data.message || "加载房间列表失败");
      return false;
    }

    hideLoginError();
    loginView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    renderRooms(data.rooms || []);
    return true;
  }

  async function handleResetRoom(code) {
    if (!window.confirm(`确认重置房间 ${code}？在线玩家将被断开，邀请码保持有效。`)) {
      return;
    }
    const { res, data } = await apiFetch(
      `/api/admin/rooms/${encodeURIComponent(code)}/reset`,
      { method: "POST" },
    );
    if (res.status === 401) {
      switchToLogin(data.message || "管理员认证失败");
      return;
    }
    if (!res.ok) {
      showFeedback("error", data.message || "重置房间失败");
      return;
    }
    showFeedback("info", `房间 ${code} 已重置为空房待入座状态（邀请码保留有效）。`);
    await loadRooms();
  }

  async function handleDestroyRoom(code) {
    if (!window.confirm(`确认彻底销毁房间 ${code}？该邀请码将立即失效。`)) {
      return;
    }
    const { res, data } = await apiFetch(
      `/api/admin/rooms/${encodeURIComponent(code)}`,
      { method: "DELETE" },
    );
    if (res.status === 401) {
      switchToLogin(data.message || "管理员认证失败");
      return;
    }
    if (!res.ok) {
      showFeedback("error", data.message || "销毁房间失败");
      return;
    }
    if (createdRoomCode.textContent === code) {
      createdRoomBox.classList.add("hidden");
    }
    showFeedback("info", `房间 ${code} 已销毁，邀请码已失效。`);
    await loadRooms();
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) {
      showLoginError("请输入管理员口令");
      return;
    }
    setToken(token);
    tokenInput.value = "";
    await loadRooms();
  });

  createRoomForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideFeedback();

    const payload = {
      note: noteInput.value.trim(),
      ttlDays: Number(ttlSelect.value),
      maxPlayers: Number(maxPlayersInput.value) || 2,
    };

    const { res, data } = await apiFetch("/api/admin/rooms", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      switchToLogin(data.message || "管理员认证失败");
      return;
    }
    if (!res.ok) {
      showFeedback("error", data.message || "创建房间失败");
      return;
    }

    noteInput.value = "";
    latestCreatedFullUrl = `${location.origin}${data.joinUrl}`;
    createdRoomCode.textContent = data.code;
    createdRoomLink.textContent = latestCreatedFullUrl;
    openCreatedRoomLink.href = data.joinUrl;
    createdRoomBox.classList.remove("hidden");

    showFeedback("success", `成功创建房间 ${data.code}`);
    await loadRooms();
  });

  copyCreatedLinkBtn.addEventListener("click", async () => {
    if (!latestCreatedFullUrl) {
      return;
    }
    try {
      await copyText(latestCreatedFullUrl);
      showFeedback("success", `已复制邀请链接：${latestCreatedFullUrl}`);
    } catch {
      window.prompt("复制以下邀请链接：", latestCreatedFullUrl);
    }
  });

  refreshRoomsBtn.addEventListener("click", () => {
    hideFeedback();
    void loadRooms();
  });

  logoutBtn.addEventListener("click", () => {
    switchToLogin("");
    hideLoginError();
  });

  if (getToken()) {
    void loadRooms();
  }
})();
