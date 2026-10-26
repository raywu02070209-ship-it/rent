// 房客、屋主、管理員各自的額外功能。紀錄簿本體（index.html 裡的主程式）先載入，這裡接在它後面。
(function(){
const hub = window.__fbHub;
const $ = id => document.getElementById(id);
const E = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nowISO = () => new Date().toISOString();
const REQ_TYPE = { repair: "報修", purchase: "代購", assist: "其他協助" };
const REQ_STATUS = { new: "已送出，等待處理", todo: "已受理", doing: "處理中", done: "已完成", rejected: "不處理" };
const shortProp = p => String(p || "").replace(/^(台|臺)中市.{1,3}區/, "");
const unitLabel = u => `${shortProp(u.property)} ${u.room}`;
function afterRender(fn){ const orig = window.render; window.render = function(){ const r = orig.apply(this, arguments); try{ fn(); }catch(e){ console.error(e); } return r; }; }

hub.p.then(x => {
  if (!x) return;
  if (x.role === "tenant") initTenant(x.acc);
  else if (x.role === "owner"){ initOwner(x.acc); const go = () => (typeof units !== "undefined" && document.querySelector("nav.views")) ? (initOwnerMeter(x.acc), initRentView("owner", x.acc)) : setTimeout(go, 50); go(); }
  else { initAdmin(); const go = () => (typeof db !== "undefined" && db && typeof units !== "undefined") ? (initMeter(), initRentView("admin")) : setTimeout(go, 50); go(); }
});

// 照片壓縮：最長邊 1600px，JPEG
async function shrink(file){
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  return await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85));
}

/* ======================= 房客 ======================= */
function initTenant(acc){
  const rooms = acc.rooms || {};
  const ids = acc.unitIds || [];
  const box = document.createElement("div"); box.className = "tp"; box.id = "tenantApp";
  box.innerHTML = `
    <div class="tp-head"><img src="icon.png" alt=""><div><h1>房客服務</h1><p>${E(acc.name || "")}${ids.length ? "・" + ids.map(i => E(rooms[i] || "")).join("、") : ""}</p></div></div>
    <section class="tp-card" id="tpContracts" hidden></section>
    <section class="tp-card" id="tpMeter"><h2>電費紀錄</h2><p class="tp-hint">載入中…</p></section>
    <section class="tp-card">
      <h2>報修／代購／協助申請</h2>
      <form id="tpForm" novalidate>
        ${ids.length > 1 ? `<label class="tp-f"><span>房號</span><select id="tpUnit">${ids.map(i => `<option value="${E(i)}">${E(rooms[i] || i)}</option>`).join("")}</select></label>` : ""}
        <div class="tp-f"><span>申請類型</span><div class="tp-seg">${Object.entries(REQ_TYPE).map(([k, v], i) => `<label><input type="radio" name="tpType" value="${k}" ${i ? "" : "checked"}><span>${v}</span></label>`).join("")}</div></div>
        <label class="tp-f"><span>狀況說明 *</span><textarea id="tpDesc" rows="4" placeholder="例：浴室水龍頭一直滴水；想請幫忙代購延長線"></textarea></label>
        <label class="tp-f"><span>方便處理的時間</span><input id="tpWhen" placeholder="例：平日晚上 7 點後"></label>
        <label class="tp-f"><span>聯絡電話 *</span><input id="tpPhone" inputmode="tel" value="${E(acc.phone || "")}"></label>
        <div class="tp-f"><span>照片（最多 3 張，選填）</span>
          <div class="tp-photos" id="tpPhotos"></div>
          <label class="tp-btn">＋ 拍照或選照片<input type="file" id="tpFile" accept="image/*" multiple></label></div>
        <p class="tp-err" id="tpErr" hidden></p>
        <button type="submit" class="tp-primary" id="tpSend">送出申請</button>
        <p class="tp-hint" id="tpEmerg">漏水、停電、門鎖故障等緊急狀況，請直接打電話給管理人。</p>
      </form>
    </section>
    <section class="tp-card"><h2>我的申請紀錄</h2><div id="tpList"><p class="tp-hint">載入中…</p></div></section>`;
  document.body.appendChild(box);

  // 管理人電話
  const showAgent = () => { const a = window.agentCfg || (typeof agentCfg !== "undefined" ? agentCfg : {}); const h = $("tpEmerg"); if (a && a.phone && h) h.textContent = `漏水、停電、門鎖故障等緊急狀況，請直接打電話給管理人${a.name ? " " + a.name : ""}：${a.phone}`; };

  // 照片
  let photos = [];
  const drawPhotos = () => { $("tpPhotos").innerHTML = photos.map((p, i) => `<span class="tp-ph"><img src="${p.url}" alt="照片 ${i + 1}"><button type="button" data-rm="${i}" aria-label="移除照片">✕</button></span>`).join(""); };
  $("tpFile").onchange = async e => {
    const fs = [...e.target.files]; e.target.value = "";
    for (const f of fs){ if (photos.length >= 3) break; try{ const b = await shrink(f); photos.push({ blob: b, url: URL.createObjectURL(b) }); }catch(_){} }
    drawPhotos();
  };
  $("tpPhotos").onclick = e => { const b = e.target.closest("[data-rm]"); if (!b) return; URL.revokeObjectURL(photos[+b.dataset.rm].url); photos.splice(+b.dataset.rm, 1); drawPhotos(); };

  $("tpForm").onsubmit = async e => {
    e.preventDefault();
    const err = m => { $("tpErr").textContent = m; $("tpErr").hidden = !m; };
    const unitId = $("tpUnit") ? $("tpUnit").value : ids[0];
    const desc = $("tpDesc").value.trim(), phone = $("tpPhone").value.trim();
    if (!unitId) return err("你的帳號還沒有設定房號，請聯絡管理人。");
    if (!desc) return err("請填寫狀況說明。");
    if (!phone) return err("請填寫聯絡電話。");
    err(""); const btn = $("tpSend"); btn.disabled = true; btn.textContent = "送出中…";
    try{
      const urls = [];
      for (const p of photos) urls.push((await window.__fb.upload(p.blob, { type: "image/jpeg" })).id);
      const label = rooms[unitId] || "";
      await window.__fb.addDoc("requests", { uid: window.__uid, email: (window.__acc && window.__acc.email) || "", unitId, room: label, name: acc.name || "",
        phone, type: document.querySelector("input[name=tpType]:checked").value, desc, when: $("tpWhen").value.trim(), photos: urls, status: "new", createdAt: nowISO() });
      photos.forEach(p => URL.revokeObjectURL(p.url)); photos = []; drawPhotos();
      $("tpDesc").value = ""; $("tpWhen").value = "";
      toast("已送出，管理人會盡快與你聯繫");
    }catch(e2){ err("送出失敗，請檢查網路後再試一次。"); }
    finally{ btn.disabled = false; btn.textContent = "送出申請"; }
  };

  // 申請紀錄
  window.__fb.watch("requests", list => {
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    $("tpList").innerHTML = list.length ? list.map(r => `<div class="tp-req">
      <div class="tp-req-h"><span class="tp-chip">${E(REQ_TYPE[r.type] || "申請")}</span><span class="tp-st st-${E(r.status)}">${E(REQ_STATUS[r.status] || r.status)}</span></div>
      <p>${E(r.desc)}</p><small>${E(zhDate(String(r.createdAt).slice(0, 10)))}${r.room ? "・" + E(r.room) : ""}</small></div>`).join("")
      : `<p class="tp-hint">還沒有申請紀錄。</p>`;
  }, [["uid", "==", window.__uid]]);

  // 續約合約
  const drawContracts = () => {
    showAgent();
    const cs = (typeof contracts !== "undefined" ? contracts : []).filter(c => c.shareTenant);
    const el = $("tpContracts"); el.hidden = !cs.length;
    cs.sort((a, b) => (a.status === "signed") - (b.status === "signed") || String(b.leaseStart).localeCompare(String(a.leaseStart)));
    el.innerHTML = `<h2>我的合約</h2>` + cs.map(c => {
      const head = `<p><b>${E(c.room)}</b>　租期 ${E(zhDate(c.leaseStart))} 至 ${E(zhDate(c.leaseEnd))}<br>月租 ${E(money(c.rent))}・押金 ${E(money(c.deposit))}</p>`;
      if (c.status === "draft") return `<div class="tp-con">${head}<p class="tp-hint">管理人已準備好續約合約，請先閱讀內容，確認無誤後簽名送出。</p>
        <div class="tp-row"><button type="button" data-tprev="${E(c.id)}">先預覽合約</button><button type="button" class="tp-primary" data-tsign="${E(c.id)}">閱讀並簽署</button></div></div>`;
      if (c.status === "tenantSigned") return `<div class="tp-con">${head}<p class="tp-ok">已送出簽名，等待管理人確認完成。</p></div>`;
      if (c.status === "signed") return `<div class="tp-con">${head}<p class="tp-ok">合約已生效${c.signedVia === "tenant" ? "（線上續約完成）" : ""}。</p><p class="tp-hint">需要紙本的話，按「下載合約 PDF」存到手機，再自行列印。</p><div class="tp-row"><button type="button" data-tview="${E(c.id)}">${c.signedPdf ? "檢視條款" : "檢視合約"}</button><button type="button" class="tp-primary" data-tpdf="${E(c.id)}">下載合約 PDF</button></div></div>`;
      return "";
    }).join("");
  };
  afterRender(drawContracts);
  $("tpContracts").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    const id = b.dataset.tprev || b.dataset.tsign || b.dataset.tview || b.dataset.tpdf;
    const c = contracts.find(x => x.id === id); if (!c) return;
    if (b.dataset.tprev) openDoc(c, true);
    else if (b.dataset.tsign) startSigning(c);
    else if (b.dataset.tview) openDoc(c);
    else if (b.dataset.tpdf) c.signedPdf ? downloadSigned(c, b) : contractPDF(c, b);
  };

  // 電費紀錄（管理人抄表後自動出現）
  { const fmtN = n => n == null ? "—" : (Math.round(n * 10) / 10).toLocaleString("zh-TW");
    const line = r => r.mode === "split"
      ? `110V ${fmtN(r.prev && r.prev.r110)} → ${fmtN(r.cur && r.cur.r110)}・220V ${fmtN(r.prev && r.prev.r220)} → ${fmtN(r.cur && r.cur.r220)}`
      : `${fmtN(r.prev && r.prev.r)} → ${fmtN(r.cur && r.cur.r)}`;
    const parts = [];
    const drawMeter = () => {
      const l = parts.flat().sort((a, b) => String(b.date + b.createdAt).localeCompare(String(a.date + a.createdAt))).slice(0, 24);
      const el = $("tpMeter"); el.hidden = false;
      el.innerHTML = `<h2>電費紀錄</h2>` + (l.length ? "" : `<p class="tp-hint">目前還沒有電費紀錄。管理人抄完電表後，度數和電費會出現在這裡。</p>`) + l.map(r => `<div class="tp-req">
        <div class="tp-req-h"><span class="tp-chip">${E(zhDate(r.date))}</span><span class="tp-st ${r.paid ? "st-done" : "st-todo"}">${r.paid ? "已繳" : "待繳"}</span></div>
        <p>${ids.length > 1 ? E(r.room) + "　" : ""}${E(line(r))}</p><p><b>${fmtN(r.kwh)} 度 × ${E(r.rate)} 元 = ${money(r.amount)}</b></p></div>`).join("");
    };
    for (let i = 0; i < ids.length; i += 30){ const k = parts.length; parts.push([]);
      window.__fb.watch("meterReads", l => { parts[k] = l; drawMeter(); }, [["unitId", "in", ids.slice(i, i + 30)], ["shareTenant", "==", true]]); }
    if (!ids.length) drawMeter();
  }
  tenantRentSection(ids, acc);

  { const s3 = document.querySelector('#signSteps span[data-s="3"]'); if (s3) s3.textContent = "3 確認送出"; }
  // 簽完名後的確認送出（取代代理人步驟）
  window.__tenantStep3 = b => {
    const c = S.c;
    b.innerHTML = `<h2>確認送出</h2>
      <p class="lead">簽名已完成。送出後，管理人會確認並完成續約，完成後你可以在這裡下載合約。</p>
      <div class="ack"><input type="checkbox" id="tAck"><label for="tAck">我已詳細閱讀合約內容並同意簽署。</label></div>
      <p class="err" id="sErr" hidden></p>
      <div class="nextbar"><button type="button" id="tBack">上一步</button><button type="button" class="primary" id="tSend">送出簽名</button></div>`;
    $("tBack").onclick = () => { S.step = 2; drawStep(); };
    $("tSend").onclick = async () => {
      const err = m => { $("sErr").textContent = m; $("sErr").hidden = false; };
      if (!$("tAck").checked) return err("請勾選確認後再送出。");
      const btn = $("tSend"); btn.disabled = true; btn.textContent = "送出中…";
      let stage = "上傳簽名與證件照片";
      try{
        const up = async (key, blob) => { if (!S.up[key]) S.up[key] = (await assets.upload(blob, { type: blob.type || "image/png" })).id; return S.up[key]; };
        const sigs = { tenant: await up("sig_tenant", dataURLtoBlob(S.sig.tenant)) };
        if (c.hasCoTenant) sigs.tenant2 = await up("sig_tenant2", dataURLtoBlob(S.sig.tenant2));
        if (c.hasGuarantor) sigs.guarantor = await up("sig_guarantor", dataURLtoBlob(S.sig.guarantor));
        let idPhotos;
        if (S.useOldIds) idPhotos = S.reuseIds.slice();
        else { idPhotos = [await up("id_front", S.photos.front), await up("id_back", S.photos.back)];
          if (c.hasCoTenant) idPhotos.push(await up("id_front2", S.photos.front2), await up("id_back2", S.photos.back2)); }
        const now = nowISO(); stage = "儲存合約";
        await ccol.doc(c.id).update({ tenant: c.tenant, tenant2: c.hasCoTenant ? c.tenant2 : {}, guarantor: c.hasGuarantor ? c.guarantor : {}, cleaning: c.cleaning,
          stamps: c.stamps, sigs, idPhotos, actualStamps: c.actual || {}, status: "tenantSigned", tenantSignedAt: now, updatedAt: now });
        Object.values(S.previews).forEach(u => URL.revokeObjectURL(u)); S = null;
        $("signWrap").hidden = true; document.body.style.overflow = "";
        toast("已送出簽名，管理人確認後就完成續約");
      }catch(e){ btn.disabled = false; btn.textContent = "送出簽名"; console.warn(e);
        const code = String((e && (e.code || e.message)) || "").replace(/^storage\//, "");
        err(`送出失敗（${stage}：${code === "invalid_argument" || /unauthorized|permission/.test(code) ? "沒有權限" : code === "unavailable" ? "網路不穩" : code || "未知錯誤"}）。請截圖給管理人，或稍後再按一次。`); }
    };
  };
}

