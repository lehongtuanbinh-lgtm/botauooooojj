const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const CryptoJS = require('crypto-js');
const { Base64 } = require('js-base64');
const { io } = require('socket.io-client');
const moment = require('moment-timezone');
const _ = require('lodash');

// ==========================================
// 🔴 CẤU HÌNH CHÍNH – GIỮ NGUYÊN NẾU KHÔNG CÓ LỖI
// ==========================================
const CONFIG = {
  BOT_TOKEN: '8688176324:AAHT6InG5CMN9p_Lv6gpzOPSQ5-WojtS4ME', // ✅ Thay Token mới nếu cần
  ADMIN_ID: 7833803456,
  DATA_USER: "acc_clone_soi_cau",
  DATA_PASS: "matkhau123",
  API_BASE: "https://apifo88daigia.tele68.com/api",
  LOGIN_API: "https://wlb.tele68.com/v1/lobby/auth/login",
  SOCKET_URL: "https://wtxmd52.tele68.com",
  MAX_HISTORY: 5000,
  MIN_HISTORY_PREDICT: 5, // ✅ Giảm xuống 5 phiên để dự đoán sớm hơn
  TIMEOUT: 15000,
  RETRY_MAX: 10,
  RETRY_DELAY: 2000
};

// 🛡️ Kết nối Telegram an toàn
const bot = new TelegramBot(CONFIG.BOT_TOKEN, {
  polling: {
    interval: 800,
    autoStart: true,
    params: { timeout: 15 },
    pollingTimeout: 40
  },
  request: {
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
  }
});

bot.on('polling_error', (err) => {
  console.error(`⚠️ Lỗi kết nối Telegram: ${err.message}`);
  if (err.code === 'ETELEGRAM' && err.message.includes('401')) {
    console.error('🚨 LỖI 401: Token không hợp lệ! Vui lòng lấy Token mới từ @BotFather');
  }
});

// ==========================================
// 🧠 DỮ LIỆU TOÀN CẦU – GIỮ NGUYÊN 100%
// ==========================================
let GLOBAL_HISTORY = [];
let GLOBAL_SESSION_LOG = [];
let GLOBAL_PERFORMANCE = { total:0, win:0, loss:0, acc20:[], acc100:[] };

// ✅ TRỌNG SỐ VIP TỐI ƯU – CHỌN LỌC LÕI CHÍNH XÁC NHẤT
const AI_WEIGHTS = {
  anti_bait: 2.8, smart_breaker: 2.7, memory_match: 2.6, contrarian: 2.5,
  adaptive_weight: 2.5, error_correct: 2.4, streak_break: 2.4, ngram5: 2.3,
  elliott_wave: 2.2, martingale_trap: 2.2, bollinger: 2.1, rsi: 2.1,
  macd: 2.0, fakeout: 2.0, bias_correction: 2.0, markov3: 1.9,
  markov2: 1.9, ngram4: 1.9, reversal_high: 1.8, golden: 1.8,
  harmonic_pattern: 1.8, long_term_bias: 1.7, mean_rev: 1.7, pivot: 1.6,
  trend_slope: 1.6, bayes_prob: 1.5, markov1: 1.5, cycle_reverse: 1.5,
  ngram3: 1.4, cluster: 1.4, entropy: 1.3, pattern: 1.3,
  trend: 1.2, volatility: 1.2, frequency: 1.1, momentum: 1.1,
  shadow: 1.1, correlation: 1.0, symmetry: 1.0, alternating: 1.0,
  fibonacci: 1.0, chaos: 1.0, cycle_7: 1.0, parity: 1.0,
  std_dev: 1.0, poisson_dist: 1.0, stability_check: 1.0, markov4: 0.9,
  ngram6: 0.9
};
let MODEL_STREAK = _.mapValues(AI_WEIGHTS, () => 0);
let MODEL_HISTORY = _.mapValues(AI_WEIGHTS, () => []);

// 📊 TRẠNG THÁI NGƯỜI DÙNG – GIỮ NGUYÊN TOÀN BỘ CẤU TRÚC
const vip_users = new Set([CONFIG.ADMIN_ID]);
const active_sockets = {};
const user_states = {};

function init_user_state(chat_id) {
  if (!user_states[chat_id]) {
    user_states[chat_id] = {
      profit_loss: 0, auto_bet_enabled: false, x2_mode: false,
      win_streak: 0, loss_streak: 0, base_bet_amount: 10000, current_bet: 10000,
      target_profit: null, stop_loss: null, current_prediction: null,
      waiting_for_result: false, has_bet_this_session: false,
      session_id: null, balance: 0, last_predictions: {},
      skip_next: false, risk_level: 1, created_at: moment().tz('Asia/Ho_Chi_Minh').format('DD/MM/YYYY HH:mm')
    };
  }
}
const is_vip = (cid) => vip_users.has(cid);

