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
  else if (x.role === "owner") initOwner(x.acc);
  else initAdmin();
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
    el.innerHTML = `<h2>續約合約</h2>` + cs.map(c => {
      const head = `<p><b>${E(c.room)}</b>　租期 ${E(zhDate(c.leaseStart))} 至 ${E(zhDate(c.leaseEnd))}<br>月租 ${E(money(c.rent))}・押金 ${E(money(c.deposit))}</p>`;
      if (c.status === "draft") return `<div class="tp-con">${head}<p class="tp-hint">管理人已準備好續約合約，請先閱讀內容，確認無誤後簽名送出。</p>
        <div class="tp-row"><button type="button" data-tprev="${E(c.id)}">先預覽合約</button><button type="button" class="tp-primary" data-tsign="${E(c.id)}">閱讀並簽署</button></div></div>`;
      if (c.status === "tenantSigned") return `<div class="tp-con">${head}<p class="tp-ok">已送出簽名，等待管理人確認完成。</p></div>`;
      if (c.status === "signed") return `<div class="tp-con">${head}<p class="tp-ok">續約已完成。</p><div class="tp-row"><button type="button" data-tview="${E(c.id)}">檢視合約</button><button type="button" class="tp-primary" data-tpdf="${E(c.id)}">下載合約 PDF</button></div></div>`;
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
    else if (b.dataset.tpdf) contractPDF(c, b);
  };

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
  if (sub) sub.textContent = `${acc.name || "屋主"} 您好，這裡可以查看您名下房間的租約、合約與維修代墊紀錄（僅供閱覽）。`;
  const h = document.querySelector("#viewContracts > .hint"); if (h) h.textContent = "這裡列出您名下房間已完成的租賃合約，可檢視或下載 PDF。";
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