/* ======================= 屋主 ======================= */
function initOwner(acc){
  const sub = document.querySelector("header .sub");
  if (sub) sub.textContent = `${acc.name || "屋主"} 您好，這裡可以查看您名下房間的租約、合約、維修代墊與電表度數紀錄（僅供閱覽）。`;
  const h = document.querySelector("#viewContracts > .hint"); if (h) h.textContent = "這裡列出您名下房間已完成的租賃合約，可檢視或下載 PDF。";
}

/* ======================= 屋主：電表度數（唯讀） ======================= */
function initOwnerMeter(acc){
  const ids = acc.unitIds || []; let reads = [];
  const fmtN = n => n == null ? "—" : (Math.round(n * 10) / 10).toLocaleString("zh-TW");
  const tab = document.createElement("button"); tab.type = "button"; tab.role = "tab"; tab.id = "vMeter"; tab.dataset.view = "meter"; tab.setAttribute("aria-selected", "false"); tab.textContent = "電表";
  document.querySelector("nav.views").appendChild(tab);
  const view = document.createElement("div"); view.className = "view"; view.id = "viewMeter"; view.hidden = true;
  $("viewContracts").after(view);
  const origSetView = window.setView;
  window.setView = function(v){ origSetView(v); view.hidden = v !== "meter"; tab.setAttribute("aria-selected", v === "meter"); if (v === "meter") draw(); };
  tab.onclick = () => window.setView("meter");
  const line = r => r.mode === "split"
    ? `110V ${fmtN(r.prev && r.prev.r110)} → ${fmtN(r.cur && r.cur.r110)}・220V ${fmtN(r.prev && r.prev.r220)} → ${fmtN(r.cur && r.cur.r220)}`
    : `${fmtN(r.prev && r.prev.r)} → ${fmtN(r.cur && r.cur.r)}`;
  function draw(){
    if (view.hidden) return;
    const us = units.filter(u => ids.includes(u.id)).sort((a, b) => String(a.property).localeCompare(String(b.property)) || String(a.room).localeCompare(String(b.room), "zh-Hant", { numeric: true }));
    const byUnit = u => reads.filter(r => r.unitId === u.id).sort((a, b) => String(b.date + b.createdAt).localeCompare(String(a.date + a.createdAt)));
    const withReads = us.filter(u => byUnit(u).length);
    view.innerHTML = `<div class="mt-owner"><p class="hint">這裡是管理人每次抄電表的度數與電費（僅供閱覽）。</p>` + (withReads.length ? withReads.map(u => `<section class="mt-hist"><h3>${E(u.property)}　${E(u.room)}</h3>${byUnit(u).map(r => `<div class="mt-hrow mt-om">
        <div class="mt-oh"><span>${E(zhDate(r.date))}</span>${r.tenant ? `<span>${E(r.tenant)}</span>` : ""}</div>
        <div class="mt-ol">${E(line(r))}</div>
        <div><b class="mt-ok">${fmtN(r.kwh)} 度 × ${E(r.rate)} 元 = ${money(r.amount)}</b></div></div>`).join("")}</section>`).join("")
      : `<section class="mt-hist"><p class="tp-hint">目前還沒有抄表紀錄。</p></section>`) + `</div>`;
  }
  const parts = [];
  for (let i = 0; i < ids.length; i += 30){
    const k = parts.length; parts.push([]);
    window.__fb.watch("meterReads", l => { parts[k] = l; reads = parts.flat(); draw(); }, [["unitId", "in", ids.slice(i, i + 30)]]);
  }
  afterRender(draw);
  try{ if (localStorage.getItem("rl-view") === "meter") window.setView("meter"); }catch(_){}
}

/* ======================= 租金收款 ======================= */
const RENT_WAYS = ["轉帳", "現金", "LINE Pay", "街口", "其他"];
const ymOf = d => String(d || "").slice(0, 7);
const ymAdd = (ym, n) => { let [y, m] = ym.split("-").map(Number); m += n; while (m > 12){ m -= 12; y++; } while (m < 1){ m += 12; y--; } return `${y}-${String(m).padStart(2, "0")}`; };
const ymZh = ym => { const [y, m] = String(ym).split("-").map(Number); return y ? `${y}年${m}月` : ""; };
const payDayNum = u => { const m = String(u.payDay || "").match(/\d+/); return m ? Math.min(31, +m[0]) : 5; };
const monthsZh = l => { const a = [...(l || [])].sort(); if (!a.length) return ""; return a.length === 1 ? ymZh(a[0]) : `${ymZh(a[0])}～${ymZh(a[a.length - 1])}（${a.length} 個月）`; };