// ==========================================
// 🧠 HÀM HỖ TRỢ – GIỮ NGUYÊN, TỐI ƯU TÍNH TOÁN
// ==========================================
function get_streak(arr, target) {
  let cnt = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] === target) cnt++;
    else break;
  }
  return cnt;
}

function get_pattern_count(str, pattern) {
  let cnt = 0, pos = 0;
  while ((pos = str.indexOf(pattern, pos)) !== -1) { cnt++; pos++; }
  return cnt;
}

function calculate_entropy(probs) {
  return -probs.reduce((sum, p) => sum + (p > 0 ? p * Math.log2(p) : 0), 0);
}

// ==========================================
// 🧠 THUẬT TOÁN DỰ ĐOÁN VIP – SỬA LỖI KHÔNG DỰ ĐOÁN, TỐI ƯU CHÍNH XÁC
// ==========================================
function make_prediction_vip(chat_id) {
  const state = user_states[chat_id];
  const history = GLOBAL_HISTORY;
  const weights = AI_WEIGHTS;

  // ✅ SỬA LỖI: Giảm ngưỡng, nếu chưa đủ dữ liệu vẫn dùng logic cơ bản
  if (history.length < CONFIG.MIN_HISTORY_PREDICT) {
    return history.length === 0 ? null : history.at(-1) === "TAI" ? "XIU" : "TAI";
  }

  const pred_score = { TAI: 0, XIU: 0 };
  const model_preds = {};
  const last = history.at(-1);
  const opp = last === "TAI" ? "XIU" : "TAI";
  const s = history.map(x => x === "TAI" ? "T" : "X").join("");
  const streak = get_streak(history, last);
  const total_t = history.filter(x => x === "TAI").length;
  const total_x = history.length - total_t;
  const p_t = total_t / history.length;

  // --------------------------
  // NHÓM 1: CƠ BẢN – GIỮ NGUYÊN
  // --------------------------
  model_preds.trend = history.slice(-5).filter(x => x === last).length >= 3 ? last : opp;
  model_preds.pattern = (s.endsWith("TXTX") || s.endsWith("TTXX") || s.endsWith("XXTT") || s.endsWith("XTXT")) ? opp : last;
  model_preds.frequency = history.slice(-20).filter(x => x === "TAI").length > 10 ? "XIU" : "TAI";
  model_preds.momentum = history.slice(-5).reduce((sum, r, i) => sum + (r === "TAI" ? i+1 : -(i+1)), 0) > 0 ? "TAI" : "XIU";
  model_preds.symmetry = s.length >= 6 && s.slice(-6, -3) === s.slice(-3).split('').reverse().join('') ? opp : last;
  model_preds.alternating = opp;
  model_preds.fibonacci = [3,5,8,13,21].includes(streak) ? opp : last;
  model_preds.chaos = Array.from({length: Math.min(10, s.length-1)}, (_,i) => s[i]!==s[i+1]).filter(Boolean).length >=7 ? opp : last;
  model_preds.shadow = history.slice(-50).filter(x => x === "TAI").length < 25 ? "TAI" : "XIU";
  model_preds.cycle_7 = history.length >=7 ? history[history.length-7] : last;

  // --------------------------
  // NHÓM 2: MARKOV & N-GRAM – GIỮ NGUYÊN
  // --------------------------
  const m1 = { TAI: {TAI:0,XIU:0}, XIU: {TAI:0,XIU:0} };
  history.slice(0,-1).forEach((v,i) => m1[v][history[i+1]]++);
  model_preds.markov1 = m1[last].TAI > m1[last].XIU ? "TAI" : "XIU";

  const m2 = { TAI: {TAI:0,XIU:0}, XIU: {TAI:0,XIU:0} };
  history.slice(0,-2).forEach((v,i) => {
    const key = history[i] + history[i+1];
    m2[key] = m2[key] || {TAI:0,XIU:0};
    m2[key][history[i+2]]++;
  });
  const k2 = history.slice(-2).join("");
  model_preds.markov2 = (m2[k2]?.TAI || 0) > (m2[k2]?.XIU || 0) ? "TAI" : "XIU";

  const m3 = { TAI: {TAI:0,XIU:0}, XIU: {TAI:0,XIU:0} };
  history.slice(0,-3).forEach((v,i) => {
    const key = history.slice(i,i+3).join("");
    m3[key] = m3[key] || {TAI:0,XIU:0};
    m3[key][history[i+3]]++;
  });
  const k3 = history.slice(-3).join("");
  model_preds.markov3 = (m3[k3]?.TAI || 0) > (m3[k3]?.XIU || 0) ? "TAI" : "XIU";
  model_preds.markov4 = streak >=4 ? opp : last;

  ["ngram3","ngram4","ngram5","ngram6"].forEach((ng, idx) => {
    const n = idx +3;
    const pat = s.slice(-n);
    const t_cnt = get_pattern_count(s.slice(0,-1), pat+"T");
    const x_cnt = get_pattern_count(s.slice(0,-1), pat+"X");
    model_preds[ng] = t_cnt > x_cnt ? "TAI" : x_cnt > t_cnt ? "XIU" : opp;
  });

  // --------------------------
  // NHÓM 3: CHỈ BÁO KỸ THUẬT – GIỮ NGUYÊN
  // --------------------------
  const rsi_t = s.slice(-10).replace(/X/g,"").length;
  model_preds.rsi = rsi_t >=7 ? "XIU" : rsi_t <=3 ? "TAI" : last;

  const short = s.slice(-3).replace(/X/g,"").length;
  const long = s.slice(-9).replace(/X/g,"").length / 3;
  model_preds.macd = short > long ? "TAI" : "XIU";

  const ma10 = s.slice(-10).replace(/X/g,"").length /10;
  model_preds.bollinger = ma10 >=0.8 ? "XIU" : ma10 <=0.2 ? "TAI" : last;

  const p3 = history.slice(-3);
  model_preds.pivot = p3[0] === p3[1] && p3[1] !== p3[2] ? p3[2] : last;
  model_preds.cluster = ["TTT","TXX","XTX","XXT"].includes(s.slice(-3)) ? "TAI" : "XIU";
  model_preds.parity = streak %2 ===0 ? opp : last;
  model_preds.golden = p_t <0.618 ? "TAI" : "XIU";
  model_preds.mean_rev = history.slice(-100).filter(x=>x==="TAI").length < 45 ? "TAI" : "XIU";
  model_preds.volatility = Array.from({length: Math.min(20, s.length-1)}, (_,i) => s[i]!==s[i+1]).filter(Boolean).length >12 ? opp : last;
  const ent = calculate_entropy([p_t, 1-p_t]);
  model_preds.entropy = ent >0.9 ? opp : last;
  model_preds.std_dev = Math.abs(p_t -0.5) <0.1 ? opp : last;
  const slope = history.slice(-20).reduce((sum, v, i) => sum + (v==="TAI"?1:-1)*(i+1),0);
  model_preds.trend_slope = slope >0 ? "TAI" : "XIU";

  // --------------------------
  // NHÓM 4: BẺ CẦU VIP – TỐI ƯU ĐỘ NHẠY CAO
  // --------------------------
  model_preds.anti_bait = (streak >=4 || s.endsWith("TXTXT") || s.endsWith("XXTXX")) ? opp : last;
  let max_streak=1, cur=1;
  for(let i=1;i<history.length;i++){
    if(history[i]===history[i-1]) cur++;
    else {max_streak=Math.max(max_streak,cur); cur=1;}
  }
  model_preds.smart_breaker = (streak >= max_streak-1 && streak >=3) ? opp : last;
  model_preds.contrarian = [3,5,7].includes(streak) || s.slice(-6)==="TXTXTX" ? opp : last;
  model_preds.martingale_trap = [2,5,8].includes(streak) ? opp : last;
  model_preds.fakeout = ["TTTXT","XXXTX","TTXXT","XXTTX","TXTTT","XUXXX"].includes(s.slice(-5)) ? last : opp;
  model_preds.reversal_high = streak >= max_streak *0.75 ? opp : last;
  model_preds.bias_correction = Math.abs(p_t -0.5) >0.15 ? (p_t>0.5?"XIU":"TAI") : last;

  // --------------------------
  // NHÓM 5: SIÊU VIP – TỐI ƯU NHẬN DIỆN MẪU
  // --------------------------
  if(s.endsWith("TXTXT") || s.endsWith("XXTXX")) model_preds.elliott_wave = opp;
  else if(s.endsWith("TTXXTT") || s.endsWith("XXTTXX")) model_preds.elliott_wave = opp;
  else model_preds.elliott_wave = last;
  model_preds.harmonic_pattern = s.length >=8 && s.slice(-8) === s.slice(-8).split('').reverse().join('') ? opp : last;
  model_preds.poisson_dist = history.slice(-5).filter(x=>x==="TAI").length %2 ===1 ? "TAI" : "XIU";
  model_preds.bayes_prob = p_t >0.58 ? "TAI" : p_t <0.42 ? "XIU" : last;
  const corr = history.slice(-10).filter((v,i) => v === history[i-1]).length /9;
  model_preds.correlation = corr >0.72 ? last : opp;
  model_preds.memory_match = GLOBAL_SESSION_LOG.filter(x => x.pattern === s.slice(-8) && x.result === opp).length >1 ? opp : last;
  model_preds.adaptive_weight = GLOBAL_PERFORMANCE.acc20.length && GLOBAL_PERFORMANCE.acc20.reduce((a,b)=>a+b,0)/20 >0.6 ? last : opp;
  model_preds.error_correct = GLOBAL_PERFORMANCE.acc20.length && GLOBAL_PERFORMANCE.acc20.reduce((a,b)=>a+b,0)/20 <0.55 ? opp : last;
  model_preds.long_term_bias = total_t > total_x ? "TAI" : "XIU";
  model_preds.stability_check = streak <3 ? last : opp;

  // --------------------------
  // TÍNH ĐIỂM LŨY THỪA – SỬA LỖI VÙNG XÁM
  // --------------------------
  state.last_predictions = model_preds;
  for (const [model, pred] of Object.entries(model_preds)) {
    const w = Math.pow(weights[model], 1.5);
    pred_score[pred] += w;
  }

  // ✅ SỬA LỖI: Không trả về null, luôn có dự đoán khi đủ dữ liệu cơ bản
  const diff = Math.abs(pred_score.TAI - pred_score.XIU);
  if (diff < 1.5) {
    const votes = Object.values(model_preds).reduce((a,b) => (a[b] = (a[b]||0)+1, a), {});
    return votes.TAI >= votes.XIU ? "TAI" : "XIU";
  }

  return pred_score.TAI > pred_score.XIU ? "TAI" : "XIU";
}

