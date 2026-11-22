(() => {
  const STORAGE_KEY = "battleship_lang";
  const DEFAULT_LANG = "en";

  const DICT = {
    en: {
      "title.player": "Battleship Mini Demo (6×6)",
      "title.admin": "Battleship Mini Demo — Admin",
      "lang.switchBtn": "🌐 中文",
      "lang.switchTitle": "切换为中文",

      "join.title": "Battleship Mini Demo",
      "join.subtitle": "6×6 2-player online Battleship (invite code + nickname, auto-reconnect on refresh)",
      "join.codeLabel": "Room Invite Code",
      "join.codePlaceholder": "Enter 6-char code, e.g. K7X9M2",
      "join.nameLabel": "Nickname (1–20 chars)",
      "join.namePlaceholder": "e.g. Alice",
      "join.submit": "Join Room",
      "join.adminLink": "Admin Console",
      "join.errEmptyCode": "Please enter a room invite code.",
      "join.errNameLen": "Nickname must be 1–20 characters.",
      "join.errInvalidOrExpired": "Invite code is invalid or expired.",
      "join.errNetwork": "Network request failed. Please check whether the server is running.",
      "join.errWsFailed": "WebSocket connection failed. Verify the invite code and server status.",
      "join.leftRoom": "Left the room. You can change your nickname or invite code to rejoin.",

      "game.roomPrefix": "Room",
      "game.roundText": "Round {round}",
      "game.vsPlayers": "{self} vs {opponent}",
      "game.waitingOpponentName": "Opponent",
      "game.presenceWaiting": "Waiting for opponent...",
      "game.presenceOnline": "Opponent online",
      "game.presenceOffline": "Opponent offline (waiting for reconnect...)",
      "game.leaveSwitch": "Leave / Switch Name",
      "game.disconnectedText": "WebSocket disconnected (polling disabled).",
      "game.reconnectBtn": "Reconnect",
      "game.notConnected": "Not connected to the room. Please reconnect first.",
      "game.randomizeBtn": "Randomize Fleet",
      "game.lockBtn": "Confirm & Lock Fleet",
      "game.rematchBtn": "Rematch",
      "game.rematchAcceptBtn": "Accept Rematch",
      "game.rematchWaitingBtn": "Confirmed (Waiting...)",
      "game.resetGameBtn": "Reset Game",
      "game.resetWaitingBtn": "Reset Requested...",
      "game.acceptResetBtn": "Accept Reset",
      "game.declineResetBtn": "Decline",
      "game.cancelResetBtn": "Cancel",
      "game.resetWaitingBanner": "Reset requested — waiting for {opponent} to confirm.",
      "game.resetIncomingBanner": "{opponent} requested to reset the game to Round 1.",

      "game.phaseWaitingTitle": "Waiting for Second Player",
      "game.phaseWaitingSub": "Share invite code {code} or the current page URL with your opponent.",
      "game.phasePlacingTitle": "Fleet Placement (Round {round})",
      "game.phasePlacingSub": "Click \"Randomize Fleet\" to roll a layout, then click \"Confirm & Lock Fleet\".",
      "game.phasePlacingOppReadySub": "Opponent is ready! Click \"Randomize Fleet\" to adjust, then lock your fleet.",
      "game.oppReadyBadge": "Opponent ready",
      "game.oppPlacingBadge": "Opponent placing...",
      "game.phaseLockedTitle": "Fleet Locked",
      "game.phaseLockedSub": "Waiting for opponent to finish placing ships...",
      "game.phaseYourTurnTitle": "Your Turn! Click Enemy Waters to Fire",
      "game.phaseOppTurnTitle": "Waiting for {opponent} to Fire...",
      "game.phaseStarterSub": "Starting player this round: {starter}",
      "game.phaseWonTitle": "Game Over: You Won!",
      "game.phaseLostTitle": "Game Over: Opponent Won",
      "game.phaseRematchWaitingSub": "Waiting for opponent to confirm rematch...",
      "game.phaseRematchOppReadySub": "Opponent requested a rematch! Click Accept to start the next round (starter alternates).",
      "game.phaseFinishedSub": "{summary} Full enemy fleet is now revealed for review.",

      "game.shotSummary": "Last shot: {actor} fired at ({x}, {y}) → {result}",
      "game.actorSelf": "You",
      "game.actorOpp": "Opponent",
      "game.resultMiss": "Miss",
      "game.resultHit": "Hit",
      "game.resultSunk": "Sunk a ship!",

      "game.myBoardTitle": "My Waters",
      "game.myBoardDefaultMeta": "3 ships (7 cells)",
      "game.myBoardLocked": "Locked",
      "game.myBoardPreview": "Preview (random)",
      "game.myBoardFleet": "{name}'s Fleet",
      "game.enemyBoardTitle": "Enemy Waters",
      "game.enemyBoardDefaultMeta": "Enemy ships left: 3",
      "game.enemyBoardRemaining": "Enemy ships left: {count}",
      "game.enemyBoardRevealed": "Full fleet revealed",
      "game.cellAria": "Cell ({x}, {y})",

      "legend.ship": "My Ship / Revealed Enemy Ship",
      "legend.preview": "Random Placement Preview",
      "legend.miss": "○ Miss",
      "legend.hit": "✕ Hit",
      "legend.sunk": "☠ Sunk",

      "modal.defaultTitle": "Notice",
      "modal.cannotJoinTitle": "Unable to Join Room",
      "modal.roomFullTitle": "Room Full",
      "modal.replacedTitle": "Session Replaced",
      "modal.disconnectedTitle": "Room Disconnected",
      "modal.closedTitle": "Connection Closed",
      "modal.okBtn": "OK",

      "result.victoryTitle": "Victory!",
      "result.defeatTitle": "Defeat",
      "result.victoryBadge": "🏆 Round {round} Winner",
      "result.defeatBadge": "💥 Round {round} Over",
      "result.reviewBtn": "Review Board",

      "chat.title": "Room Chat",
      "chat.count": "{count} / 50",
      "chat.empty": "No messages yet. Say hi to your opponent!",
      "chat.placeholder": "Type a message (max 200 chars)...",
      "chat.sendBtn": "Send",
      "chat.emptyError": "Message cannot be empty.",

      "admin.loginTitle": "Admin Console",
      "admin.loginSubtitle": "Enter the administrator token (ADMIN_TOKEN) to manage rooms and invite codes.",
      "admin.tokenLabel": "Admin Token",
      "admin.tokenPlaceholder": "Enter ADMIN_TOKEN",
      "admin.loginBtn": "Sign In",
      "admin.backPlayer": "Player Entry",
      "admin.errEmptyToken": "Please enter the admin token.",
      "admin.errAuthFailed": "Admin authentication failed. Please sign in again.",

      "admin.dashTitle": "Battleship Admin Console",
      "admin.dashSubtitle": "Create invite codes, configure TTL, reset or destroy rooms (zero DO wakeups on list)",
      "admin.playerEntryBtn": "Player Entry",
      "admin.refreshBtn": "Refresh",
      "admin.logoutBtn": "Sign Out",

      "admin.createTitle": "Create New Room",
      "admin.noteLabel": "Note (optional, max 100 chars)",
      "admin.notePlaceholder": "e.g. Friend match test",
      "admin.ttlLabel": "Invite Code TTL",
      "admin.ttl1": "1 Day",
      "admin.ttl3": "3 Days",
      "admin.ttl7": "7 Days (Default)",
      "admin.ttl15": "15 Days",
      "admin.ttl30": "30 Days",
      "admin.maxPlayersLabel": "Max Players",
      "admin.createBtn": "Create Room & Code",
      "admin.createdLabel": "Room Created:",
      "admin.copyLinkBtn": "Copy Invite Link",
      "admin.openRoomBtn": "Open Room",

      "admin.roomsListTitle": "Rooms",
      "admin.roomsCount": "{count} room(s)",
      "admin.colCode": "Code",
      "admin.colNote": "Note",
      "admin.colMaxPlayers": "Max Players",
      "admin.colCreated": "Created",
      "admin.colExpires": "Expires",
      "admin.colStatus": "Status",
      "admin.colActions": "Actions",
      "admin.roomsEmpty": "No rooms yet. Create one above.",
      "admin.statusValid": "Active",
      "admin.statusExpired": "Expired",
      "admin.rowCopy": "Copy Link",
      "admin.rowOpen": "Open",
      "admin.rowReset": "Reset",
      "admin.rowDestroy": "Destroy",

      "admin.copiedMsg": "Copied invite link for room {code}: {url}",
      "admin.copyPrompt": "Copy invite link:",
      "admin.errLoadRooms": "Failed to load room list.",
      "admin.errCreateRoom": "Failed to create room.",
      "admin.createdMsg": "Created room {code}.",
      "admin.confirmReset": "Reset room {code}? Online players will be disconnected, while the invite code stays valid.",
      "admin.errReset": "Failed to reset room.",
      "admin.resetDone": "Room {code} has been reset (invite code remains valid).",
      "admin.confirmDestroy": "Permanently destroy room {code}? Its invite code will stop working immediately.",
      "admin.errDestroy": "Failed to destroy room.",
      "admin.destroyDone": "Room {code} has been destroyed and its invite code invalidated.",

      "err.ROOM_FULL": "Room is full. Please contact Admin.",
      "err.INVALID_CODE": "Invalid invite code. Please contact Admin.",
      "err.EXPIRED_CODE": "Invite code has expired. Please contact Admin.",
      "err.REPLACED_BY_NEW_SESSION": "A player with the same nickname connected from another window or device.",
      "err.ROOM_RESET": "Admin reset the room. Please rejoin.",
      "err.ROOM_CLOSED": "Admin destroyed this room.",
      "err.UNAUTHORIZED": "Admin authentication failed.",
      "err.NOT_FOUND": "Resource not found.",
      "err.INTERNAL_ERROR": "Internal server error.",
      "err.INVALID_ACTION": "Invalid action.",
    },
    zh: {
      "title.player": "Battleship Mini Demo (6×6)",
      "title.admin": "Battleship Mini Demo — Admin 控制台",
      "lang.switchBtn": "🌐 EN",
      "lang.switchTitle": "Switch to English",

      "join.title": "Battleship Mini Demo",
      "join.subtitle": "6×6 双人海战棋联机验证版（凭邀请码 + 昵称入座，刷新自动恢复）",
      "join.codeLabel": "房间邀请码",
      "join.codePlaceholder": "输入 6 位邀请码，例如 K7X9M2",
      "join.nameLabel": "玩家昵称（1–20 字符）",
      "join.namePlaceholder": "例如：Alice",
      "join.submit": "进入房间",
      "join.adminLink": "Admin 控制台",
      "join.errEmptyCode": "请输入房间邀请码",
      "join.errNameLen": "昵称长度需为 1–20 个字符",
      "join.errInvalidOrExpired": "邀请码无效或已过期",
      "join.errNetwork": "网络请求失败，请检查服务是否已启动",
      "join.errWsFailed": "WebSocket 连接失败，请确认邀请码与服务状态后重试。",
      "join.leftRoom": "已离开房间，可更换昵称或邀请码重新加入。",

      "game.roomPrefix": "房间",
      "game.roundText": "第 {round} 局",
      "game.vsPlayers": "{self} vs {opponent}",
      "game.waitingOpponentName": "等待对手",
      "game.presenceWaiting": "等待对手入座...",
      "game.presenceOnline": "对手在线",
      "game.presenceOffline": "对手已离线（等待重连...）",
      "game.leaveSwitch": "离开 / 切换昵称",
      "game.disconnectedText": "WebSocket 连接已断开（未启用轮询）。",
      "game.reconnectBtn": "重新连接",
      "game.notConnected": "当前未连接到房间，请先重连",
      "game.randomizeBtn": "一键随机布阵",
      "game.lockBtn": "确认锁定布阵",
      "game.rematchBtn": "再来一局",
      "game.rematchAcceptBtn": "确认再来一局",
      "game.rematchWaitingBtn": "已确认（等待对手）",
      "game.resetGameBtn": "重置对局",
      "game.resetWaitingBtn": "已发起重置...",
      "game.acceptResetBtn": "同意重置",
      "game.declineResetBtn": "拒绝",
      "game.cancelResetBtn": "取消",
      "game.resetWaitingBanner": "已发起重置对局，等待 {opponent} 确认。",
      "game.resetIncomingBanner": "{opponent} 请求将对局重置回第 1 局。",

      "game.phaseWaitingTitle": "等待第二名玩家加入",
      "game.phaseWaitingSub": "请把邀请码 {code} 或当前页面链接发送给对手。",
      "game.phasePlacingTitle": "布阵阶段（第 {round} 局）",
      "game.phasePlacingSub": "点击“一键随机布阵”生成战舰位置，确认后点击“确认锁定布阵”。",
      "game.phasePlacingOppReadySub": "对手已完成布阵，请点击“一键随机布阵”调整阵型并锁定。",
      "game.oppReadyBadge": "对手已锁定",
      "game.oppPlacingBadge": "对手布阵中...",
      "game.phaseLockedTitle": "已锁定布阵",
      "game.phaseLockedSub": "等待对手完成布阵...",
      "game.phaseYourTurnTitle": "轮到你开火！请点击右侧敌方海域",
      "game.phaseOppTurnTitle": "等待 {opponent} 开火...",
      "game.phaseStarterSub": "本局先手：{starter}",
      "game.phaseWonTitle": "对局结束：你获胜了！",
      "game.phaseLostTitle": "对局结束：对手获胜",
      "game.phaseRematchWaitingSub": "等待对手确认再来一局...",
      "game.phaseRematchOppReadySub": "对手已发起再来一局，点击确认立即开始下一局（将轮换先手）！",
      "game.phaseFinishedSub": "{summary} 敌方完整棋盘已公开复盘。",

      "game.shotSummary": "上一手：{actor} 攻击 ({x}, {y}) → {result}",
      "game.actorSelf": "我方",
      "game.actorOpp": "对手",
      "game.resultMiss": "落空",
      "game.resultHit": "命中",
      "game.resultSunk": "击沉一艘战舰！",

      "game.myBoardTitle": "我方海域",
      "game.myBoardDefaultMeta": "3 艘战舰（共 7 格）",
      "game.myBoardLocked": "已锁定",
      "game.myBoardPreview": "待锁定（随机预览）",
      "game.myBoardFleet": "{name} 的舰队",
      "game.enemyBoardTitle": "敌方海域",
      "game.enemyBoardDefaultMeta": "剩余敌舰：3 艘",
      "game.enemyBoardRemaining": "剩余敌舰：{count} 艘",
      "game.enemyBoardRevealed": "完整舰队已公开复盘",
      "game.cellAria": "坐标 ({x}, {y})",

      "legend.ship": "我方战舰 / 复盘公开敌舰",
      "legend.preview": "待锁定随机阵型",
      "legend.miss": "○ 落空 (miss)",
      "legend.hit": "✕ 命中 (hit)",
      "legend.sunk": "☠ 已击沉 (sunk)",

      "modal.defaultTitle": "提示",
      "modal.cannotJoinTitle": "无法进入房间",
      "modal.roomFullTitle": "房间已满",
      "modal.replacedTitle": "账号已在其他窗口接入",
      "modal.disconnectedTitle": "房间连接已断开",
      "modal.closedTitle": "连接已关闭",
      "modal.okBtn": "知道了",

      "result.victoryTitle": "你获胜了！",
      "result.defeatTitle": "惜败",
      "result.victoryBadge": "🏆 第 {round} 局胜利",
      "result.defeatBadge": "💥 第 {round} 局结束",
      "result.reviewBtn": "查看复盘",

      "chat.title": "房间聊天",
      "chat.count": "{count} / 50",
      "chat.empty": "暂无消息，和对手打个招呼吧！",
      "chat.placeholder": "输入聊天内容（最多 200 字）...",
      "chat.sendBtn": "发送",
      "chat.emptyError": "聊天消息不能为空。",

      "admin.loginTitle": "Admin 控制台",
      "admin.loginSubtitle": "请输入管理员口令（ADMIN_TOKEN）以管理房间和邀请码。",
      "admin.tokenLabel": "管理员口令",
      "admin.tokenPlaceholder": "输入 ADMIN_TOKEN",
      "admin.loginBtn": "登录",
      "admin.backPlayer": "返回玩家入口",
      "admin.errEmptyToken": "请输入管理员口令",
      "admin.errAuthFailed": "管理员认证失败，请重新登录",

      "admin.dashTitle": "Battleship Admin 控制台",
      "admin.dashSubtitle": "建房发码、有效期管理、房间重置与销毁（不唤醒休眠房间）",
      "admin.playerEntryBtn": "玩家入口",
      "admin.refreshBtn": "刷新列表",
      "admin.logoutBtn": "退出登录",

      "admin.createTitle": "创建新房间",
      "admin.noteLabel": "备注（可选，最多 100 字）",
      "admin.notePlaceholder": "例如：好友双排测试",
      "admin.ttlLabel": "邀请码有效期",
      "admin.ttl1": "1 天",
      "admin.ttl3": "3 天",
      "admin.ttl7": "7 天（默认）",
      "admin.ttl15": "15 天",
      "admin.ttl30": "30 天",
      "admin.maxPlayersLabel": "人数上限",
      "admin.createBtn": "创建房间并生成邀请码",
      "admin.createdLabel": "已创建房间：",
      "admin.copyLinkBtn": "复制邀请链接",
      "admin.openRoomBtn": "打开房间",

      "admin.roomsListTitle": "房间列表",
      "admin.roomsCount": "共 {count} 个房间",
      "admin.colCode": "邀请码",
      "admin.colNote": "备注",
      "admin.colMaxPlayers": "人数上限",
      "admin.colCreated": "创建时间",
      "admin.colExpires": "过期时间",
      "admin.colStatus": "状态",
      "admin.colActions": "操作",
      "admin.roomsEmpty": "暂无房间，请先创建一个房间。",
      "admin.statusValid": "有效",
      "admin.statusExpired": "已过期",
      "admin.rowCopy": "复制链接",
      "admin.rowOpen": "打开",
      "admin.rowReset": "重置",
      "admin.rowDestroy": "销毁",

      "admin.copiedMsg": "已复制房间 {code} 的邀请链接：{url}",
      "admin.copyPrompt": "复制以下邀请链接：",
      "admin.errLoadRooms": "加载房间列表失败",
      "admin.errCreateRoom": "创建房间失败",
      "admin.createdMsg": "成功创建房间 {code}",
      "admin.confirmReset": "确认重置房间 {code}？在线玩家将被断开，邀请码保持有效。",
      "admin.errReset": "重置房间失败",
      "admin.resetDone": "房间 {code} 已重置为空房待入座状态（邀请码保留有效）。",
      "admin.confirmDestroy": "确认彻底销毁房间 {code}？该邀请码将立即失效。",
      "admin.errDestroy": "销毁房间失败",
      "admin.destroyDone": "房间 {code} 已销毁，邀请码已失效。",

      "err.ROOM_FULL": "房间已满，请联系 Admin",
      "err.INVALID_CODE": "邀请码无效，请联系 Admin",
      "err.EXPIRED_CODE": "邀请码已过期，请联系 Admin",
      "err.REPLACED_BY_NEW_SESSION": "同名玩家已在其他设备或窗口接入",
      "err.ROOM_RESET": "管理员已重置房间，请重新进入",
      "err.ROOM_CLOSED": "管理员已销毁该房间",
      "err.UNAUTHORIZED": "管理员认证失败",
      "err.NOT_FOUND": "接口不存在",
      "err.INTERNAL_ERROR": "服务器内部错误",
      "err.INVALID_ACTION": "操作无效",
    },
  };

  const SERVER_ACTION_EN = {
    "当前阶段不可摆船": "Cannot place ships in the current phase.",
    "你已提交布阵，无法重复修改": "Your fleet is already locked.",
    "当前不在开火阶段": "Not in the firing phase.",
    "还没轮到你的回合": "Not your turn yet.",
    "开火坐标越界": "Target coordinate is out of bounds.",
    "不能重复轰炸同一坐标": "You have already fired at that coordinate.",
    "对局尚未结束，无法发起再来一局": "Match has not finished yet.",
    "消息格式错误，必须为 JSON": "Invalid message format (must be JSON).",
    "无效的操作格式": "Invalid action payload.",
    "不支持的操作类型": "Unsupported action type.",
    "昵称长度需为 1–20 个字符": "Nickname must be 1–20 characters.",
  };

  let currentLang = DEFAULT_LANG;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") {
      currentLang = saved;
    }
  } catch {
    currentLang = DEFAULT_LANG;
  }

  const listeners = new Set();

  function t(key, params = {}) {
    const table = DICT[currentLang] || DICT[DEFAULT_LANG];
    const fallbackTable = DICT[DEFAULT_LANG];
    const template = table[key] ?? fallbackTable[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_match, name) =>
      Object.prototype.hasOwnProperty.call(params, name)
        ? String(params[name])
        : `{${name}}`,
    );
  }

  function formatError(code, fallbackMessage) {
    if (code === "INVALID_ACTION" && fallbackMessage) {
      if (currentLang === "en") {
        return SERVER_ACTION_EN[fallbackMessage] || t("err.INVALID_ACTION");
      }
      return fallbackMessage;
    }
    if (code && DICT[currentLang][`err.${code}`]) {
      return t(`err.${code}`);
    }
    return fallbackMessage || t("err.INVALID_ACTION");
  }

  function applyDom(root = document) {
    document.documentElement.lang = currentLang === "zh" ? "zh-CN" : "en";

    for (const el of root.querySelectorAll("[data-i18n]")) {
      const key = el.getAttribute("data-i18n");
      if (key) {
        el.textContent = t(key);
      }
    }

    for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
      const key = el.getAttribute("data-i18n-placeholder");
      if (key) {
        el.setAttribute("placeholder", t(key));
      }
    }

    for (const el of root.querySelectorAll("[data-i18n-title]")) {
      const key = el.getAttribute("data-i18n-title");
      if (key) {
        el.setAttribute("title", t(key));
      }
    }

    for (const btn of root.querySelectorAll("[data-lang-toggle]")) {
      btn.textContent = t("lang.switchBtn");
      btn.setAttribute("title", t("lang.switchTitle"));
    }
  }

  function setLang(lang) {
    if (lang !== "en" && lang !== "zh") {
      return;
    }
    currentLang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Ignore storage failures in restricted contexts.
    }
    applyDom();
    for (const fn of listeners) {
      fn(currentLang);
    }
  }

  function toggleLang() {
    setLang(currentLang === "en" ? "zh" : "en");
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-lang-toggle]")) {
      toggleLang();
    }
  });

  window.BattleshipI18n = {
    getLang: () => currentLang,
    setLang,
    toggleLang,
    t,
    formatError,
    applyDom,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();
