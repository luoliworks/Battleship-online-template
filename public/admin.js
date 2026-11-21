(() => {
  const i18n = window.BattleshipI18n;
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
  let lastRooms = [];

  function updateDocumentTitle() {
    document.title = i18n.t("title.admin");
  }

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
    const locale = i18n.getLang() === "zh" ? "zh-CN" : "en-US";
    return new Date(ts).toLocaleString(locale);
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
      showFeedback("success", i18n.t("admin.copiedMsg", { code, url }));
    } catch {
      window.prompt(i18n.t("admin.copyPrompt"), url);
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
    lastRooms = rooms;
    roomsTableBody.replaceChildren();
    roomsCount.textContent = i18n.t("admin.roomsCount", { count: rooms.length });

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
      badge.textContent = room.expired
        ? i18n.t("admin.statusExpired")
        : i18n.t("admin.statusValid");
      statusTd.appendChild(badge);
      tr.appendChild(statusTd);

      const actionsTd = document.createElement("td");
      const actionsWrap = document.createElement("div");
      actionsWrap.className = "row-actions";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn-secondary btn-sm";
      copyBtn.textContent = i18n.t("admin.rowCopy");
      copyBtn.addEventListener("click", () => {
        void copyJoinLink(room.code);
      });
      actionsWrap.appendChild(copyBtn);

      const openLink = document.createElement("a");
      openLink.href = `/?code=${encodeURIComponent(room.code)}`;
      openLink.target = "_blank";
      openLink.rel = "noopener";
      openLink.className = "btn btn-secondary btn-sm";
      openLink.textContent = i18n.t("admin.rowOpen");
      actionsWrap.appendChild(openLink);

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "btn-secondary btn-sm";
      resetBtn.textContent = i18n.t("admin.rowReset");
      resetBtn.addEventListener("click", () => {
        void handleResetRoom(room.code);
      });
      actionsWrap.appendChild(resetBtn);

      const destroyBtn = document.createElement("button");
      destroyBtn.type = "button";
      destroyBtn.className = "btn-danger btn-sm";
      destroyBtn.textContent = i18n.t("admin.rowDestroy");
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
      switchToLogin(i18n.formatError(data.code, i18n.t("admin.errAuthFailed")));
      return false;
    }
    if (!res.ok) {
      showFeedback(
        "error",
        i18n.formatError(data.code, data.message || i18n.t("admin.errLoadRooms")),
      );
      return false;
    }

    hideLoginError();
    loginView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    renderRooms(data.rooms || []);
    return true;
  }

  async function handleResetRoom(code) {
    if (!window.confirm(i18n.t("admin.confirmReset", { code }))) {
      return;
    }
    const { res, data } = await apiFetch(
      `/api/admin/rooms/${encodeURIComponent(code)}/reset`,
      { method: "POST" },
    );
    if (res.status === 401) {
      switchToLogin(i18n.formatError(data.code, i18n.t("admin.errAuthFailed")));
      return;
    }
    if (!res.ok) {
      showFeedback(
        "error",
        i18n.formatError(data.code, data.message || i18n.t("admin.errReset")),
      );
      return;
    }
    showFeedback("info", i18n.t("admin.resetDone", { code }));
    await loadRooms();
  }

  async function handleDestroyRoom(code) {
    if (!window.confirm(i18n.t("admin.confirmDestroy", { code }))) {
      return;
    }
    const { res, data } = await apiFetch(
      `/api/admin/rooms/${encodeURIComponent(code)}`,
      { method: "DELETE" },
    );
    if (res.status === 401) {
      switchToLogin(i18n.formatError(data.code, i18n.t("admin.errAuthFailed")));
      return;
    }
    if (!res.ok) {
      showFeedback(
        "error",
        i18n.formatError(data.code, data.message || i18n.t("admin.errDestroy")),
      );
      return;
    }
    if (createdRoomCode.textContent === code) {
      createdRoomBox.classList.add("hidden");
    }
    showFeedback("info", i18n.t("admin.destroyDone", { code }));
    await loadRooms();
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) {
      showLoginError(i18n.t("admin.errEmptyToken"));
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
      switchToLogin(i18n.formatError(data.code, i18n.t("admin.errAuthFailed")));
      return;
    }
    if (!res.ok) {
      showFeedback(
        "error",
        i18n.formatError(data.code, data.message || i18n.t("admin.errCreateRoom")),
      );
      return;
    }

    noteInput.value = "";
    latestCreatedFullUrl = `${location.origin}${data.joinUrl}`;
    createdRoomCode.textContent = data.code;
    createdRoomLink.textContent = latestCreatedFullUrl;
    openCreatedRoomLink.href = data.joinUrl;
    createdRoomBox.classList.remove("hidden");

    showFeedback("success", i18n.t("admin.createdMsg", { code: data.code }));
    await loadRooms();
  });

  copyCreatedLinkBtn.addEventListener("click", async () => {
    if (!latestCreatedFullUrl) {
      return;
    }
    try {
      await copyText(latestCreatedFullUrl);
      showFeedback(
        "success",
        i18n.t("admin.copiedMsg", {
          code: createdRoomCode.textContent,
          url: latestCreatedFullUrl,
        }),
      );
    } catch {
      window.prompt(i18n.t("admin.copyPrompt"), latestCreatedFullUrl);
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

  i18n.applyDom();
  updateDocumentTitle();
  i18n.onChange(() => {
    updateDocumentTitle();
    if (!dashboardView.classList.contains("hidden")) {
      renderRooms(lastRooms);
    }
  });

  if (getToken()) {
    void loadRooms();
  }
})();