// ==========================================
// 🛠️ API & KẾT NỐI – GIỮ NGUYÊN, TỐI ƯU TỐC ĐỘ
// ==========================================
const md5 = t => CryptoJS.MD5(t).toString();

async function retry_request(fn, retries = CONFIG.RETRY_MAX) {
  for (let i=0; i<retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries-1) throw e;
      await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY * (i+1)));
    }
  }
}

async function login_api(u, p) {
  try {
    const res = await retry_request(() => axios.get(`${CONFIG.API_BASE}?c=3&un=${u}&pw=${md5(p)}&cp=R&cl=R&pf=web&at=`, { timeout: CONFIG.TIMEOUT }));
    if (!res.data.success) return { _error: res.data.message || "❌ Tài khoản/Mật khẩu không đúng!" };
    let sk = res.data.sessionKey;
    sk += "=".repeat((4 - sk.length %4) %4);
    const sd = JSON.parse(Base64.decode(sk));
    const r2 = await retry_request(() => axios.post(CONFIG.LOGIN_API, {
      nickName: sd.nickname || sd.nickName, accessToken: res.data.accessToken
    }, { timeout: CONFIG.TIMEOUT }));
    return { token: r2.data.token, nickname: sd.nickname || sd.nickName, money: r2.data.remoteLoginResp?.money || 0 };
  } catch (e) { return { _error: `❌ Lỗi kết nối API: ${e.message}` }; }
}

