(() => {
  const SESSION_KEY = "battleship_session";
  const BOARD_SIZE = 6;
  const FLEET_SPEC = [
    { id: "s1", len: 3 },
    { id: "s2", len: 2 },
    { id: "s3", len: 2 },
  ];

  const CLOSE_MESSAGES = {
    4001: "房间已满，请联系 Admin",
    4002: "同名玩家已在其他设备或窗口接入",
    4003: "管理员已重置房间，请重新进入",
    4004: "管理员已销毁该房间",
  };

  const joinView = document.getElementById("join-view");
  const gameView = document.getElementById("game-view");
  const joinForm = document.getElementById("join-form");
  const codeInput = document.getElementById("room-code-input");
  const nameInput = document.getElementById("nickname-input");
  const joinSubmitBtn = document.getElementById("join-submit-btn");
  const joinAlert = document.getElementById("join-alert");

  const headerRoomCode = document.getElementById("header-room-code");
  const headerRound = document.getElementById("header-round");
  const headerPlayers = document.getElementById("header-players");
  const presenceDot = document.getElementById("presence-dot");
  const presenceText = document.getElementById("presence-text");
  const leaveRoomBtn = document.getElementById("leave-room-btn");

  const disconnectBanner = document.getElementById("disconnect-banner");
  const manualReconnectBtn = document.getElementById("manual-reconnect-btn");
  const gameToast = document.getElementById("game-toast");

  const phaseTitle = document.getElementById("phase-title");
  const phaseSubtitle = document.getElementById("phase-subtitle");
  const randomizeShipsBtn = document.getElementById("randomize-ships-btn");
  const lockShipsBtn = document.getElementById("lock-ships-btn");
  const rematchBtn = document.getElementById("rematch-btn");

  const myBoardMeta = document.getElementById("my-board-meta");
  const enemyBoardMeta = document.getElementById("enemy-board-meta");
  const myBoardGrid = document.getElementById("my-board-grid");
  const enemyBoardGrid = document.getElementById("enemy-board-grid");

  const noticeModal = document.getElementById("notice-modal");
  const noticeModalTitle = document.getElementById("notice-modal-title");
  const noticeModalMessage = document.getElementById("notice-modal-message");
  const noticeModalClose = document.getElementById("notice-modal-close");

  let activeSocket = null;
  let currentCode = "";
  let currentNickname = "";
  let currentView = null;
  let currentPresence = null;
  let draftShips = null;
  let draftRound = null;
  let manualDisconnect = false;
  let terminalErrorHandled = false;

  function readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.code === "string" &&
        typeof parsed.nickname === "string"
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  function saveSession(code, nickname) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, nickname }));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function showJoinAlert(type, message) {
    joinAlert.className = `alert ${type}`;
    joinAlert.textContent = message;
    joinAlert.classList.remove("hidden");
  }

  function hideJoinAlert() {
    joinAlert.classList.add("hidden");
    joinAlert.textContent = "";
  }

  function showGameToast(type, message) {
    gameToast.className = `alert ${type}`;
    gameToast.textContent = message;
    gameToast.classList.remove("hidden");
  }

  function hideGameToast() {
    gameToast.classList.add("hidden");
    gameToast.textContent = "";
  }

  function showNoticeModal(title, message) {
    noticeModalTitle.textContent = title;
    noticeModalMessage.textContent = message;
    noticeModal.classList.remove("hidden");
  }

  function hideNoticeModal() {
    noticeModal.classList.add("hidden");
  }

  function getShipCells(ship) {
    const cells = [];
    for (let i = 0; i < ship.len; i += 1) {
      cells.push({
        x: ship.dir === "H" ? ship.x + i : ship.x,
        y: ship.dir === "V" ? ship.y + i : ship.y,
      });
    }
    return cells;
  }

  function generateRandomFleet() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const occupied = new Set();
      const placed = [];
      let failed = false;

      for (const spec of FLEET_SPEC) {
        let shipPlaced = null;
        for (let tries = 0; tries < 100; tries += 1) {
          const dir = Math.random() < 0.5 ? "H" : "V";
          const maxX = dir === "H" ? BOARD_SIZE - spec.len : BOARD_SIZE - 1;
          const maxY = dir === "V" ? BOARD_SIZE - spec.len : BOARD_SIZE - 1;
          const x = Math.floor(Math.random() * (maxX + 1));
          const y = Math.floor(Math.random() * (maxY + 1));
          const candidate = { id: spec.id, x, y, len: spec.len, dir };
          const cells = getShipCells(candidate);
          if (cells.every((c) => !occupied.has(`${c.x},${c.y}`))) {
            for (const c of cells) {
              occupied.add(`${c.x},${c.y}`);
            }
            shipPlaced = candidate;
            break;
          }
        }
        if (!shipPlaced) {
          failed = true;
          break;
        }
        placed.push(shipPlaced);
      }

      if (!failed) {
        return placed;
      }
    }

    return [
      { id: "s1", x: 0, y: 0, len: 3, dir: "H" },
      { id: "s2", x: 0, y: 2, len: 2, dir: "V" },
      { id: "s3", x: 3, y: 4, len: 2, dir: "H" },
    ];
  }

  function buildCellSet(ships) {
    const set = new Set();
    for (const ship of ships) {
      for (const cell of getShipCells(ship)) {
        set.add(`${cell.x},${cell.y}`);
      }
    }
    return set;
  }

  function buildShotMap(shots) {
    const map = new Map();
    for (const shot of shots) {
      map.set(`${shot.x},${shot.y}`, shot);
    }
    return map;
  }

  function buildSunkCellSet(ships, shotMap) {
    const sunkSet = new Set();
    for (const ship of ships) {
      const cells = getShipCells(ship);
      if (cells.length > 0 && cells.every((c) => shotMap.has(`${c.x},${c.y}`))) {
        for (const c of cells) {
          sunkSet.add(`${c.x},${c.y}`);
        }
      }
    }
    return sunkSet;
  }

  function renderBoardGrid(container, options) {
    const {
      shipCells,
      previewCells,
      sunkCells,
      shotMap,
      lastShotCoord,
      canFire,
      onCellClick,
    } = options;

    container.replaceChildren();

    const corner = document.createElement("div");
    corner.className = "axis-label";
    corner.textContent = "y\\x";
    container.appendChild(corner);

    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const label = document.createElement("div");
      label.className = "axis-label";
      label.textContent = String(x);
      container.appendChild(label);
    }

    for (let y = 0; y < BOARD_SIZE; y += 1) {
      const rowLabel = document.createElement("div");
      rowLabel.className = "axis-label";
      rowLabel.textContent = String(y);
      container.appendChild(rowLabel);

      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const key = `${x},${y}`;
        const cellBtn = document.createElement("button");
        cellBtn.type = "button";
        cellBtn.className = "cell";
        cellBtn.setAttribute("aria-label", `坐标 (${x}, ${y})`);

        const shot = shotMap.get(key);
        const hasShip = shipCells.has(key);
        const hasPreview = previewCells.has(key);
        const isSunkCell = sunkCells.has(key);

        if (hasPreview) {
          cellBtn.classList.add("preview");
        } else if (hasShip) {
          cellBtn.classList.add("ship");
        }

        if (shot) {
          if (isSunkCell) {
            cellBtn.classList.add("sunk");
            cellBtn.textContent = "☠";
          } else {
            cellBtn.classList.add(shot.result);
            if (shot.result === "miss") {
              cellBtn.textContent = "○";
            } else if (shot.result === "hit") {
              cellBtn.textContent = "✕";
            } else if (shot.result === "sunk") {
              cellBtn.textContent = "☠";
            }
          }
          cellBtn.disabled = true;
        } else if (canFire) {
          cellBtn.classList.add("clickable");
          cellBtn.addEventListener("click", () => {
            onCellClick(x, y);
          });
        } else {
          cellBtn.disabled = true;
        }

        if (lastShotCoord && lastShotCoord.x === x && lastShotCoord.y === y) {
          cellBtn.classList.add("last-shot");
        }

        container.appendChild(cellBtn);
      }
    }
  }

  function formatShotSummary(view) {
    const shot = view.lastShot;
    if (!shot) {
      return "";
    }
    const actor =
      shot.by === view.self.id
        ? view.self.displayName || "我方"
        : view.opponent.displayName || "对手";
    const resultText =
      shot.result === "miss"
        ? "落空"
        : shot.result === "hit"
          ? "命中"
          : "击沉一艘战舰！";
    return `上一手：${actor} 攻击 (${shot.x}, ${shot.y}) → ${resultText}`;
  }

  function renderGame() {
    if (!currentView) {
      return;
    }

    const view = currentView;
    const presence = currentPresence || {
      selfOnline: true,
      opponentOnline: false,
    };

    headerRoomCode.textContent = currentCode;
    headerRound.textContent = String(view.round);

    const selfName = view.self.displayName || currentNickname;
    const oppName = view.opponent.displayName || "等待对手";
    headerPlayers.textContent = `${selfName} vs ${oppName}`;

    if (!view.opponent.displayName) {
      presenceDot.className = "presence-dot waiting";
      presenceText.textContent = "等待对手入座...";
    } else if (presence.opponentOnline) {
      presenceDot.className = "presence-dot online";
      presenceText.textContent = "对手在线";
    } else {
      presenceDot.className = "presence-dot offline";
      presenceText.textContent = "对手已离线（等待重连...）";
    }

    randomizeShipsBtn.classList.add("hidden");
    lockShipsBtn.classList.add("hidden");
    rematchBtn.classList.add("hidden");
    rematchBtn.disabled = false;

    const lastShotSummary = formatShotSummary(view);

    if (view.phase === "WAITING") {
      phaseTitle.textContent = "等待第二名玩家加入";
      phaseSubtitle.textContent = `请把邀请码 ${currentCode} 或当前页面链接发送给对手。`;
    } else if (view.phase === "PLACING") {
      if (!view.self.ready) {
        phaseTitle.textContent = `布阵阶段（第 ${view.round} 局）`;
        phaseSubtitle.textContent = view.opponent.ready
          ? "对手已完成布阵，请点击“一键随机布阵”调整阵型并锁定。"
          : "点击“一键随机布阵”生成战舰位置，确认后点击“确认锁定布阵”。";
        randomizeShipsBtn.classList.remove("hidden");
        lockShipsBtn.classList.remove("hidden");
      } else {
        phaseTitle.textContent = "已锁定布阵";
        phaseSubtitle.textContent = "等待对手完成布阵...";
      }
    } else if (view.phase === "PLAYING") {
      const isMyTurn = view.currentTurn === view.self.id;
      phaseTitle.textContent = isMyTurn
        ? "轮到你开火！请点击右侧敌方海域"
        : `等待 ${oppName} 开火...`;
      phaseSubtitle.textContent =
        lastShotSummary ||
        `本局先手：${view.startingPlayer === view.self.id ? selfName : oppName}`;
    } else if (view.phase === "FINISHED") {
      const iWon = view.winner === view.self.id;
      phaseTitle.textContent = iWon ? "对局结束：你获胜了！" : "对局结束：对手获胜";

      if (view.self.rematchVoted && !view.opponent.rematchVoted) {
        phaseSubtitle.textContent = "等待对手确认再来一局...";
        rematchBtn.textContent = "已确认（等待对手）";
        rematchBtn.disabled = true;
      } else if (!view.self.rematchVoted && view.opponent.rematchVoted) {
        phaseSubtitle.textContent = "对手已发起再来一局，点击确认立即开始下一局（将轮换先手）！";
        rematchBtn.textContent = "确认再来一局";
      } else {
        phaseSubtitle.textContent = `${lastShotSummary} 敌方完整棋盘已公开复盘。`;
        rematchBtn.textContent = "再来一局";
      }
      rematchBtn.classList.remove("hidden");
    }

    const myShipsToShow =
      view.phase === "PLACING" && !view.self.ready && draftShips
        ? []
        : view.myBoard.ships;
    const myPreviewShips =
      view.phase === "PLACING" && !view.self.ready && draftShips
        ? draftShips
        : [];

    myBoardMeta.textContent =
      view.phase === "PLACING"
        ? view.self.ready
          ? "已锁定"
          : "待锁定（随机预览）"
        : `${selfName} 的舰队`;

    enemyBoardMeta.textContent =
      view.phase === "FINISHED"
        ? "完整舰队已公开复盘"
        : `剩余敌舰：${view.opponent.shipsRemaining} 艘`;

    const lastShotForMyBoard =
      view.lastShot && view.lastShot.by !== view.self.id ? view.lastShot : null;
    const lastShotForEnemyBoard =
      view.lastShot && view.lastShot.by === view.self.id ? view.lastShot : null;

    const myShotMap = buildShotMap(view.myBoard.incomingShots);
    renderBoardGrid(myBoardGrid, {
      shipCells: buildCellSet(myShipsToShow),
      previewCells: buildCellSet(myPreviewShips),
      sunkCells: buildSunkCellSet(myShipsToShow, myShotMap),
      shotMap: myShotMap,
      lastShotCoord: lastShotForMyBoard,
      canFire: false,
      onCellClick: () => {},
    });

    const canFire =
      view.phase === "PLAYING" && view.currentTurn === view.self.id;
    const enemyShotMap = buildShotMap(view.enemyBoard.myShots);
    renderBoardGrid(enemyBoardGrid, {
      shipCells: buildCellSet(view.enemyBoard.revealedShips),
      previewCells: new Set(),
      sunkCells: buildSunkCellSet(view.enemyBoard.revealedShips, enemyShotMap),
      shotMap: enemyShotMap,
      lastShotCoord: lastShotForEnemyBoard,
      canFire,
      onCellClick: (x, y) => {
        sendAction({ type: "fire", x, y });
      },
    });
  }

  function sendAction(action) {
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      showGameToast("error", "当前未连接到房间，请先重连");
      return;
    }
    hideGameToast();
    activeSocket.send(JSON.stringify(action));
  }

  function returnToJoinScreen(options = {}) {
    const {
      alertType = "info",
      alertMessage = "",
      modalTitle = "",
      modalMessage = "",
      clearNickname = false,
      clearSavedSession = true,
    } = options;

    if (clearSavedSession) {
      clearSession();
    }

    if (activeSocket) {
      const sock = activeSocket;
      activeSocket = null;
      if (
        sock.readyState === WebSocket.OPEN ||
        sock.readyState === WebSocket.CONNECTING
      ) {
        sock.close(1000, "CLIENT_RESET");
      }
    }

    currentView = null;
    currentPresence = null;
    draftShips = null;
    draftRound = null;

    gameView.classList.add("hidden");
    joinView.classList.remove("hidden");
    disconnectBanner.classList.add("hidden");
    hideGameToast();

    if (currentCode) {
      codeInput.value = currentCode;
    }
    if (clearNickname) {
      nameInput.value = "";
      nameInput.focus();
    }

    if (alertMessage) {
      showJoinAlert(alertType, alertMessage);
    } else {
      hideJoinAlert();
    }

    if (modalMessage) {
      showNoticeModal(modalTitle || "连接提示", modalMessage);
    }
  }

  function openRoomWebSocket(code, nickname) {
    if (activeSocket) {
      const prev = activeSocket;
      activeSocket = null;
      prev.close(1000, "RECONNECT");
    }

    manualDisconnect = false;
    terminalErrorHandled = false;
    disconnectBanner.classList.add("hidden");
    hideGameToast();

    const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProto}//${location.host}/ws?code=${encodeURIComponent(code)}&name=${encodeURIComponent(nickname)}`;
    const ws = new WebSocket(wsUrl);
    activeSocket = ws;

    ws.addEventListener("open", () => {
      if (ws !== activeSocket) {
        return;
      }
      disconnectBanner.classList.add("hidden");
    });

    ws.addEventListener("message", (event) => {
      if (ws !== activeSocket) {
        return;
      }

      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (payload.type === "state") {
        currentView = payload.view;
        currentPresence = payload.presence;

        if (currentView.phase === "PLACING" && !currentView.self.ready) {
          if (!draftShips || draftRound !== currentView.round) {
            draftShips = generateRandomFleet();
            draftRound = currentView.round;
          }
        } else {
          draftShips = null;
          draftRound = null;
        }

        joinView.classList.add("hidden");
        gameView.classList.remove("hidden");
        hideJoinAlert();
        renderGame();
        return;
      }

      if (payload.type === "error") {
        if (payload.code === "INVALID_ACTION") {
          showGameToast("error", payload.message || "操作无效");
          return;
        }

        terminalErrorHandled = true;
        returnToJoinScreen({
          alertType: "error",
          alertMessage: payload.message || "连接被服务端拒绝",
          modalTitle:
            payload.code === "ROOM_FULL"
              ? "房间已满"
              : payload.code === "REPLACED_BY_NEW_SESSION"
                ? "账号已在其他窗口接入"
                : "房间连接已断开",
          modalMessage: payload.message || "连接已断开",
          clearSavedSession: true,
        });
      }
    });

    ws.addEventListener("close", (event) => {
      if (ws !== activeSocket) {
        return;
      }
      activeSocket = null;

      if (manualDisconnect || terminalErrorHandled) {
        return;
      }

      const knownMsg = CLOSE_MESSAGES[event.code];
      if (knownMsg) {
        returnToJoinScreen({
          alertType: "error",
          alertMessage: knownMsg,
          modalTitle: "连接已关闭",
          modalMessage: knownMsg,
          clearSavedSession: true,
        });
        return;
      }

      if (currentView) {
        disconnectBanner.classList.remove("hidden");
      } else {
        showJoinAlert("error", "WebSocket 连接失败，请确认邀请码与服务状态后重试。");
      }
    });
  }

  async function joinRoom(rawCode, rawNickname, options = {}) {
    const { isAutoReconnect = false } = options;
    const code = rawCode.trim().toUpperCase();
    const nickname = rawNickname.trim();

    if (!code) {
      showJoinAlert("error", "请输入房间邀请码");
      return;
    }
    if (nickname.length < 1 || nickname.length > 20) {
      showJoinAlert("error", "昵称长度需为 1–20 个字符");
      return;
    }

    hideJoinAlert();
    joinSubmitBtn.disabled = true;

    try {
      const res = await fetch(
        `/api/rooms/${encodeURIComponent(code)}/check`,
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        if (isAutoReconnect && (res.status === 404 || res.status === 410)) {
          clearSession();
        }
        const msg = data.message || "邀请码无效或已过期";
        showJoinAlert("error", msg);
        if (!isAutoReconnect) {
          showNoticeModal("无法进入房间", msg);
        }
        return;
      }

      currentCode = data.code || code;
      currentNickname = nickname;
      saveSession(currentCode, currentNickname);
      history.replaceState(
        null,
        "",
        `/?code=${encodeURIComponent(currentCode)}`,
      );

      openRoomWebSocket(currentCode, currentNickname);
    } catch {
      showJoinAlert("error", "网络请求失败，请检查服务是否已启动");
    } finally {
      joinSubmitBtn.disabled = false;
    }
  }

  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void joinRoom(codeInput.value, nameInput.value);
  });

  randomizeShipsBtn.addEventListener("click", () => {
    if (!currentView || currentView.phase !== "PLACING" || currentView.self.ready) {
      return;
    }
    draftShips = generateRandomFleet();
    draftRound = currentView.round;
    hideGameToast();
    renderGame();
  });

  lockShipsBtn.addEventListener("click", () => {
    if (!draftShips) {
      return;
    }
    sendAction({ type: "place_ships", ships: draftShips });
  });

  rematchBtn.addEventListener("click", () => {
    sendAction({ type: "rematch" });
  });

  leaveRoomBtn.addEventListener("click", () => {
    manualDisconnect = true;
    returnToJoinScreen({
      alertType: "info",
      alertMessage: "已离开房间，可更换昵称或邀请码重新加入。",
      clearNickname: true,
      clearSavedSession: true,
    });
  });

  manualReconnectBtn.addEventListener("click", () => {
    if (currentCode && currentNickname) {
      void joinRoom(currentCode, currentNickname, { isAutoReconnect: true });
    }
  });

  noticeModalClose.addEventListener("click", hideNoticeModal);
  noticeModal.addEventListener("click", (event) => {
    if (event.target === noticeModal) {
      hideNoticeModal();
    }
  });

  // Startup: resolve URL ?code= and sessionStorage
  const params = new URLSearchParams(location.search);
  const urlCode = (params.get("code") || "").trim().toUpperCase();
  const saved = readSession();

  if (urlCode) {
    codeInput.value = urlCode;
    if (saved && saved.code === urlCode && saved.nickname) {
      nameInput.value = saved.nickname;
      void joinRoom(urlCode, saved.nickname, { isAutoReconnect: true });
    }
  } else if (saved && saved.code && saved.nickname) {
    codeInput.value = saved.code;
    nameInput.value = saved.nickname;
    void joinRoom(saved.code, saved.nickname, { isAutoReconnect: true });
  }
})();