// 房客：自己回報繳租（上傳轉帳截圖、選是哪幾期），管理人確認
function tenantRentSection(ids, acc){
  const el = document.createElement("section"); el.className = "tp-card"; el.id = "tpRent";
  const m = $("tpMeter"); (m || $("tpContracts")).after(el);
  const rooms = acc.rooms || {}, rents = acc.rents || {};
  let mine = [], shared = [], unitId = ids[0] || "", photo = null, picked = new Set();
  const all = () => { const map = new Map(); [...shared, ...mine].forEach(p => map.set(p.id, p)); return [...map.values()]; };
  const ST = { pending: ["待管理人確認", "st-todo"], rejected: ["已退回", "st-rejected"], ok: ["已確認收款", "st-done"] };
  const stOf = p => p.status === "pending" ? "pending" : p.status === "rejected" ? "rejected" : "ok";
  const monthState = (uid, ym) => { const l = all().filter(p => p.unitId === uid && (p.months || []).includes(ym) && stOf(p) !== "rejected"); return l.some(p => stOf(p) === "ok") ? "ok" : l.length ? "pending" : ""; };
  const rentOf = uid => +(rents[uid] && rents[uid].rent) || 0;
  function draw(){
    const keep = el.querySelector("#trAmt") ? { amt: $("trAmt").value, date: $("trDate").value, way: $("trWay").value, note: $("trNote").value } : null;
    const cur = ymOf(today()), opts = Array.from({ length: 8 }, (_, i) => ymAdd(cur, i - 3));
    const list = all().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 24);
    el.innerHTML = `<h2>租金繳費</h2>
      <p class="tp-hint">繳完租金後，在這裡選是哪幾期、上傳轉帳截圖送出，管理人確認後會顯示「已確認收款」。</p>
      ${ids.length > 1 ? `<label class="tp-f"><span>房號</span><select id="trUnit">${ids.map(i => `<option value="${E(i)}" ${i === unitId ? "selected" : ""}>${E(rooms[i] || i)}</option>`).join("")}</select></label>` : ""}
      <div class="tp-f"><span>繳的是哪幾期 *（可複選）</span><div class="tr-months">${opts.map(o => { const st = monthState(unitId, o);
        return `<label class="${st ? "dis" : ""}"><input type="checkbox" value="${o}" ${st ? "disabled" : picked.has(o) ? "checked" : ""}><span>${E(ymZh(o))}${st === "ok" ? "<small>已繳</small>" : st === "pending" ? "<small>確認中</small>" : ""}</span></label>`; }).join("")}</div></div>
      <div class="tr-grid">
        <label class="tp-f"><span>金額（元）*</span><input id="trAmt" inputmode="numeric" placeholder="${rentOf(unitId) ? "月租 " + rentOf(unitId) : "例：12000"}"></label>
        <label class="tp-f"><span>繳款日期 *</span><input id="trDate" type="date" value="${E(today())}"></label>
        <label class="tp-f"><span>方式</span><select id="trWay">${RENT_WAYS.map(w => `<option>${w}</option>`).join("")}</select></label>
        <label class="tp-f"><span>帳號末五碼／備註</span><input id="trNote" placeholder="選填"></label>
      </div>
      <div class="tp-f"><span>轉帳或收據截圖 *</span>
        <div class="tp-photos">${photo ? `<span class="tp-ph"><img src="${photo.url}" alt="繳費截圖"><button type="button" id="trRm" aria-label="移除截圖">✕</button></span>` : ""}</div>
        ${photo ? "" : `<label class="tp-btn">＋ 上傳截圖或拍照<input type="file" id="trFile" accept="image/*"></label>`}</div>
      <p class="tp-err" id="trErr" hidden></p>
      <button type="button" class="tp-primary" id="trSend">送出繳費紀錄</button>
      <h3 class="tr-h3">我的繳費紀錄</h3>
      ${list.length ? list.map(p => { const [t, c] = ST[stOf(p)]; return `<div class="tp-req">
        <div class="tp-req-h"><span class="tp-chip">${E(monthsZh(p.months))}</span><span class="tp-st ${c}">${t}</span></div>
        <p><b>${money(p.amount)}</b>　${E(p.method || "")}・${E(zhDate(p.date))}${ids.length > 1 ? "・" + E(rooms[p.unitId] || p.room || "") : ""}</p>
        ${stOf(p) === "rejected" && p.rejectNote ? `<small>退回原因：${E(p.rejectNote)}</small>` : ""}</div>`; }).join("") : `<p class="tp-hint">還沒有繳費紀錄。</p>`}`;
    if (keep){ $("trAmt").value = keep.amt; $("trDate").value = keep.date; $("trWay").value = keep.way; $("trNote").value = keep.note; }
    if (!$("trAmt").value && picked.size && rentOf(unitId)) $("trAmt").value = rentOf(unitId) * picked.size;
  }
  el.addEventListener("change", async e => {
    if (e.target.id === "trUnit"){ unitId = e.target.value; picked.clear(); draw(); return; }
    if (e.target.matches(".tr-months input")){ e.target.checked ? picked.add(e.target.value) : picked.delete(e.target.value);
      if (rentOf(unitId)) $("trAmt").value = picked.size ? rentOf(unitId) * picked.size : ""; return; }
    if (e.target.id === "trFile"){ const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      try{ const b = await shrink(f); photo = { blob: b, url: URL.createObjectURL(b) }; }catch(_){ toast("這張圖片讀不到，請換一張"); } draw(); }
  });
  el.addEventListener("click", async e => {
    if (e.target.closest("#trRm")){ URL.revokeObjectURL(photo.url); photo = null; draw(); return; }
    if (!e.target.closest("#trSend")) return;
    const err = m => { $("trErr").textContent = m; $("trErr").hidden = !m; };
    const months = [...picked].sort(), amount = Math.round(+String($("trAmt").value).replace(/[,\s$]/g, "") || 0);
    if (!unitId) return err("你的帳號還沒有設定房號，請聯絡管理人。");
    if (!months.length) return err("請勾選這次繳的是哪幾期。");
    if (!(amount > 0)) return err("請填金額。");
    if (!$("trDate").value) return err("請選繳款日期。");
    if (!photo) return err("請上傳轉帳或收據截圖。");
    err(""); const btn = $("trSend"); btn.disabled = true; btn.textContent = "送出中…";
    try{
      const proof = (await window.__fb.upload(photo.blob, { type: "image/jpeg" })).id;
      await window.__fb.addDoc("rentPays", { unitId, room: rooms[unitId] || "", tenant: acc.name || "", uid: window.__uid, email: (window.__acc && window.__acc.email) || "",
        months, month: months[0], amount, date: $("trDate").value, method: $("trWay").value, note: $("trNote").value.trim(), proof,
        status: "pending", shareTenant: true, createdAt: nowISO() });
      URL.revokeObjectURL(photo.url); photo = null; picked.clear(); $("trAmt").value = ""; $("trNote").value = ""; draw();
      toast("已送出，管理人確認後會顯示「已確認收款」");
    }catch(e2){ console.warn(e2); err("送出失敗，請檢查網路後再試一次。"); }
    finally{ const b2 = $("trSend"); if (b2){ b2.disabled = false; b2.textContent = "送出繳費紀錄"; } }
  });
  for (let i = 0; i < ids.length; i += 30){
    const chunk = ids.slice(i, i + 30), k = i / 30;
    window.__fb.watch("rentPays", l => { shared = shared.filter(p => !chunk.includes(p.unitId)).concat(l); draw(); }, [["unitId", "in", chunk], ["shareTenant", "==", true]]);
  }
  const mineParts = [];
  for (let i = 0; i < ids.length; i += 30){ const k = mineParts.length; mineParts.push([]);
    window.__fb.watch("rentPays", l => { mineParts[k] = l; mine = mineParts.flat(); draw(); }, [["unitId", "in", ids.slice(i, i + 30)], ["uid", "==", window.__uid]]); }
  draw();
}