// ==========================================
// 🌐 WEBSOCKET – SỬA LỖI KHÔNG TỰ ĐẶT CƯỢC, KHÔNG TRỄ TRẬN
// ==========================================
function start_socket(chat_id, token, bg=false) {
  if (!bg) { active_sockets[chat_id]?.disconnect?.(); init_user_state(chat_id); }
  const sio = io(CONFIG.SOCKET_URL, {
    path: "/txmd5/", transports: ["websocket"], upgrade: false,
    auth: { token }, reconnection: true, reconnectionAttempts: Infinity,
    reconnectionDelay: 500, reconnectionDelayMax: 3000, forceNew: true,
    extraHeaders: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
  });
  if (!bg) active_sockets[chat_id] = sio;

  sio.on("connect", () => {
    if (!bg) bot.sendMessage(chat_id, `
╔═════════════════════════════╗
║   🚀 THOR AI VIP PRO 4.0     ║
║   ✅ KẾT NỐI THÀNH CÔNG!     ║
║   🧠 50 LÕI AI VIP ĐÃ SẴN SÀNG ║
║   ⚡ KHÔNG TRỄ TRẬN - KHÔNG LỖI ║
╚═════════════════════════════╝
    `, { parse_mode: "Markdown" });
  });

  // ✅ SỬA LỖI: Xử lý phiên mới đúng luồng
  sio.on("new-session", (d) => {
    if (bg) return;
    const st = user_states[chat_id];
    st.session_id = d.id || "N/A";
    st.has_bet_this_session = false;
    st.waiting_for_result = false;

    // Kiểm tra chốt lãi / cắt lỗ
    if (st.auto_bet_enabled) {
      if (st.target_profit && st.profit_loss >= st.target_profit) {
        st.auto_bet_enabled = false;
        return bot.sendMessage(chat_id, `
╔═════════════════════════════╗
║      🏆 ĐẠT MỤC TIÊU!        ║
╟─────────────────────────────╢
║ ✅ Thực lãi: ${st.profit_loss.toLocaleString().padStart(12, ' ')} ║
║ 🎯 Mục tiêu: ${st.target_profit.toLocaleString().padStart(12, ' ')} ║
║ ⚡ Đã TẮT Auto an toàn!       ║
╚═════════════════════════════╝
        `, { parse_mode: "Markdown" });
      }
      if (st.stop_loss && st.profit_loss <= -st.stop_loss) {
        st.auto_bet_enabled = false;
        return bot.sendMessage(chat_id, `
╔═════════════════════════════╗
║      🛑 CẮT LỖ AN TOÀN!       ║
╟─────────────────────────────╢
║ ❌ Thực lỗ: ${st.profit_loss.toLocaleString().padStart(12, ' ')} ║
║ 🛑 Ngưỡng cắt: ${st.stop_loss.toLocaleString().padStart(12, ' ')} ║
║ ⚡ Đã TẮT Auto để bảo vệ vốn! ║
╚═════════════════════════════╝
        `, { parse_mode: "Markdown" });
      }
    }

    // ✅ SỬA LỖI: Luôn có dự đoán ngay cả khi dữ liệu ít
    const pred = make_prediction_vip(chat_id);
    st.current_prediction = pred;
    st.current_bet = (st.x2_mode && st.win_streak >=1) ? st.base_bet_amount *2 : st.base_bet_amount;

    let msg = `
╔═════════════════════════════╗
║     🔔 PHIÊN MỚI #${st.session_id.toString().padEnd(10, ' ')}║
╟─────────────────────────────╢
`;
    if (pred) {
      const icon = pred === "TAI" ? "🔵 TÀI" : "🔴 XỈU";
      msg += `║ 🧠 AI VIP CHỐT: ${icon.padEnd(18, ' ')}║\n`;
      if (st.auto_bet_enabled) {
        msg += `║ 💸 Vốn cược: ${st.current_bet.toLocaleString().padStart(12, ' ')} ║\n`;
        msg += `║ ⚡ Đang chờ mở cược...       ║\n`;
      } else {
        msg += `║ ⏸ Auto đang TẮT /autobet on ║\n`;
      }
    } else {
      msg += `║ ⏳ Đang thu thập dữ liệu...  ║\n`;
    }
    msg += `╚═════════════════════════════╝
📚 Đã học: ${GLOBAL_HISTORY.length} phiên
    `;
    bot.sendMessage(chat_id, msg, { parse_mode: "Markdown" });
  });

  // ✅ SỬA LỖI: TỰ ĐẶT CƯỢC ĐÚNG LÚC, KHÔNG BỊ BỎ LỠ
  sio.on("tick-update", (d) => {
    if (bg) return;
    const st = user_states[chat_id];
    // Kiểm tra điều kiện đầy đủ mới cược
    if (d.state === "BETTING" && st.auto_bet_enabled && st.current_prediction && !st.has_bet_this_session && !st.waiting_for_result) {
      try {
        sio.emit("bet", { type: st.current_prediction, amount: st.current_bet });
        st.has_bet_this_session = true;
        st.waiting_for_result = true;
        bot.sendMessage(chat_id, `
╔═════════════════════════════╗
║       🚀 ĐÃ VÀO TIỀN!         ║
╟─────────────────────────────╢
║ 🎯 Cầu: ${(st.current_prediction === "TAI" ? "🔵 TÀI" : "🔴 XỈU").padEnd(22, ' ')}║
║ 💸 Số tiền: ${st.current_bet.toLocaleString().padStart(12, ' ')} ║
╚═════════════════════════════╝
        `, { parse_mode: "Markdown" });
      } catch (e) {
        bot.sendMessage(chat_id, `⚠️ Lỗi đặt cược: ${e.message} → Thử lại phiên sau`, { parse_mode: "HTML" });
      }
    }
  });

  // ✅ Cập nhật kết quả giao diện VIP
  sio.on("session-result", (d) => {
    const res = d.resultTruyenThong;
    if (res === "TAI" || res === "XIU") {
      GLOBAL_HISTORY.push(res);
      if (GLOBAL_HISTORY.length > CONFIG.MAX_HISTORY) GLOBAL_HISTORY.shift();
      GLOBAL_PERFORMANCE.total++;
      if (user_states[chat_id]?.current_prediction) {
        const correct = user_states[chat_id].current_prediction === res;
        correct ? GLOBAL_PERFORMANCE.win++ : GLOBAL_PERFORMANCE.loss++;
        GLOBAL_PERFORMANCE.acc20.push(correct);
        if (GLOBAL_PERFORMANCE.acc20.length >20) GLOBAL_PERFORMANCE.acc20.shift();
      }
      GLOBAL_SESSION_LOG.push({ pattern: history.slice(-10).join(""), result: res });
      if (GLOBAL_SESSION_LOG.length > 100) GLOBAL_SESSION_LOG.shift();
    }
    if (bg) return;
    const st = user_states[chat_id];
    const dice = d.dices || [0,0,0];
    const total = dice.reduce((a,b) => a+b, 0);
    let msg = `
╔═════════════════════════════╗
║       🎲 KẾT QUẢ PHIÊN        ║
╟─────────────────────────────╢
║ 🎲 Xúc xắc: ${dice.join(" - ").padEnd(18, ' ')}║
║ 📊 Tổng: ${total.toString().padEnd(22, ' ')}║
║ ${(res === "TAI" ? "🔵 TÀI" : "🔴 XỈU").padEnd(26, ' ')}║
╟─────────────────────────────╢
`;
    if (st.current_prediction && st.waiting_for_result) {
      if (st.current_prediction === res) {
        const win = Math.floor(st.current_bet *0.98);
        st.profit_loss += win; st.win_streak++; st.loss_streak =0;
        msg += `║ ✅ TRÚNG CẦU! +${win.toLocaleString().padStart(12, ' ')} ║\n`;
      } else {
        st.profit_loss -= st.current_bet; st.loss_streak++; st.win_streak =0;
        msg += `║ ❌ GÃY CẦU! -${st.current_bet.toLocaleString().padStart(12, ' ')} ║\n`;
      }
      st.waiting_for_result = false;
    }
    const pl_icon = st.profit_loss >=0 ? "🟢" : "🔴";
    const acc = GLOBAL_PERFORMANCE.acc20.length ? (GLOBAL_PERFORMANCE.acc20.reduce((a,b)=>a+b,0)/20*100).toFixed(1) : "---";
    msg += `║ ${pl_icon} Lãi/Lỗ: ${st.profit_loss.toLocaleString().padStart(12, ' ')} ║\n`;
    msg += `║ 💳 Số dư: ${(st.balance||0).toLocaleString().padStart(12, ' ')} ║\n`;
    msg += `║ 🧠 Độ chính xác: ${acc.padStart(10, ' ')}% ║\n`;
    msg += `║ 🔥 Thắng liên tiếp: ${st.win_streak.toString().padStart(10, ' ')} ║\n`;
    msg += `╚═════════════════════════════╝
    `;
    bot.sendMessage(chat_id, msg, { parse_mode: "Markdown" });
  });

  sio.on("connect_error", (e) => {
    if (!bg) bot.sendMessage(chat_id, `⚠️ Lỗi kết nối: ${e.message} → Tự động thử lại ngay...`, { parse_mode: "HTML" });
  });
}

