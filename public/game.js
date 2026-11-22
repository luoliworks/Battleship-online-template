(() => {
  const i18n = window.BattleshipI18n;
  const SESSION_KEY = "battleship_session";
  const BOARD_SIZE = 6;
  const FLEET_SPEC = [
    { id: "s1", len: 3 },
    { id: "s2", len: 2 },
    { id: "s3", len: 2 },
  ];

  const CLOSE_ERROR_CODES = {
    4001: "ROOM_FULL",
    4002: "REPLACED_BY_NEW_SESSION",
    4003: "ROOM_RESET",
    4004: "ROOM_CLOSED",
  };

  const joinView = document.getElementById("join-view");
  const gameView = document.getElementById("game-view");
  const joinForm = document.getElementById("join-form");
  const codeInput = document.getElementById("room-code-input");
  const nameInput = document.getElementById("nickname-input");
  const joinSubmitBtn = document.getElementById("join-submit-btn");
  const joinAlert = document.getElementById("join-alert");

  const headerRoomCode = document.getElementById("header-room-code");
  const headerRoundPill = document.getElementById("header-round-pill");
  const headerPlayers = document.getElementById("header-players");
  const presenceDot = document.getElementById("presence-dot");
  const presenceText = document.getElementById("presence-text");
  const leaveRoomBtn = document.getElementById("leave-room-btn");

  const disconnectBanner = document.getElementById("disconnect-banner");
  const manualReconnectBtn = document.getElementById("manual-reconnect-btn");
  const gameToast = document.getElementById("game-toast");

  const phaseTitle = document.getElementById("phase-title");
  const phaseSubtitle = document.getElementById("phase-subtitle");
  const resetBanner = document.getElementById("reset-banner");
  const resetBannerText = document.getElementById("reset-banner-text");
  const acceptResetBtn = document.getElementById("accept-reset-btn");
  const cancelResetBtn = document.getElementById("cancel-reset-btn");
  const resetGameBtn = document.getElementById("reset-game-btn");
  const randomizeShipsBtn = document.getElementById("randomize-ships-btn");
  const lockShipsBtn = document.getElementById("lock-ships-btn");
  const rematchBtn = document.getElementById("rematch-btn");

  const chatCountEl = document.getElementById("chat-count");
  const chatMessagesEl = document.getElementById("chat-messages");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");

  const placementModal = document.getElementById("placement-modal");
  const placementModalTitle = document.getElementById("placement-modal-title");
  const placementModalSubtitle = document.getElementById("placement-modal-subtitle");
  const placementOppStatus = document.getElementById("placement-opp-status");
  const placementBoardGrid = document.getElementById("placement-board-grid");

  const resultModal = document.getElementById("result-modal");
  const resultModalBadge = document.getElementById("result-modal-badge");
  const resultModalTitle = document.getElementById("result-modal-title");
  const resultModalSubtitle = document.getElementById("result-modal-subtitle");
  const resultReviewBtn = document.getElementById("result-review-btn");
  const resultRematchBtn = document.getElementById("result-rematch-btn");

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
  let chatMessages = [];
  let draftShips = null;
  let draftRound = null;
  let dismissedResultRound = null;
  let manualDisconnect = false;
  let terminalErrorHandled = false;

  function updateDocumentTitle() {
    document.title = i18n.t("title.player");
  }

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
        cellBtn.setAttribute("aria-label", i18n.t("game.cellAria", { x, y }));

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
        ? view.self.displayName || i18n.t("game.actorSelf")
        : view.opponent.displayName || i18n.t("game.actorOpp");
    const resultText =
      shot.result === "miss"
        ? i18n.t("game.resultMiss")
        : shot.result === "hit"
          ? i18n.t("game.resultHit")
          : i18n.t("game.resultSunk");
    return i18n.t("game.shotSummary", {
      actor,
      x: shot.x,
      y: shot.y,
      result: resultText,
    });
  }

  function formatChatTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function renderChat(scrollToBottom) {
    chatCountEl.textContent = i18n.t("chat.count", {
      count: chatMessages.length,
    });
    chatMessagesEl.replaceChildren();

    if (chatMessages.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "chat-empty";
      emptyEl.textContent = i18n.t("chat.empty");
      chatMessagesEl.appendChild(emptyEl);
      return;
    }

    const selfId = currentView && currentView.self ? currentView.self.id : null;
    for (const msg of chatMessages) {
      const item = document.createElement("div");
      item.className = `chat-msg ${selfId && msg.senderId === selfId ? "self" : "opponent"}`;

      const meta = document.createElement("div");
      meta.className = "chat-msg-meta";

      const sender = document.createElement("span");
      sender.className = "chat-msg-sender";
      sender.textContent = msg.senderName;

      const time = document.createElement("span");
      time.textContent = formatChatTime(msg.createdAt);

      meta.appendChild(sender);
      meta.appendChild(time);

      const textEl = document.createElement("div");
      textEl.className = "chat-msg-text";
      textEl.textContent = msg.text;

      item.appendChild(meta);
      item.appendChild(textEl);
      chatMessagesEl.appendChild(item);
    }

    if (scrollToBottom) {
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }
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
    headerRoundPill.textContent = i18n.t("game.roundText", { round: view.round });

    const selfName = view.self.displayName || currentNickname;
    const oppName =
      view.opponent.displayName || i18n.t("game.waitingOpponentName");
    headerPlayers.textContent = i18n.t("game.vsPlayers", {
      self: selfName,
      opponent: oppName,
    });

    if (!view.opponent.displayName) {
      presenceDot.className = "presence-dot waiting";
      presenceText.textContent = i18n.t("game.presenceWaiting");
    } else if (presence.opponentOnline) {
      presenceDot.className = "presence-dot online";
      presenceText.textContent = i18n.t("game.presenceOnline");
    } else {
      presenceDot.className = "presence-dot offline";
      presenceText.textContent = i18n.t("game.presenceOffline");
    }

    rematchBtn.classList.add("hidden");
    rematchBtn.disabled = false;
    resetGameBtn.classList.add("hidden");
    resetGameBtn.disabled = false;
    resetGameBtn.textContent = i18n.t("game.resetGameBtn");
    resetBanner.className = "alert warning hidden";
    acceptResetBtn.classList.add("hidden");
    placementModal.classList.add("hidden");

    const canRequestReset =
      view.phase === "PLACING" || view.phase === "PLAYING";
    if (canRequestReset) {
      if (view.self.resetVoted && !view.opponent.resetVoted) {
        resetGameBtn.classList.remove("hidden");
        resetGameBtn.disabled = true;
        resetGameBtn.textContent = i18n.t("game.resetWaitingBtn");

        resetBanner.className = "alert info";
        resetBannerText.textContent = i18n.t("game.resetWaitingBanner", {
          opponent: oppName,
        });
        acceptResetBtn.classList.add("hidden");
        cancelResetBtn.textContent = i18n.t("game.cancelResetBtn");
        resetBanner.classList.remove("hidden");
      } else if (!view.self.resetVoted && view.opponent.resetVoted) {
        resetBanner.className = "alert warning";
        resetBannerText.textContent = i18n.t("game.resetIncomingBanner", {
          opponent: oppName,
        });
        acceptResetBtn.classList.remove("hidden");
        cancelResetBtn.textContent = i18n.t("game.declineResetBtn");
        resetBanner.classList.remove("hidden");
      } else {
        resetGameBtn.classList.remove("hidden");
      }
    }

    if (view.phase !== "FINISHED") {
      dismissedResultRound = null;
      resultModal.classList.add("hidden");
    }

    const lastShotSummary = formatShotSummary(view);

    if (view.phase === "WAITING") {
      phaseTitle.textContent = i18n.t("game.phaseWaitingTitle");
      phaseSubtitle.textContent = i18n.t("game.phaseWaitingSub", {
        code: currentCode,
      });
    } else if (view.phase === "PLACING") {
      if (!view.self.ready) {
        const placingTitle = i18n.t("game.phasePlacingTitle", {
          round: view.round,
        });
        const placingSub = view.opponent.ready
          ? i18n.t("game.phasePlacingOppReadySub")
          : i18n.t("game.phasePlacingSub");
        phaseTitle.textContent = placingTitle;
        phaseSubtitle.textContent = placingSub;

        placementModalTitle.textContent = placingTitle;
        placementModalSubtitle.textContent = placingSub;
        placementOppStatus.className = view.opponent.ready
          ? "badge valid"
          : "badge neutral";
        placementOppStatus.textContent = view.opponent.ready
          ? i18n.t("game.oppReadyBadge")
          : i18n.t("game.oppPlacingBadge");

        renderBoardGrid(placementBoardGrid, {
          shipCells: new Set(),
          previewCells: buildCellSet(draftShips || []),
          sunkCells: new Set(),
          shotMap: new Map(),
          lastShotCoord: null,
          canFire: false,
          onCellClick: () => {},
        });
        placementModal.classList.remove("hidden");
      } else {
        phaseTitle.textContent = i18n.t("game.phaseLockedTitle");
        phaseSubtitle.textContent = i18n.t("game.phaseLockedSub");
      }
    } else if (view.phase === "PLAYING") {
      const isMyTurn = view.currentTurn === view.self.id;
      phaseTitle.textContent = isMyTurn
        ? i18n.t("game.phaseYourTurnTitle")
        : i18n.t("game.phaseOppTurnTitle", { opponent: oppName });
      phaseSubtitle.textContent =
        lastShotSummary ||
        i18n.t("game.phaseStarterSub", {
          starter: view.startingPlayer === view.self.id ? selfName : oppName,
        });
    } else if (view.phase === "FINISHED") {
      const iWon = view.winner === view.self.id;
      phaseTitle.textContent = iWon
        ? i18n.t("game.phaseWonTitle")
        : i18n.t("game.phaseLostTitle");

      let rematchText = i18n.t("game.rematchBtn");
      let rematchDisabled = false;
      let finishedSub = i18n.t("game.phaseFinishedSub", {
        summary: lastShotSummary,
      });

      if (view.self.rematchVoted && !view.opponent.rematchVoted) {
        finishedSub = i18n.t("game.phaseRematchWaitingSub");
        rematchText = i18n.t("game.rematchWaitingBtn");
        rematchDisabled = true;
      } else if (!view.self.rematchVoted && view.opponent.rematchVoted) {
        finishedSub = i18n.t("game.phaseRematchOppReadySub");
        rematchText = i18n.t("game.rematchAcceptBtn");
      }

      phaseSubtitle.textContent = finishedSub;
      rematchBtn.textContent = rematchText;
      rematchBtn.disabled = rematchDisabled;
      rematchBtn.classList.remove("hidden");

      if (dismissedResultRound !== view.round) {
        resultModalBadge.className = `result-badge ${iWon ? "victory" : "defeat"}`;
        resultModalBadge.textContent = i18n.t(
          iWon ? "result.victoryBadge" : "result.defeatBadge",
          { round: view.round },
        );
        resultModalTitle.textContent = i18n.t(
          iWon ? "result.victoryTitle" : "result.defeatTitle",
        );
        resultModalSubtitle.textContent = finishedSub;
        resultRematchBtn.textContent = rematchText;
        resultRematchBtn.disabled = rematchDisabled;
        resultModal.classList.remove("hidden");
      } else {
        resultModal.classList.add("hidden");
      }
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
          ? i18n.t("game.myBoardLocked")
          : i18n.t("game.myBoardPreview")
        : i18n.t("game.myBoardFleet", { name: selfName });

    enemyBoardMeta.textContent =
      view.phase === "FINISHED"
        ? i18n.t("game.enemyBoardRevealed")
        : i18n.t("game.enemyBoardRemaining", {
            count: view.opponent.shipsRemaining,
          });

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
      showGameToast("error", i18n.t("game.notConnected"));
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
    chatMessages = [];
    draftShips = null;
    draftRound = null;
    dismissedResultRound = null;

    gameView.classList.add("hidden");
    joinView.classList.remove("hidden");
    disconnectBanner.classList.add("hidden");
    resetBanner.classList.add("hidden");
    placementModal.classList.add("hidden");
    resultModal.classList.add("hidden");
    hideGameToast();
    renderChat(false);

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
      showNoticeModal(modalTitle || i18n.t("modal.defaultTitle"), modalMessage);
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
        renderChat(false);
        return;
      }

      if (payload.type === "chat_history") {
        chatMessages = Array.isArray(payload.messages) ? payload.messages : [];
        renderChat(true);
        return;
      }

      if (payload.type === "chat") {
        if (payload.message) {
          chatMessages.push(payload.message);
          if (chatMessages.length > 50) {
            chatMessages = chatMessages.slice(-50);
          }
          renderChat(true);
        }
        return;
      }

      if (payload.type === "error") {
        const localizedMsg = i18n.formatError(payload.code, payload.message);
        if (payload.code === "INVALID_ACTION") {
          showGameToast("error", localizedMsg);
          return;
        }

        terminalErrorHandled = true;
        returnToJoinScreen({
          alertType: "error",
          alertMessage: localizedMsg,
          modalTitle:
            payload.code === "ROOM_FULL"
              ? i18n.t("modal.roomFullTitle")
              : payload.code === "REPLACED_BY_NEW_SESSION"
                ? i18n.t("modal.replacedTitle")
                : i18n.t("modal.disconnectedTitle"),
          modalMessage: localizedMsg,
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

      const knownCode = CLOSE_ERROR_CODES[event.code];
      if (knownCode) {
        const knownMsg = i18n.formatError(knownCode);
        returnToJoinScreen({
          alertType: "error",
          alertMessage: knownMsg,
          modalTitle: i18n.t("modal.closedTitle"),
          modalMessage: knownMsg,
          clearSavedSession: true,
        });
        return;
      }

      if (currentView) {
        placementModal.classList.add("hidden");
        resultModal.classList.add("hidden");
        disconnectBanner.classList.remove("hidden");
      } else {
        showJoinAlert("error", i18n.t("join.errWsFailed"));
      }
    });
  }

  async function joinRoom(rawCode, rawNickname, options = {}) {
    const { isAutoReconnect = false } = options;
    const code = rawCode.trim().toUpperCase();
    const nickname = rawNickname.trim();

    if (!code) {
      showJoinAlert("error", i18n.t("join.errEmptyCode"));
      return;
    }
    if (nickname.length < 1 || nickname.length > 20) {
      showJoinAlert("error", i18n.t("join.errNameLen"));
      return;
    }

    hideJoinAlert();
    joinSubmitBtn.disabled = true;

    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/check`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        if (isAutoReconnect && (res.status === 404 || res.status === 410)) {
          clearSession();
        }
        const msg = i18n.formatError(
          data.code,
          data.message || i18n.t("join.errInvalidOrExpired"),
        );
        showJoinAlert("error", msg);
        if (!isAutoReconnect) {
          showNoticeModal(i18n.t("modal.cannotJoinTitle"), msg);
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
      showJoinAlert("error", i18n.t("join.errNetwork"));
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

  function handleRematchClick() {
    sendAction({ type: "rematch" });
  }

  function dismissResultModal() {
    if (currentView && currentView.phase === "FINISHED") {
      dismissedResultRound = currentView.round;
    }
    resultModal.classList.add("hidden");
  }

  rematchBtn.addEventListener("click", handleRematchClick);
  resultRematchBtn.addEventListener("click", handleRematchClick);
  resetGameBtn.addEventListener("click", () => {
    sendAction({ type: "reset_game" });
  });
  acceptResetBtn.addEventListener("click", () => {
    sendAction({ type: "reset_game" });
  });
  cancelResetBtn.addEventListener("click", () => {
    sendAction({ type: "cancel_reset" });
  });
  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text) {
      showGameToast("error", i18n.t("chat.emptyError"));
      chatInput.focus();
      return;
    }
    sendAction({ type: "chat", text });
    chatInput.value = "";
  });
  resultReviewBtn.addEventListener("click", dismissResultModal);
  resultModal.addEventListener("click", (event) => {
    if (event.target === resultModal) {
      dismissResultModal();
    }
  });

  leaveRoomBtn.addEventListener("click", () => {
    manualDisconnect = true;
    returnToJoinScreen({
      alertType: "info",
      alertMessage: i18n.t("join.leftRoom"),
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

  i18n.applyDom();
  updateDocumentTitle();
  renderChat(false);
  i18n.onChange(() => {
    updateDocumentTitle();
    renderGame();
    renderChat(false);
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
