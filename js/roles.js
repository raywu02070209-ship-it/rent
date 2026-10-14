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
  else if (x.role === "owner"){ initOwner(x.acc); const go = () => (typeof units !== "undefined" && document.querySelector("nav.views")) ? initOwnerMeter(x.acc) : setTimeout(go, 50); go(); }
  else { initAdmin(); const go = () => (typeof db !== "undefined" && db && typeof units !== "undefined") ? initMeter() : setTimeout(go, 50); go(); }
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
      try{
        const up = async (key, blob) => { if (!S.up[key]) S.up[key] = (await assets.upload(blob, { type: blob.type || "image/png" })).id; return S.up[key]; };
        const sigs = { tenant: await up("sig_tenant", dataURLtoBlob(S.sig.tenant)) };
        if (c.hasCoTenant) sigs.tenant2 = await up("sig_tenant2", dataURLtoBlob(S.sig.tenant2));
        if (c.hasGuarantor) sigs.guarantor = await up("sig_guarantor", dataURLtoBlob(S.sig.guarantor));
        let idPhotos;
        if (S.useOldIds) idPhotos = S.reuseIds.slice();
        else { idPhotos = [await up("id_front", S.photos.front), await up("id_back", S.photos.back)];
          if (c.hasCoTenant) idPhotos.push(await up("id_front2", S.photos.front2), await up("id_back2", S.photos.back2)); }
        const now = nowISO();
        await ccol.doc(c.id).update({ tenant: c.tenant, tenant2: c.hasCoTenant ? c.tenant2 : {}, guarantor: c.hasGuarantor ? c.guarantor : {}, cleaning: c.cleaning,
          stamps: c.stamps, sigs, idPhotos, actualStamps: c.actual || {}, status: "tenantSigned", tenantSignedAt: now, updatedAt: now });
        Object.values(S.previews).forEach(u => URL.revokeObjectURL(u)); S = null;
        $("signWrap").hidden = true; document.body.style.overflow = "";
        toast("已送出簽名，管理人確認後就完成續約");
      }catch(e){ btn.disabled = false; btn.textContent = "送出簽名"; err("送出失敗，請檢查網路後再按一次。"); }
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