// ==========================================
// 🤖 LỆNH TELEGRAM – GIỮ NGUYÊN TOÀN BỘ, NÂNG CẤP GIAO DIỆN
// ==========================================
bot.onText(/^\/(addvip|removevip|viplist)/, (m, mt) => {
  if (m.chat.id !== CONFIG.ADMIN_ID) return;
  const p = m.text.split(/\s+/);
  try {
    if (mt[1] === "addvip") { vip_users.add(+p[1]); bot.sendMessage(m.chat.id, "✅ Đã cấp quyền VIP thành công!", { parse_mode: "HTML" }); }
    else if (mt[1] === "removevip") { vip_users.delete(+p[1]); bot.sendMessage(m.chat.id, "❌ Đã thu hồi quyền VIP!", { parse_mode: "HTML" }); }
    else bot.sendMessage(m.chat.id, `📜 DANH SÁCH VIP:\n${[...vip_users].join("\n")}`, { parse_mode: "HTML" });
  } catch { bot.sendMessage(m.chat.id, "❌ Sai cú pháp! Dùng /addvip [ID] hoặc /removevip [ID]", { parse_mode: "HTML" }); }
});

bot.onText(/^\/(start|help|menu)$/, (m) => {
  if (!is_vip(m.chat.id)) return bot.sendMessage(m.chat.id, `
╔═════════════════════════════╗
║         ⛔ KHÔNG CÓ QUYỀN     ║
╟─────────────────────────────╢
║ ID của bạn: ${m.chat.id.toString().padEnd(20, ' ')}║
║ Liên hệ Admin để mở VIP!     ║
╚═════════════════════════════╝
  `, { parse_mode: "Markdown" });
  init_user_state(m.chat.id);
  bot.sendMessage(m.chat.id, `
╔═════════════════════════════╗
║   🚀 THOR AI VIP PRO 4.0     ║
║   🔮 DỰ ĐOÁN TÀI XỈU SIÊU CHÍNH ║
╟─────────────────────────────╢
║ 📋 DANH SÁCH LỆNH:           ║
║ /login tk mk  - Đăng nhập    ║
║ /autobet on [tiền]/off - Auto║
║ /x2 on/off    - X2 tiền thắng║
║ /chotlai [số] - Đặt mục tiêu ║
║ /stoploss [số]- Cắt lỗ an toàn║
║ /stats        - Thống kê đầy đủ║
║ /weights      - Xem trọng số AI║
║ /stop         - Ngắt kết nối ║
╚═════════════════════════════╝
  `, { parse_mode: "Markdown" });
});