function initRentView(mode, acc){
  const admin = mode === "admin", ownIds = admin ? null : (acc.unitIds || []);
  let pays = [], ym = ymOf(today()), propFilter = "", openUid = null, delArm = null;
  const tab = document.createElement("button"); tab.type = "button"; tab.role = "tab"; tab.id = "vRent"; tab.dataset.view = "rent"; tab.setAttribute("aria-selected", "false"); tab.textContent = "租金";
  const nav = document.querySelector("nav.views"); $("vMeter") ? nav.insertBefore(tab, $("vMeter")) : nav.appendChild(tab);
  const view = document.createElement("div"); view.className = "view"; view.id = "viewRent"; view.hidden = true;
  $("viewContracts").after(view);
  const origSetView = window.setView;
  window.setView = function(v){ origSetView(v); view.hidden = v !== "rent"; tab.setAttribute("aria-selected", v === "rent"); if (v === "rent") draw(); };
  tab.onclick = () => window.setView("rent");

  const myUnits = () => units.filter(u => admin || ownIds.includes(u.id));
  const okPay = p => p.status !== "pending" && p.status !== "rejected";
  const paidFor = (u, m) => pays.filter(p => okPay(p) && p.unitId === u.id && (p.months || []).includes(m));
  const pendFor = (u, m) => pays.filter(p => p.status === "pending" && p.unitId === u.id && (p.months || []).includes(m));
  // 這個月要收租的房間：有房客、有月租，而且租期涵蓋這個月
  const dueUnits = m => myUnits().filter(u => u.tenant && +u.rent > 0 && (!u.leaseStart || ymOf(u.leaseStart) <= m) && (!u.leaseEnd || ymOf(u.leaseEnd) >= m));
  const sortU = us => us.sort((a, b) => String(a.property).localeCompare(String(b.property)) || String(a.room).localeCompare(String(b.room), "zh-Hant", { numeric: true }));

  function draw(){
    if (view.hidden) return;
    const keepForm = openUid && view.querySelector(".rt-form") ? [...view.querySelectorAll(".rt-form [data-k]")].map(i => [i.dataset.k, i.value]) : null;
    const all = sortU(dueUnits(ym)), ps = [...new Set(all.map(u => u.property))];
    if (propFilter && !ps.includes(propFilter)) propFilter = "";
    const list = all.filter(u => !propFilter || u.property === propFilter);
    const t = today(), late = u => !paidFor(u, ym).length && (ym < ymOf(t) || (ym === ymOf(t) && +t.slice(8) > payDayNum(u)));
    const due = list.reduce((a, u) => a + (+u.rent || 0), 0), got = list.filter(u => paidFor(u, ym).length).reduce((a, u) => a + (+u.rent || 0), 0);
    const unpaid = list.filter(u => !paidFor(u, ym).length), lateN = list.filter(late).length;
    view.innerHTML = `
      <div class="rt-top">
        <div class="rt-mon"><button type="button" data-mv="-1" aria-label="上個月">‹</button><input type="month" id="rtMonth" value="${E(ym)}"><button type="button" data-mv="1" aria-label="下個月">›</button></div>
        ${ps.length > 1 ? `<select id="rtProp"><option value="">全部物件</option>${ps.map(p => `<option ${p === propFilter ? "selected" : ""}>${E(p)}</option>`).join("")}</select>` : ""}
      </div>
      <div class="rt-sum">
        <div><small>應收</small><b>${money(due)}</b><small>${list.length} 間</small></div>
        <div><small>已收</small><b class="ok">${money(got)}</b><small>${list.length - unpaid.length} 間</small></div>
        <div><small>未收</small><b class="${unpaid.length ? "bad" : ""}">${money(due - got)}</b><small>${unpaid.length} 間${lateN ? `・逾期 ${lateN}` : ""}</small></div>
      </div>
      ${admin && pendAll().length ? `<div class="rt-alert"><b>房客回報已繳租，等你確認（${pendAll().length} 筆）</b>${pendAll().map(p => `<div class="sgn-row"><span>${E((u => u ? unitLabel(u) : p.room)(units.find(x => x.id === p.unitId)))}・${E(monthsZh(p.months))}・${money(p.amount)}</span><button type="button" data-rtgo="${E(p.months[0])}">前往確認</button></div>`).join("")}</div>` : ""}
      ${admin ? `<p class="hint">房客繳租後，在那間房按「記錄收款」。一次繳好幾個月的，選「繳了幾個月」就會一起標記。</p>` : `<p class="hint">管理人記錄的每月租金收款狀況（僅供閱覽）。</p>`}
      <section class="rt-list">${list.length ? list.map(u => rowHTML(u, late(u))).join("") : `<p class="hint">這個月沒有需要收租的房間。</p>`}</section>
      <section class="mt-hist rt-hist"><h3>最近收款紀錄</h3>${histHTML()}</section>`;
    if (keepForm && view.querySelector(".rt-form")) keepForm.forEach(([k, v]) => { const i = view.querySelector(`.rt-form [data-k="${k}"]`); if (i) i.value = v; });
  }
  function rowHTML(u, isLate){
    const ps = paidFor(u, ym), d = payDayNum(u);
    const pd = ps.length ? [] : pendFor(u, ym);
    const st = ps.length ? `<span class="rt-st ok">已收</span>` : pd.length ? `<span class="rt-st pend">房客回報已繳</span>` : isLate ? `<span class="rt-st bad">逾期未收</span>` : `<span class="rt-st">未收</span>`;
    const info = ps.length ? ps.map(p => `<small>${E(zhDate(p.date))} ${E(p.method || "")} ${money(p.amount)}${(p.months || []).length > 1 ? `（${E(monthsZh(p.months))}）` : ""}${p.note ? "・" + E(p.note) : ""}</small>`).join("") : `<small>每月 ${d} 號繳</small>`;
    let act = "";
    if (admin){
      if (ps.length) act = ps.map(p => `<button type="button" class="danger ${delArm === p.id ? "solid" : ""}" data-rtdel="${E(p.id)}">${delArm === p.id ? "確定取消這筆？" : "取消收款"}</button>`).join("");
      else if (pd.length) act = "";
      else act = `<button type="button" data-rtcopy="${E(u.id)}">複製催繳</button><button type="button" class="primary" data-rtopen="${E(u.id)}">記錄收款</button>`;
    }
    const form = admin && openUid === u.id && !ps.length ? `<div class="rt-form">
        <label><small>收款日期</small><input type="date" data-k="date" value="${E(today())}"></label>
        <label><small>繳了幾個月</small><select data-k="n">${[1,2,3,4,5,6,12].map(n => `<option value="${n}" ${n === (+u.payMonths || 1) ? "selected" : ""}>${n} 個月</option>`).join("")}</select></label>
        <label><small>金額（元）</small><input data-k="amount" inputmode="numeric" value="${E(+u.rent || "")}"></label>
        <label><small>方式</small><select data-k="method">${RENT_WAYS.map(w => `<option>${w}</option>`).join("")}</select></label>
        <label class="wide"><small>備註（選填）</small><input data-k="note" placeholder="例：轉帳末五碼 12345"></label>
        <div class="rt-fa"><button type="button" data-rtcancel="1">取消</button><button type="button" class="primary" data-rtsave="${E(u.id)}">儲存</button></div>
      </div>` : "";
    return `<div class="rt-row${ps.length ? " paid" : ""}" data-uid="${E(u.id)}">
      <div class="rt-h"><b>${E(u.room)}</b><span>${E(u.tenant)}${E(u.honor || "")}</span>${st}</div>
      <div class="rt-d"><span>${E(shortProp(u.property))}・月租 ${money(u.rent)}</span>${info}</div>
      ${admin ? pd.map(pendHTML).join("") : ""}
      ${act ? `<div class="rt-a">${act}</div>` : ""}${form}</div>`;
  }
  // 房客回報的繳費：看截圖後確認或退回
  function pendHTML(p){
    return `<div class="rt-pend">
      ${p.proof ? `<a href="${E(p.proof)}" target="_blank" rel="noopener"><img src="${E(p.proof)}" alt="房客上傳的繳費截圖"></a>` : ""}
      <div class="rt-pi"><b>房客回報：${E(monthsZh(p.months))}</b><span>${money(p.amount)}　${E(p.method || "")}・${E(zhDate(p.date))}</span>${p.note ? `<small>${E(p.note)}</small>` : ""}<small>送出時間 ${E(String(p.createdAt).slice(0, 16).replace("T", " "))}</small>
        <div class="rt-a"><button type="button" data-rtrej="${E(p.id)}">退回</button><button type="button" class="primary" data-rtok="${E(p.id)}">確認收到</button></div></div></div>`;
  }
  function pendAll(){ return pays.filter(p => p.status === "pending").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))); }
  function badge(){ const n = admin ? pendAll().length : 0; tab.innerHTML = "租金" + (n ? `<span class="rt-badge">${n}</span>` : ""); }
  function histHTML(){
    const l = pays.filter(p => okPay(p) && (admin || ownIds.includes(p.unitId))).sort((a, b) => String(b.date + b.createdAt).localeCompare(String(a.date + a.createdAt))).slice(0, 30);
    return l.length ? l.map(p => `<div class="mt-hrow mt-om"><div class="mt-oh"><span>${E(zhDate(p.date))}</span><span>${E(shortProp(p.property))} ${E(p.room)}</span><span>${E(p.tenant || "")}</span></div>
      <div class="mt-ol">${E(monthsZh(p.months))}　<b class="mt-ok">${money(p.amount)}</b>　${E(p.method || "")}${p.note ? "・" + E(p.note) : ""}</div></div>`).join("") : `<p class="hint">還沒有收款紀錄。</p>`;
  }
  view.addEventListener("change", e => {
    if (e.target.id === "rtMonth" && e.target.value){ ym = e.target.value; openUid = null; draw(); }
    else if (e.target.id === "rtProp"){ propFilter = e.target.value; draw(); }
    else if (e.target.dataset.k === "n"){ const f = e.target.closest(".rt-form"), u = units.find(x => x.id === f.closest(".rt-row").dataset.uid); f.querySelector('[data-k="amount"]').value = (+u.rent || 0) * +e.target.value; }
  });
  view.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.mv){ ym = ymAdd(ym, +b.dataset.mv); openUid = null; draw(); return; }
    if (!admin) return;
    if (b.dataset.rtgo){ ym = b.dataset.rtgo; openUid = null; draw(); const r = view.querySelector(".rt-pend"); if (r) r.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    if (b.dataset.rtok){ b.disabled = true;
      try{ const p = pays.find(x => x.id === b.dataset.rtok), u = units.find(x => x.id === p.unitId) || {};
        await window.__fb.setDoc("rentPays/" + p.id, { status: "ok", confirmedAt: nowISO(), property: p.property || u.property || "", room: u.room || p.room }, true); toast("已確認收款，房客那邊會顯示「已確認收款」"); }
      catch(_){ b.disabled = false; toast("沒有成功，請再試一次"); } return; }
    if (b.dataset.rtrej){ const why = prompt("退回原因（房客會看到，可留空）", "金額或期數不符，請確認後重新送出");
      if (why === null) return; b.disabled = true;
      try{ await window.__fb.setDoc("rentPays/" + b.dataset.rtrej, { status: "rejected", rejectNote: why.trim(), rejectedAt: nowISO() }, true); toast("已退回"); }
      catch(_){ b.disabled = false; toast("沒有成功，請再試一次"); } return; }
    if (b.dataset.rtopen){ openUid = b.dataset.rtopen; draw(); const i = view.querySelector('.rt-form [data-k="amount"]'); if (i) i.scrollIntoView({ block: "center" }); return; }
    if (b.dataset.rtcancel){ openUid = null; draw(); return; }
    if (b.dataset.rtcopy){
      const u = units.find(x => x.id === b.dataset.rtcopy), a = window.agentCfg || (typeof agentCfg !== "undefined" ? agentCfg : {});
      const msg = `【租金提醒】${u.property} ${u.room} ${u.tenant}${u.honor || ""}您好，${ymZh(ym)}租金 ${money(u.rent)} 尚未收到，繳租日為每月 ${payDayNum(u)} 號，麻煩撥空繳納，謝謝！${a && a.name ? `\n管理人 ${a.name}${a.phone ? " " + a.phone : ""}` : ""}`;
      try{ await navigator.clipboard.writeText(msg); toast("已複製催繳訊息，可以貼到 LINE"); }catch(_){ prompt("複製下面的訊息", msg); }
      return;
    }
    if (b.dataset.rtsave){
      const f = b.closest(".rt-form"), g = k => f.querySelector(`[data-k="${k}"]`).value.trim(), u = units.find(x => x.id === b.dataset.rtsave);
      const n = +g("n") || 1, amount = Math.round(+String(g("amount")).replace(/[,\s]/g, "") || 0);
      if (!g("date")) return toast("請選收款日期");
      if (!(amount > 0)) return toast("請填金額");
      const months = Array.from({ length: n }, (_, i) => ymAdd(ym, i));
      const dup = months.filter(m => paidFor(u, m).length); if (dup.length) return toast(`${dup.map(ymZh).join("、")} 已經記錄過了`);
      b.disabled = true;
      try{
        await window.__fb.addDoc("rentPays", { unitId: u.id, property: u.property, room: u.room, tenant: u.tenant + (u.honor || ""), months, month: months[0],
          amount, date: g("date"), method: g("method"), note: g("note"), status: "ok", shareTenant: true, createdAt: nowISO() });
        openUid = null; toast(`已記錄 ${u.room} ${monthsZh(months)} 租金`);
      }catch(_){ b.disabled = false; toast("沒有存到，請再試一次"); }
      return;
    }
    if (b.dataset.rtdel){
      if (delArm !== b.dataset.rtdel){ delArm = b.dataset.rtdel; draw(); setTimeout(() => { if (delArm === b.dataset.rtdel){ delArm = null; draw(); } }, 5000); return; }
      const id = delArm; delArm = null;
      try{ await window.__fb.deleteDoc("rentPays/" + id); toast("已取消這筆收款"); }catch(_){ toast("取消失敗，請再試一次"); }
    }
  });

  // 資料：管理員看全部；屋主只看自己名下房間
  if (admin){
    const nm = x => String(x || "").replace(/\s/g, "");
    let shareTimer = null;
    const syncShare = () => { clearTimeout(shareTimer); shareTimer = setTimeout(() => {
      pays.forEach(p => { if (!p.property){ const u0 = units.find(x => x.id === p.unitId); if (u0) window.__fb.setDoc("rentPays/" + p.id, { property: u0.property }, true).catch(() => {}); }
        const u = units.find(x => x.id === p.unitId);
        const want = !!(u && u.tenant && nm(p.tenant).startsWith(nm(u.tenant)));
        if (!!p.shareTenant !== want) window.__fb.setDoc("rentPays/" + p.id, { shareTenant: want }, true).catch(() => {}); });
    }, 1500); };
    window.__fb.watch("rentPays", l => { pays = l; syncShare(); badge(); draw(); });
    afterRender(syncShare);
  } else {
    const parts = [];
    for (let i = 0; i < ownIds.length; i += 30){ const k = parts.length; parts.push([]);
      window.__fb.watch("rentPays", l => { parts[k] = l; pays = parts.flat(); draw(); }, [["unitId", "in", ownIds.slice(i, i + 30)]]); }
  }
  afterRender(draw);
  try{ if (localStorage.getItem("rl-view") === "rent") window.setView("rent"); }catch(_){}
}