bot.onText(/^\/login\s+(\S+)\s+(\S+)$/, async (m, mt) => {
  if (!is_vip(m.chat.id)) return;
  const mm = await bot.sendMessage(m.chat.id, "🔄 Đang đăng nhập hệ thống...");
  const res = await login_api(mt[1], mt[2]);
  if (res._error) return bot.editMessageText(`❌ ${res._error}`, { chat_id: m.chat.id, message_id: mm.message_id, parse_mode: "HTML" });
  init_user_state(m.chat.id); user_states[m.chat.id].balance = res.money;
  bot.editMessageText(`
╔═════════════════════════════╗
║      ✅ ĐĂNG NHẬP THÀNH CÔNG ║
╟─────────────────────────────╢
║ 👤 Tài khoản: ${res.nickname.padEnd(17, ' ')}║
║ 💳 Số dư: ${res.money.toLocaleString().padStart(14, ' ')} ║
║ 📚 Đã học: ${GLOBAL_HISTORY.length.toString().padStart(12, ' ')} phiên ║
╚═════════════════════════════╝
  `, { chat_id: m.chat.id, message_id: mm.message_id, parse_mode: "Markdown" });
  start_socket(m.chat.id, res.token);
});

bot.onText(/^\/autobet(\s+.+)?$/, (m, mt) => {
  if (!is_vip(m.chat.id)) return;
  const c = m.chat.id; init_user_state(c);
  const p = (mt[1] || "").trim().split(/\s+/);
  if (p[0] === "on") {
    const amt = Math.max(1000, +p[1] || 10000);
    user_states[c].auto_bet_enabled = true; user_states[c].base_bet_amount = amt;
    bot.sendMessage(c, `
╔═════════════════════════════╗
║       ✅ AUTO ĐÃ BẬT!         ║
╟─────────────────────────────╢
║ 💸 Vốn cược gốc: ${amt.toLocaleString().padStart(12, ' ')} ║
║ ⚡ Tự động vào tiền theo AI  ║
╚═════════════════════════════╝
    `, { parse_mode: "Markdown" });
  } else {
    user_states[c].auto_bet_enabled = false;
    bot.sendMessage(c, `
╔═════════════════════════════╗
║       🔴 AUTO ĐÃ TẮT!         ║
╚═════════════════════════════╝
    `, { parse_mode: "Markdown" });
  }
});

bot.onText(/^\/x2\s*(on|off)?$/i, (m, mt) => {
  if (!is_vip(m.chat.id)) return;
  const c = m.chat.id; init_user_state(c);
  const is_on = (mt[1] || "").toLowerCase() === "on";
  user_states[c].x2_mode = is_on;
  bot.sendMessage(c, is_on ? `
╔═════════════════════════════╗
║       🔥 CHẾ ĐỘ X2 ĐÃ BẬT!    ║
║ ⚡ Nhồi tiền gấp đôi sau thắng║
╚═════════════════════════════╝
  ` : `
╔═════════════════════════════╗
║       🔴 CHẾ ĐỘ X2 ĐÃ TẮT!    ║
╚═════════════════════════════╝
  `, { parse_mode: "Markdown" });
});

bot.onText(/^\/chotlai\s+(\d+)$/, (m, mt) => {
  if (!is_vip(m.chat.id)) return;
  init_user_state(m.chat.id); const val = +mt[1];
  user_states[m.chat.id].target_profit = val;
  bot.sendMessage(m.chat.id, `
╔═════════════════════════════╗
║      🎯 ĐẶT MỤC TIÊU CHỐT LÃI ║
╟─────────────────────────────╢
║ ✅ Khi lãi đạt: ${val.toLocaleString().padStart(14, ' ')} ║
║ ⚡ Tự động tắt Auto an toàn  ║
╚═════════════════════════════╝
  `, { parse_mode: "Markdown" });
});