/* ======================= 電表 ======================= */
function initMeter(){
  let reads = [], meterCfg = { rate: 5 }, propFilter = "", lastSaved = [];
  const num = v => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return isFinite(n) ? n : null; };
  const fmtN = n => n == null ? "—" : (Math.round(n * 10) / 10).toLocaleString("zh-TW");
  // 分頁按鈕與頁面
  const tab = document.createElement("button"); tab.type = "button"; tab.role = "tab"; tab.id = "vMeter"; tab.dataset.view = "meter"; tab.setAttribute("aria-selected", "false"); tab.textContent = "電表";
  document.querySelector("nav.views").appendChild(tab);
  const view = document.createElement("div"); view.className = "view"; view.id = "viewMeter"; view.hidden = true;
  $("viewContracts").after(view);
  const origSetView = window.setView;
  window.setView = function(v){ origSetView(v); view.hidden = v !== "meter"; tab.setAttribute("aria-selected", v === "meter"); if (v === "meter") draw(); };
  tab.onclick = () => window.setView("meter");

  // 每間房的電表設定：依最新合約（分錶／110V・220V 分開／台電自繳）與費率
  const latestContract = u => contracts.filter(c => c.unitId === u.id && c.status === "signed").sort((a, b) => String(b.signDate || "").localeCompare(String(a.signDate || "")))[0];
  function setup(u){
    const c = latestContract(u), m = u.meter || {};
    const mode = (c && c.elecMode === "self") || m.mode === "self" ? "self" : ((c && c.meterMode === "split") || m.mode === "split" ? "split" : "single");
    const rate = num(c && c.elecRate) ?? num(meterCfg.rate) ?? 5;
    return { mode, rate };
  }
  const unitReads = u => reads.filter(r => r.unitId === u.id).sort((a, b) => String(b.date + b.createdAt).localeCompare(String(a.date + a.createdAt)));
  function prevOf(u, mode){
    const last = unitReads(u)[0];
    if (last) return { from: "上次抄表 " + last.date, v: last.cur || {} };
    const m = u.meter || {}, c = latestContract(u) || {};
    const v = mode === "split" ? { r110: num(m.start110 ?? c.elec110), r220: num(m.start220 ?? c.elec220) } : { r: num(m.start ?? c.elecStart) };
    const has = Object.values(v).some(x => x != null);
    return { from: has ? "起租度數" + (m.date ? " " + m.date : "") : "", v };
  }
  function calc(mode, prev, cur, rate){
    const keys = mode === "split" ? ["r110", "r220"] : ["r"];
    if (keys.some(k => cur[k] == null)) return null;
    if (keys.some(k => prev[k] == null)) return { err: "請填上次度數" };
    const parts = keys.map(k => cur[k] - prev[k]);
    if (parts.some(x => x < 0)) return { err: "本次度數比上次小，請確認" };
    const kwh = Math.round(parts.reduce((a, b) => a + b, 0) * 10) / 10;
    return { kwh, parts, amount: Math.floor(kwh * rate + 1e-9) };
  }
  const props = () => allProps().filter(p => units.some(u => u.property === p));
  const sortUnits = us => us.sort((a, b) => String(a.room).localeCompare(String(b.room), "zh-Hant", { numeric: true }));

  function draw(){
    // 重畫前先記住已輸入的度數，畫完再填回去（資料更新時不會把正在輸入的數字清掉）
    const keep = view.dataset.reset ? [] : [...view.querySelectorAll(".mt-row[data-uid] input")].map(i => [i.closest(".mt-row").dataset.uid, i.getAttribute("data-cur") ? "c" + i.dataset.cur : i.getAttribute("data-prev") ? "p" + i.dataset.prev : "rate", i.value, i === document.activeElement]);
    const ps = props(); if (propFilter && !ps.includes(propFilter)) propFilter = "";
    const shown = propFilter ? [propFilter] : ps;
    const unpaid = reads.filter(r => !r.paid && r.amount > 0);
    view.innerHTML = `
      <div class="mt-top">
        <label class="field"><span>抄表日期</span><input type="date" id="mtDate" value="${E(view.dataset.date || today())}"></label>
        <label class="field"><span>物件</span><select id="mtProp"><option value="">全部物件</option>${ps.map(p => `<option ${p === propFilter ? "selected" : ""}>${E(p)}</option>`).join("")}</select></label>
        <label class="field"><span>預設每度（合約沒寫時使用）</span><span class="mt-rate"><input id="mtDefRate" type="number" step="0.1" min="0" inputmode="decimal" value="${E(meterCfg.rate)}"> 元</span></label>
      </div>
      <p class="hint">輸入這次抄到的度數，系統會用上次度數自動算出用電度數和電費。費率依各房最新合約的「每度電費」；第一次抄表時，上次度數會帶入起租度數，也可以自己修改。</p>
      ${unpaid.length ? `<div class="mt-unpaid">尚未收款：${unpaid.length} 筆，共 ${money(unpaid.reduce((a, r) => a + r.amount, 0))}　<button type="button" id="mtShowUnpaid">查看</button></div>` : ""}
      ${shown.map(p => `<section class="mt-prop"><h3>${E(p)}</h3>${sortUnits(units.filter(u => u.property === p)).map(rowHTML).join("")}</section>`).join("")}
      <p class="err" id="mtErr" hidden></p>
      <div class="mt-bar"><span id="mtSum"></span><button type="button" class="primary" id="mtSave">儲存這次抄表</button></div>
      <section class="mt-hist" id="mtHist">${histHTML()}</section>`;
    enhanceDates(view); delete view.dataset.reset;
    keep.forEach(([uid, k, v, focused]) => {
      const row = view.querySelector(`.mt-row[data-uid="${CSS.escape(uid)}"]`); if (!row) return;
      const i = k === "rate" ? row.querySelector("[data-rate]") : row.querySelector(k[0] === "c" ? `[data-cur="${k.slice(1)}"]` : `[data-prev="${k.slice(1)}"]`);
      if (i && (k[0] === "c" || v !== "")) { if (k[0] !== "c" || v) i.value = v; if (focused) i.focus(); }
    });
    view.querySelectorAll(".mt-row[data-uid]").forEach(updRow); updSum();
  }
  function rowHTML(u){
    const { mode, rate } = setup(u);
    const tenant = u.tenant ? `${E(u.tenant)}${E(u.honor || "")}` : `<span class="mt-vac">空房</span>`;
    if (mode === "self") return `<div class="mt-row mt-self"><div class="mt-h"><b>${E(u.room)}</b>${tenant}</div><small>台電獨立電表，房客自行繳費，不需抄表</small></div>`;
    const pv = prevOf(u, mode), keys = mode === "split" ? [["r110", "110V"], ["r220", "220V"]] : [["r", ""]];
    return `<div class="mt-row" data-uid="${E(u.id)}" data-mode="${mode}">
      <div class="mt-h"><b>${E(u.room)}</b>${tenant}<span class="mt-mode">${mode === "split" ? "110V／220V 分開" : "單一電表"}</span></div>
      ${keys.map(([k, lb]) => `<div class="mt-in">
        ${lb ? `<span class="mt-lb">${lb}</span>` : ""}
        <label><small>上次</small><input data-prev="${k}" inputmode="decimal" value="${pv.v[k] ?? ""}" placeholder="上次度數"></label>
        <span class="mt-arrow">→</span>
        <label><small>本次</small><input data-cur="${k}" inputmode="decimal" placeholder="輸入本次度數"></label>
      </div>`).join("")}
      <div class="mt-res"><small>${E(pv.from || "沒有上次紀錄，請填上次度數")}</small><span class="mt-rt">每度 <input data-rate inputmode="decimal" value="${E(rate)}"> 元</span><b class="mt-amt"></b></div>
    </div>`;
  }
  function rowVals(row){
    const g = sel => { const o = {}; row.querySelectorAll(`[${sel}]`).forEach(i => o[i.getAttribute(sel)] = num(i.value)); return o; };
    return { mode: row.dataset.mode, prev: g("data-prev"), cur: g("data-cur"), rate: num(row.querySelector("[data-rate]").value) ?? 0 };
  }
  function updRow(row){
    const v = rowVals(row), r = calc(v.mode, v.prev, v.cur, v.rate), el = row.querySelector(".mt-amt");
    el.className = "mt-amt" + (r && r.err ? " bad" : "");
    el.textContent = !r ? "" : r.err ? r.err : `${fmtN(r.kwh)} 度 × ${v.rate} = ${money(r.amount)}`;
  }
  function updSum(){
    let n = 0, tot = 0;
    view.querySelectorAll(".mt-row[data-uid]").forEach(row => { const v = rowVals(row), r = calc(v.mode, v.prev, v.cur, v.rate); if (r && !r.err){ n++; tot += r.amount; } });
    const el = $("mtSum"); if (el) el.textContent = n ? `本次 ${n} 間，電費合計 ${money(tot)}` : "";
  }
  view.addEventListener("input", e => { const row = e.target.closest(".mt-row[data-uid]"); if (row) updRow(row); updSum(); });
  view.addEventListener("change", async e => {
    if (e.target.id === "mtProp"){ propFilter = e.target.value; view.dataset.date = $("mtDate").value; draw(); }
    else if (e.target.id === "mtDate"){ view.dataset.date = e.target.value; }
    else if (e.target.id === "mtDefRate"){ const r = num(e.target.value); if (r != null){ await window.__fb.setDoc("settings/meter", { rate: r }, true); toast("已更新預設電費"); } }
    else if (e.target.dataset.paid){ await window.__fb.setDoc("meterReads/" + e.target.dataset.paid, { paid: e.target.checked, paidDate: e.target.checked ? today() : "" }, true); }
  });
  view.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "mtSave") return save(b);
    if (b.id === "mtShowUnpaid"){ $("mtHist").scrollIntoView({ behavior: "smooth" }); return; }
    if (b.dataset.copy){ copyText(b.dataset.copy === "all" ? lastSaved.map(msg).join("\n\n") : msg(reads.find(r => r.id === b.dataset.copy) || lastSaved.find(r => r.id === b.dataset.copy)), b); return; }
    if (b.dataset.mdel){
      if (b.dataset.armed !== "1"){ b.dataset.armed = "1"; b.textContent = "確定刪除"; b.classList.add("solid"); return; }
      await window.__fb.deleteDoc("meterReads/" + b.dataset.mdel); toast("已刪除這筆抄表");
    }
  });
  async function save(btn){
    const err = m => { $("mtErr").textContent = m; $("mtErr").hidden = !m; };
    const date = $("mtDate").value || today(), list = [];
    let bad = 0;
    view.querySelectorAll(".mt-row[data-uid]").forEach(row => {
      const v = rowVals(row), r = calc(v.mode, v.prev, v.cur, v.rate); if (!r) return;
      if (r.err){ bad++; return; }
      const u = units.find(x => x.id === row.dataset.uid);
      list.push({ unitId: u.id, property: u.property, room: u.room, tenant: u.tenant ? u.tenant + (u.honor || "") : "", date, mode: v.mode,
        prev: v.prev, cur: v.cur, kwh: r.kwh, rate: v.rate, amount: r.amount, paid: false, shareTenant: !!u.tenant, createdAt: new Date().toISOString() });
    });
    if (bad) return err(`有 ${bad} 間的度數有問題（紅字），請修正後再儲存。`);
    if (!list.length) return err("請至少輸入一間的本次度數。");
    err(""); btn.disabled = true; btn.textContent = "儲存中…";
    try{
      lastSaved = [];
      for (const d of list){ const id = await window.__fb.addDoc("meterReads", d); lastSaved.push({ id, ...d }); }
      toast(`已儲存 ${list.length} 間的抄表`);
      view.dataset.reset = "1"; view.dataset.date = date; draw(); showDone();
    }catch(_){ err("儲存失敗，請再試一次。"); btn.disabled = false; btn.textContent = "儲存這次抄表"; }
  }
  const msg = r => {
    if (!r) return "";
    const line = r.mode === "split"
      ? `110V：${fmtN(r.prev.r110)} → ${fmtN(r.cur.r110)}（${fmtN(r.cur.r110 - r.prev.r110)} 度）
220V：${fmtN(r.prev.r220)} → ${fmtN(r.cur.r220)}（${fmtN(r.cur.r220 - r.prev.r220)} 度）`
      : `上次 ${fmtN(r.prev.r)} 度 → 本次 ${fmtN(r.cur.r)} 度`;
    return `【電費通知】${shortProp(r.property)} ${r.room}${r.tenant ? " " + r.tenant : ""}
抄表日期：${zhDate(r.date)}
${line}
用電 ${fmtN(r.kwh)} 度 × 每度 ${r.rate} 元 = ${money(r.amount).replace("$", "")} 元`;
  };
  async function copyText(t, b){
    let ok = false; try{ await navigator.clipboard.writeText(t); ok = true; }catch(_){}
    if (!ok){ const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try{ ok = document.execCommand("copy"); }catch(_){} ta.remove(); }
    if (b){ const l = b.textContent; b.textContent = ok ? "已複製" : "複製失敗"; setTimeout(() => b.textContent = l, 1500); }
  }
  function showDone(){
    if (!lastSaved.length) return;
    const box = document.createElement("section"); box.className = "mt-done";
    box.innerHTML = `<h3>這次電費（${lastSaved.length} 間）</h3>
      ${lastSaved.map(r => `<div class="mt-msg"><pre>${E(msg(r))}</pre><button type="button" data-copy="${E(r.id)}">複製</button></div>`).join("")}
      <button type="button" class="primary" data-copy="all">全部複製（貼到 LINE）</button>`;
    view.querySelector(".mt-bar").after(box); box.scrollIntoView({ behavior: "smooth" });
  }
  function histHTML(){
    const shownUnits = new Set(units.filter(u => !propFilter || u.property === propFilter).map(u => u.id));
    const l = reads.filter(r => shownUnits.has(r.unitId)).sort((a, b) => String(b.date + b.createdAt).localeCompare(String(a.date + a.createdAt))).slice(0, 60);
    if (!l.length) return `<h3>抄表紀錄</h3><p class="hint">還沒有抄表紀錄。</p>`;
    return `<h3>抄表紀錄</h3>` + l.map(r => `<div class="mt-hrow${r.paid ? " paid" : ""}">
      <span class="mt-hd">${E(zhDate(r.date))}</span><b>${E(shortProp(r.property))} ${E(r.room)}</b><span>${E(r.tenant || "")}</span>
      <span class="mt-hk">${fmtN(r.kwh)} 度・${money(r.amount)}</span>
      <label class="mt-paid"><input type="checkbox" data-paid="${E(r.id)}" ${r.paid ? "checked" : ""}> 已收款</label>
      <span class="mt-ha"><button type="button" data-copy="${E(r.id)}">複製通知</button><button type="button" class="danger" data-mdel="${E(r.id)}">刪除</button></span>
    </div>`).join("");
  }

  // 房客只看得到「目前住這間的房客」的抄表紀錄（前房客的不會給新房客看）
  const nm = x => String(x || "").replace(/\s/g, "");
  let shareTimer = null;
  const syncShare = () => { clearTimeout(shareTimer); shareTimer = setTimeout(() => {
    reads.forEach(r => { const u = units.find(x => x.id === r.unitId);
      const want = !!(u && u.tenant && nm(r.tenant).startsWith(nm(u.tenant)));
      if (!!r.shareTenant !== want) window.__fb.setDoc("meterReads/" + r.id, { shareTenant: want }, true).catch(() => {}); });
  }, 1500); };
  window.__fb.watch("meterReads", l => { reads = l; syncShare(); if (!view.hidden) draw(); });
  afterRender(syncShare);
  db.doc("settings/meter").onSnapshot(d => { if (d.exists) meterCfg = { rate: 5, ...d.data() }; if (!view.hidden) draw(); }, () => {});
  afterRender(() => { if (!view.hidden) draw(); });
  try{ if (localStorage.getItem("rl-view") === "meter") window.setView("meter"); }catch(_){}
}