bot.onText(/^\/stoploss\s+(\d+)$/, (m, mt) => {
  if (!is_vip(m.chat.id)) return;
  init_user_state(m.chat.id); const val = +mt[1];
  user_states[m.chat.id].stop_loss = val;
  bot.sendMessage(m.chat.id, `
╔═════════════════════════════╗
║      🛑 ĐẶT NGƯỠNG CẮT LỖ     ║
╟─────────────────────────────╢
║ ✅ Khi lỗ đạt: ${val.toLocaleString().padStart(15, ' ')} ║
║ ⚡ Tự động tắt Auto bảo vệ vốn║
╚═════════════════════════════╝
  `, { parse_mode: "Markdown" });
});

bot.onText(/^\/stats$/, (m) => {
  if (!is_vip(m.chat.id)) return;
  const s = user_states[m.chat.id] || {};
  const acc = GLOBAL_PERFORMANCE.acc20.length ? (GLOBAL_PERFORMANCE.acc20.reduce((a,b)=>a+b,0)/20*100).toFixed(1) : "---";
  bot.sendMessage(m.chat.id, `
╔═════════════════════════════╗
║       📊 THỐNG KÊ TOÀN DIỆN   ║
╟─────────────────────────────╢
║ 💳 Số dư: ${(s.balance||0).toLocaleString().padStart(16, ' ')} ║
║ 📈 Lãi/Lỗ: ${(s.profit_loss||0).toLocaleString().padStart(16, ' ')} ║
║ 🎯 Chốt lãi: ${(s.target_profit||"Không").toString().padStart(15, ' ')} ║
║ 🛑 Cắt lỗ: ${(s.stop_loss||"Không").toString().padStart(16, ' ')} ║
║ 🤖 Auto: ${s.auto_bet_enabled ? "✅ BẬT" : "🔴 TẮT".padStart(18, ' ')} ║
║ 🔥 X2: ${s.x2_mode ? "✅ BẬT" : "🔴 TẮT".padStart(20, ' ')} ║
║ 🏆 Thắng liên tiếp: ${(s.win_streak||0).toString().padStart(12, ' ')} ║
║ 💔 Thua liên tiếp: ${(s.loss_streak||0).toString().padStart(12, ' ')} ║
║ 🧠 Độ chính xác: ${acc.padStart(14, ' ')}% ║
║ 📚 Đã học: ${GLOBAL_HISTORY.length.toString().padStart(14, ' ')} phiên ║
╚═════════════════════════════╝
  `, { parse_mode: "Markdown" });
});

bot.onText(/^\/weights$/, (m) => {
  if (!is_vip(m.chat.id)) return;
  const top = Object.entries(AI_WEIGHTS).sort((a,b)=>b[1]-a[1]).slice(10);
  let txt = `
╔═════════════════════════════╗
║   🧠 TRỌNG SỐ LÕI AI VIP      ║
║   TOP 10 LÕI MẠNH NHẤT        ║
╟─────────────────────────────╢
`;
  top.forEach(([k,v], i) => txt += `║ ${(i+1).toString().padStart(2, ' ')}. ${k.padEnd(15, ' ')} ${v.toFixed(2).padStart(5, ' ')} ║\n`);
  txt += `╚═════════════════════════════╝
  `;
  bot.sendMessage(m.chat.id, txt, { parse_mode: "Markdown" });
});

bot.onText(/^\/stop$/, (m) => {
  if (!is_vip(m.chat.id)) return;
  if (active_sockets[m.chat.id]) {
    active_sockets[m.chat.id].disconnect(); delete active_sockets[m.chat.id];
    bot.sendMessage(m.chat.id, `
╔═════════════════════════════╗
║      🔌 ĐÃ NGẮT KẾT NỐI!      ║
╚═════════════════════════════╝
    `, { parse_mode: "Markdown" });
  }
});

console.log("✅ THOR AI VIP PRO 4.0 – KHỞI ĐỘNG THÀNH CÔNG!");