/* ======================= 管理員 ======================= */
function initAdmin(){
  let accList = [], reqList = [], mirrors = { ownerUnits: new Map(), ownerContracts: new Map() };
  window.__fb.watch("access", l => { accList = l; if (!$("accBox").hidden) drawAcc(); syncOwnerAccess(); });
  window.__fb.watch("requests", l => { reqList = l; drawInbox(); });
  window.__fb.watch("ownerUnits", l => { mirrors.ownerUnits = new Map(l.map(d => [d.id, d])); scheduleMirror(); });
  window.__fb.watch("ownerContracts", l => { mirrors.ownerContracts = new Map(l.map(d => [d.id, d])); scheduleMirror(); });
  afterRender(() => { scheduleMirror(); drawInbox(); });

  // ---- 屋主看的副本：去掉私人備註與實際簽署時間 ----
  const UNIT_KEYS = ["property", "floor", "room", "owner", "tenant", "honor", "phone", "tenant2", "honor2", "phone2", "leaseStart", "leaseEnd", "rent", "deposit", "keyDeposit", "payDay", "photos", "handovers", "vacantSince", "lastTenant", "meter", "contractId", "createdAt"];
  const unitView = u => { const o = { unitId: u.id }; UNIT_KEYS.forEach(k => { if (u[k] !== undefined) o[k] = u[k]; }); return o; };
  const contractView = c => { const { id, actualStamps, actual, ...rest } = c; return rest; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const strip = d => { if (!d) return d; const { id, ...r } = d; return r; };
  let mirrorTimer = null, mirrorBusy = false;
  function scheduleMirror(){ clearTimeout(mirrorTimer); mirrorTimer = setTimeout(syncMirrors, 1500); }
  async function syncMirrors(){
    if (mirrorBusy || typeof uLoaded === "undefined" || !uLoaded || !cLoaded) return;
    mirrorBusy = true;
    try{
      for (const u of units){ const v = unitView(u); if (!same(strip(mirrors.ownerUnits.get(u.id)), v)) await window.__fb.setDoc("ownerUnits/" + u.id, v); }
      for (const id of mirrors.ownerUnits.keys()) if (!units.some(u => u.id === id)) await window.__fb.deleteDoc("ownerUnits/" + id);
      const signed = contracts.filter(c => c.status === "signed");
      for (const c of signed){ const v = contractView(c); if (!same(strip(mirrors.ownerContracts.get(c.id)), JSON.parse(JSON.stringify(v)))) await window.__fb.setDoc("ownerContracts/" + c.id, v); }
      for (const id of mirrors.ownerContracts.keys()) if (!signed.some(c => c.id === id)) await window.__fb.deleteDoc("ownerContracts/" + id);
      // 房客只看得到「目前住在這間的房客」自己那份已簽合約（前房客的合約不會給新房客看）
      const nm = s => String(s || "").replace(/\s/g, "");
      const cur = new Set(units.filter(u => u.tenant && u.contractId).map(u => {
        const c = signed.find(x => x.id === u.contractId);
        return c && [nm(c.tenant && c.tenant.name), nm(c.tenant2 && c.tenant2.name)].includes(nm(u.tenant)) ? c.id : null;
      }).filter(Boolean));
      for (const c of signed){ const want = cur.has(c.id); if (!!c.shareTenant !== want) await window.__fb.setDoc("contracts/" + c.id, { shareTenant: want }, true); }
      syncOwnerAccess();
    }catch(e){ console.warn("mirror", e); }
    finally{ mirrorBusy = false; }
  }
  // 屋主帳號的房號清單，跟著房號上的屋主欄位自動更新
  const ownerUnitIds = name => units.filter(u => (u.owner || "") === name || (!u.owner && (properties.find(p => p.name === u.property) || {}).owners?.length === 1 && properties.find(p => p.name === u.property).owners[0] === name)).map(u => u.id).sort();
  // 多位屋主（例如夫妻各自名下）的房號合在一起
  const namesUnitIds = names => [...new Set(names.flatMap(n => ownerUnitIds(n)))].sort();
  function syncOwnerAccess(){
    if (typeof uLoaded === "undefined" || !uLoaded) return;
    accList.filter(a => a.role === "owner" && (a.ownerNames || a.ownerName)).forEach(a => {
      const ids = namesUnitIds(a.ownerNames || [a.ownerName]);
      if (!same(ids, [...(a.unitIds || [])].sort())) window.__fb.setDoc("access/" + a.id, { unitIds: ids }, true).catch(() => {});
    });
    // 房客帳號附上月租與繳租日（房客回報繳租時自動帶入金額）
    accList.filter(a => a.role === "tenant").forEach(a => {
      const rents = {}; (a.unitIds || []).forEach(id => { const u = units.find(x => x.id === id); if (u) rents[id] = { rent: +u.rent || 0, payDay: u.payDay || "" }; });
      if (!same(rents, a.rents || {})) window.__fb.setDoc("access/" + a.id, { rents }, true).catch(() => {});
    });
  }

  // ---- 房號編輯時一併開通／更新房客帳號 ----
  window.__unitAccEmails = uid => accList.filter(a => a.role === "tenant" && (a.unitIds || []).includes(uid)).map(a => a.email || a.id);
  window.__afterUnitSave = async (uid, d) => {
    const u = { id: uid, ...d };
    const want = [[d.tenantEmail, d.tenant, d.honor, d.phone], [d.tenantEmail2, d.tenant2 || d.tenant, d.tenant2 ? d.honor2 : d.honor, d.tenant2 ? (d.phone2 || d.phone) : d.phone]].filter(x => x[0]);
    const emails = want.map(x => x[0]);
    const msgs = [];
    try{
      // 這間房原本開給、但已經拿掉的 Email → 取消這間房（沒有其他房間就刪除帳號）
      for (const a of accList.filter(a => a.role === "tenant" && (a.unitIds || []).includes(uid) && !emails.includes(a.email || a.id))){
        const left = a.unitIds.filter(i => i !== uid), rooms = { ...(a.rooms || {}) }; delete rooms[uid];
        if (left.length) await window.__fb.setDoc("access/" + a.id, { unitIds: left, rooms }, true); else await window.__fb.deleteDoc("access/" + a.id);
        msgs.push("已停用 " + (a.email || a.id));
      }
      for (const [email, name, honor, phone] of want){
        if (email === "raywu02070209@gmail.com"){ msgs.push("管理員帳號不用開通"); continue; }
        const ex = accList.find(a => (a.email || a.id) === email);
        if (ex && ex.role === "owner"){ msgs.push(email + " 已是屋主帳號，未改成房客"); continue; }
        const ids = [...new Set([...((ex && ex.unitIds) || []), uid])];
        const rooms = { ...((ex && ex.rooms) || {}), [uid]: unitLabel(u) };
        await window.__fb.setDoc("access/" + email, { role: "tenant", email, name: (name || "") + (honor || ""), phone: phone || "", unitIds: ids, rooms, ...(ex ? {} : { createdAt: nowISO() }) }, true);
        if (!ex) msgs.push("已開通房客帳號 " + email);
      }
      if (msgs.length) toast(msgs.join("；") + (msgs.some(m => m.startsWith("已開通")) ? "，請房客用這個 Email 到網站註冊" : ""));
    }catch(_){ toast("房號已存，但房客帳號更新失敗，請再存一次"); }
  };

  // ---- 紀錄存檔後：同步報修狀態、退租自動停用房客帳號 ----
  window.__afterRecordSave = data => {
    if (data.requestId) window.__fb.setDoc("requests/" + data.requestId, { status: data.status, updatedAt: nowISO() }, true).catch(() => {});
    if (data.type === "moveout" && data.unitId){
      accList.filter(a => a.role === "tenant" && (a.unitIds || []).includes(data.unitId)).forEach(a => {
        const left = a.unitIds.filter(i => i !== data.unitId);
        const p = left.length ? window.__fb.setDoc("access/" + a.id, { unitIds: left }, true) : window.__fb.deleteDoc("access/" + a.id);
        p.then(() => toast(`已停用房客帳號 ${a.email || a.id}`)).catch(() => {});
      });
    }
  };

  // ---- 房客線上簽完、等管理人確認的合約：每一頁上方都提醒 ----
  const signAlert = document.createElement("section"); signAlert.className = "sgn-alert"; signAlert.hidden = true;
  document.querySelector("nav.views").before(signAlert);
  const drawSignAlert = () => {
    const l = contracts.filter(c => c.status === "tenantSigned");
    signAlert.hidden = !l.length;
    signAlert.innerHTML = `<b>房客已完成線上簽約，等你確認（${l.length} 份）</b>` + l.map(c => `<div class="sgn-row"><span>${E(unitLabel(c))}${c.tenant && c.tenant.name ? "（" + E(c.tenant.name) + (c.hasCoTenant && c.tenant2 && c.tenant2.name ? "、" + E(c.tenant2.name) : "") + "）" : ""}${c.tenantSignedAt ? "・" + E(fmtTs(c.tenantSignedAt)) + " 送出" : ""}</span><button type="button" class="primary" data-sgngo="${E(c.id)}">前往確認</button></div>`).join("");
  };
  signAlert.onclick = e => {
    const b = e.target.closest("[data-sgngo]"); if (!b) return;
    window.setView("contracts");
    setTimeout(() => { const btn = document.querySelector(`[data-cfinal="${CSS.escape(b.dataset.sgngo)}"]`); if (btn){ btn.scrollIntoView({ block: "center", behavior: "smooth" }); btn.classList.add("sgn-flash"); setTimeout(() => btn.classList.remove("sgn-flash"), 2500); } }, 100);
  };
  afterRender(drawSignAlert);

  // ---- 報修收件匣（紀錄頁最上面） ----
  const inbox = document.createElement("section"); inbox.className = "rq"; inbox.id = "reqInbox"; inbox.hidden = true;
  $("viewRecords").prepend(inbox);
  function drawInbox(){
    const list = reqList.filter(r => r.status === "new").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    inbox.hidden = !list.length;
    inbox.innerHTML = `<h2>房客線上申請 <span class="rq-n">${list.length} 件新申請</span></h2>` + list.map(r => `
      <div class="rq-item">
        <div class="rq-h"><span class="chip t-${r.type === "repair" ? "repair" : r.type === "purchase" ? "purchase" : "assist"}">${E(REQ_TYPE[r.type] || "申請")}</span><b>${E(r.room)}</b><span>${E(r.name)} ${E(r.phone)}</span><small>${E(fmtTs(r.createdAt))}</small></div>
        <p>${E(r.desc)}</p>${r.when ? `<small>方便時間：${E(r.when)}</small>` : ""}
        ${(r.photos || []).length ? `<div class="rq-ph">${r.photos.map(u => `<a href="${E(u)}" target="_blank" rel="noopener"><img src="${E(u)}" alt="房客附的照片"></a>`).join("")}</div>` : ""}
        <div class="rq-a"><button type="button" class="primary" data-rqok="${E(r.id)}">轉成紀錄</button><button type="button" data-rqno="${E(r.id)}">不處理</button></div>
      </div>`).join("");
  }
  inbox.onclick = async e => {
    const b = e.target.closest("button"); if (!b) return;
    const r = reqList.find(x => x.id === (b.dataset.rqok || b.dataset.rqno)); if (!r) return;
    b.disabled = true;
    try{
      if (b.dataset.rqno){ await window.__fb.setDoc("requests/" + r.id, { status: "rejected", updatedAt: nowISO() }, true); return; }
      const u = units.find(x => x.id === r.unitId) || {};
      const first = String(r.desc).split("\n")[0], now = nowISO();
      const rec = { type: r.type === "repair" ? "repair" : r.type === "purchase" ? "purchase" : "assist", date: String(r.createdAt).slice(0, 10) || today(), due: "",
        property: u.property || "", room: u.room || r.room || "", unitId: r.unitId || "", tenant: r.name || u.tenant || "", honor: r.name ? "" : (u.honor || ""), phone: r.phone || u.phone || "",
        title: first.length > 40 ? first.slice(0, 40) + "…" : first,
        detail: [r.desc, r.when ? "方便處理時間：" + r.when : "", ...(r.photos || []).map((p, i) => `照片${i + 1}：${p}`)].filter(Boolean).join("\n"),
        vendor: "", amount: 0, bearer: "landlord", billing: "none", status: "todo", doneDate: "", note: "房客線上申請",
        leaseStart: "", leaseEnd: "", rent: 0, deposit: 0, keyDeposit: 0, requestId: r.id, createdAt: now, updatedAt: now };
      const res = await col.add(rec);
      await window.__fb.setDoc("requests/" + r.id, { status: "todo", recordId: res.id, updatedAt: now }, true);
      toast("已轉成紀錄，房客那邊會顯示「已受理」");
    }catch(_){ b.disabled = false; toast("沒有成功，請再試一次"); }
  };

  // ---- 已簽合約刪除（測試用的合約），要按兩次 ----
  let cdelArmed = null;
  $("contractList").addEventListener("click", async e => {
    const b = e.target.closest("button[data-cdel]"); if (!b) return;
    e.stopPropagation();
    const c = contracts.find(x => x.id === b.dataset.cdel); if (!c) return;
    if (cdelArmed !== c.id){ cdelArmed = c.id; b.textContent = "確定刪除這份合約？"; b.classList.add("solid"); setTimeout(() => { if (cdelArmed === c.id){ cdelArmed = null; b.textContent = "刪除"; b.classList.remove("solid"); } }, 5000); return; }
    cdelArmed = null;
    try{ await ccol.doc(c.id).delete(); toast(c.recordId ? "已刪除合約。對應的簽約紀錄請到「紀錄」頁另外刪除" : "已刪除合約"); }
    catch(_){ toast("刪除失敗，請再試一次"); }
  }, true);

  // ---- 合約：開放房客線上簽、代理人確認完成 ----
  $("contractList").addEventListener("click", async e => {
    const b = e.target.closest("button[data-cshare],button[data-cfinal]"); if (!b) return;
    const c = contracts.find(x => x.id === (b.dataset.cshare || b.dataset.cfinal)); if (!c) return;
    if (b.dataset.cshare){
      if (c.shareTenant){ await ccol.doc(c.id).update({ shareTenant: false, updatedAt: nowISO() }); toast("已取消房客線上簽"); return; }
      const has = accList.some(a => a.role === "tenant" && (a.unitIds || []).includes(c.unitId));
      const cc = remoteCopy(c), u = units.find(x => x.id === c.unitId), pc = prevContractOf(u);
      await ccol.doc(c.id).update({ shareTenant: true, tenant: cc.tenant, tenant2: cc.tenant2, guarantor: cc.guarantor, cleaning: cc.cleaning || "agent", floor: cc.floor || c.floor || "",
        seals: cc.seals, prevIdPhotos: (pc && pc.idPhotos) || [], updatedAt: nowISO() });
      toast(has ? "已開放，房客登入後就能簽署" : "已開放。這間房還沒有房客帳號，請到「帳號權限」新增");
      return;
    }
    // 房客已簽 → 代理人確認
    S = { c: JSON.parse(JSON.stringify(c)), step: 3, sig: { tenant: "data:image/png;base64,", tenant2: "data:image/png;base64,", guarantor: "data:image/png;base64," },
      photos: {}, previews: {}, up: { sig_tenant: (c.sigs || {}).tenant, sig_tenant2: (c.sigs || {}).tenant2, sig_guarantor: (c.sigs || {}).guarantor },
      useOldIds: true, reuseIds: c.idPhotos || [], finalizeOnly: true, exitArmed: false };
    S.c.stamps = c.stamps || {}; S.c.actual = c.actualStamps || {};
    $("signWrap").hidden = false; document.body.style.overflow = "hidden";
    drawStep();
  }, true);

  // ---- 帳號權限 ----
  const accBox = document.createElement("div"); accBox.className = "mvbox"; accBox.id = "accBox"; accBox.hidden = true;
  accBox.innerHTML = `<div class="mvcard acc" role="dialog" aria-labelledby="accTitle">
    <h2 id="accTitle">帳號權限</h2>
    <p class="hint">新增房客或屋主的 Email，對方用這個 Email 在網站「註冊」並完成驗證後就能登入。房客只能報修、簽續約；屋主只能閱覽勾選的屋主名下的房間。要修改權限，用同一個 Email 再新增一次就會覆蓋。</p>
    <div id="accList"></div>
    <h3>新增帳號</h3>
    <div class="acc-seg"><label><input type="radio" name="accRole" value="tenant" checked> 房客</label><label><input type="radio" name="accRole" value="owner"> 屋主</label></div>
    <label class="field"><span>Email</span><input id="accEmail" type="email" inputmode="email" autocomplete="off" placeholder="對方註冊用的 Email"></label>
    <label class="field"><span>姓名／稱呼</span><input id="accName" placeholder="例：王小明先生"></label>
    <label class="field" id="accPhoneF"><span>電話（房客報修時自動帶入）</span><input id="accPhone" inputmode="tel"></label>
    <div class="field" id="accUnitsF"><span>房號（可複選）</span><div id="accUnits" class="acc-units"></div></div>
    <div class="field" id="accOwnerF" hidden><span>可以看哪些屋主名下的房間（可複選，例如夫妻各自名下的物件）</span><div id="accOwner" class="acc-owners"></div><small id="accOwnerHint" class="hint"></small></div>
    <p class="err" id="accErr" hidden></p>
    <div class="row"><button type="button" id="accClose">關閉</button><button type="button" class="primary" id="accAdd">新增帳號</button></div>
  </div>`;
  document.body.appendChild(accBox);
  const ownerNames = () => [...new Set([...units.map(u => u.owner).filter(Boolean), ...properties.flatMap(p => p.owners || [])])].sort();
  function drawAccForm(){
    const role = document.querySelector("input[name=accRole]:checked").value;
    $("accUnitsF").hidden = role !== "tenant"; $("accPhoneF").hidden = role !== "tenant"; $("accOwnerF").hidden = role !== "owner";
    if (role === "tenant"){
      const byProp = new Map(); units.forEach(u => { if (!byProp.has(u.property)) byProp.set(u.property, []); byProp.get(u.property).push(u); });
      $("accUnits").innerHTML = [...byProp].map(([p, us]) => `<div class="acc-p"><b>${E(shortProp(p))}</b><div>${us.sort((a, b) => String(a.room).localeCompare(String(b.room), "zh-Hant", { numeric: true })).map(u => `<label><input type="checkbox" value="${E(u.id)}"> ${E(u.room)}${u.tenant ? `<small>（${E(u.tenant)}）</small>` : ""}</label>`).join("")}</div></div>`).join("");
    } else {
      $("accOwner").innerHTML = ownerNames().map(n => `<label><input type="checkbox" value="${E(n)}"> ${E(n)}</label>`).join("");
      const upd = () => { const ns = pickedOwners(); $("accOwnerHint").textContent = ns.length ? `可看到的房號：${namesUnitIds(ns).map(id => unitLabel(units.find(u => u.id === id))).join("、") || "（沒有找到，請先在房號資料填寫屋主）"}` : ""; };
      $("accOwner").onchange = upd; upd();
    }
  }
  const pickedOwners = () => [...document.querySelectorAll("#accOwner input:checked")].map(i => i.value);
  function drawAcc(){
    const l = [...accList].sort((a, b) => (a.role + a.id).localeCompare(b.role + b.id));
    $("accList").innerHTML = l.length ? l.map(a => `<div class="acc-row"><span class="chip ${a.role === "owner" ? "t-purchase" : "t-assist"}">${a.role === "owner" ? "屋主" : "房客"}</span>
      <span class="acc-who"><b>${E(a.name || "")}</b> ${E(a.id)}<br><small>${E((a.unitIds || []).map(id => { const u = units.find(x => x.id === id); return u ? unitLabel(u) : "（已刪除的房號）"; }).join("、") || "（沒有房號）")}</small></span>
      <button type="button" class="danger" data-accdel="${E(a.id)}">刪除</button></div>`).join("") : `<p class="hint">目前還沒有房客或屋主帳號。</p>`;
  }
  const accBtn = document.createElement("button"); accBtn.type = "button"; accBtn.id = "accBtn"; accBtn.textContent = "帳號權限";
  $("whoBar").insertBefore(accBtn, $("moveBtn"));

  // ---- 預覽身分：用管理員帳號看屋主／房客的畫面 ----
  const pvBtn = document.createElement("button"); pvBtn.type = "button"; pvBtn.id = "pvBtn"; pvBtn.textContent = "預覽屋主／房客畫面";
  $("whoBar").insertBefore(pvBtn, accBtn);
  const pvBox = document.createElement("div"); pvBox.className = "mvbox"; pvBox.hidden = true;
  pvBox.innerHTML = `<div class="mvcard acc" role="dialog" aria-labelledby="pvTitle">
    <h2 id="pvTitle">預覽屋主／房客畫面</h2>
    <p class="hint">不用另外註冊帳號，直接用你自己的帳號看看屋主或房客登入後會看到什麼。預覽時送出的報修、簽名都是真的資料，測試完記得刪除。</p>
    <div class="acc-seg"><label><input type="radio" name="pvRole" value="owner" checked> 屋主</label><label><input type="radio" name="pvRole" value="tenant"> 房客</label></div>
    <label class="field" id="pvOwnerF"><span>以哪位屋主的身分</span><select id="pvOwner"></select></label>
    <label class="field" id="pvUnitF" hidden><span>以哪間房的房客身分</span><select id="pvUnit"></select></label>
    <div class="row"><button type="button" id="pvCancel">取消</button><button type="button" class="primary" id="pvGo">開始預覽</button></div>
  </div>`;
  document.body.appendChild(pvBox);
  const pvSync = () => { const r = document.querySelector("input[name=pvRole]:checked").value; $("pvOwnerF").hidden = r !== "owner"; $("pvUnitF").hidden = r !== "tenant"; };
  pvBtn.onclick = () => {
    const oacc = accList.filter(a => a.role === "owner");
    $("pvOwner").innerHTML = (oacc.length ? `<optgroup label="已開通的屋主帳號">${oacc.map(a => `<option value="acc:${E(a.id)}">${E(a.name || a.id)}（${E(a.id)}）</option>`).join("")}</optgroup>` : "")
      + `<optgroup label="單一屋主">${ownerNames().map(n => `<option value="name:${E(n)}">${E(n)}</option>`).join("")}</optgroup>`;
    $("pvUnit").innerHTML = [...units].sort((a, b) => unitLabel(a).localeCompare(unitLabel(b), "zh-Hant", { numeric: true })).map(u => `<option value="${E(u.id)}">${E(unitLabel(u))}${u.tenant ? "（" + E(u.tenant) + "）" : ""}</option>`).join("");
    pvSync(); pvBox.hidden = false;
  };
  pvBox.addEventListener("change", e => { if (e.target.name === "pvRole") pvSync(); });
  $("pvCancel").onclick = () => { pvBox.hidden = true; };
  $("pvGo").onclick = () => {
    const r = document.querySelector("input[name=pvRole]:checked").value;
    let acc;
    if (r === "owner"){
      const v = $("pvOwner").value, a = v.startsWith("acc:") ? accList.find(x => x.id === v.slice(4)) : null;
      const ns = a ? (a.ownerNames || [a.ownerName]) : [v.slice(5)];
      acc = { role: "owner", name: a ? (a.name || ns.join("、")) : ns[0], ownerNames: ns, unitIds: namesUnitIds(ns) };
    }
    else { const u = units.find(x => x.id === $("pvUnit").value); if (!u) return; acc = { role: "tenant", name: u.tenant ? u.tenant + (u.honor || "") : "測試房客", phone: u.phone || "", unitIds: [u.id], rooms: { [u.id]: unitLabel(u) } }; }
    sessionStorage.setItem("rolePreview", JSON.stringify({ role: r, acc }));
    location.reload();
  };
  accBtn.onclick = () => { $("accErr").hidden = true; drawAcc(); drawAccForm(); accBox.hidden = false; };
  $("accClose").onclick = () => { accBox.hidden = true; };
  accBox.addEventListener("change", e => { if (e.target.name === "accRole") drawAccForm(); });
  let delArmed = null;
  $("accList").onclick = async e => {
    const b = e.target.closest("[data-accdel]"); if (!b) return;
    if (delArmed !== b.dataset.accdel){ delArmed = b.dataset.accdel; b.textContent = "確定刪除"; b.classList.add("solid"); return; }
    try{ await window.__fb.deleteDoc("access/" + b.dataset.accdel); toast("已刪除，這個帳號之後無法再登入"); }catch(_){ toast("刪除失敗"); }
    delArmed = null;
  };
  $("accAdd").onclick = async () => {
    const err = m => { $("accErr").textContent = m; $("accErr").hidden = !m; };
    const role = document.querySelector("input[name=accRole]:checked").value;
    const email = $("accEmail").value.trim().toLowerCase(), name = $("accName").value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err("請輸入正確的 Email。");
    if (email === "raywu02070209@gmail.com") return err("這是管理員帳號，不用另外新增。");
    let data;
    if (role === "tenant"){
      const ids = [...document.querySelectorAll("#accUnits input:checked")].map(i => i.value);
      if (!ids.length) return err("請勾選房客的房號。");
      const rooms = {}; ids.forEach(id => { rooms[id] = unitLabel(units.find(u => u.id === id)); });
      data = { role, email, name, phone: $("accPhone").value.trim(), unitIds: ids, rooms, createdAt: nowISO() };
    } else {
      const ns = pickedOwners(); if (!ns.length) return err("請勾選至少一位屋主。");
      data = { role, email, name: name || ns.join("、"), ownerNames: ns, unitIds: namesUnitIds(ns), createdAt: nowISO() };
    }
    err(""); $("accAdd").disabled = true;
    try{ await window.__fb.setDoc("access/" + email, data); toast("已新增帳號，請對方用這個 Email 到網站註冊");
      $("accEmail").value = ""; $("accName").value = ""; $("accPhone").value = ""; drawAccForm(); }
    catch(_){ err("新增失敗，請再試一次。"); }
    finally{ $("accAdd").disabled = false; }
  };
}
})();
