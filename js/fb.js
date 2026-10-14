// 把紀錄簿原本的資料介面（window.claude.use）接到 Firebase：登入、Firestore 資料庫、Storage 檔案。
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, setPersistence, browserLocalPersistence }
  from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import { initializeFirestore, collection, doc, onSnapshot, addDoc, setDoc, deleteDoc, getDocs, getDoc, writeBatch, query, where }
  from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject }
  from "https://www.gstatic.com/firebasejs/12.17.0/firebase-storage.js";
import { firebaseConfig, ADMIN_EMAILS } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = initializeFirestore(app, { ignoreUndefinedProperties: true });
const st = getStorage(app);
const $ = id => document.getElementById(id);
const hub = window.__fbHub;          // 由頁面上的小腳本先建立，紀錄簿會等它

// ---------- 錯誤代碼轉成紀錄簿認得的 ----------
const mapErr = e => {
  const c = (e && e.code) || "";
  const code = c.includes("permission-denied") ? "invalid_argument"
    : c.includes("unavailable") || c.includes("network") ? "unavailable"
    : c.includes("resource-exhausted") ? "quota_exceeded" : c;
  const err = new Error((e && e.message) || "error"); err.code = code; return err;
};
const wrap = p => p.catch(e => { throw mapErr(e); });
const docSnap = s => ({ id: s.id, exists: s.exists(), data: () => s.data() });

// ---------- 資料庫 ----------
function docApi(path){
  const r = doc(fs, path);
  return {
    onSnapshot: (cb, onErr) => onSnapshot(r, s => cb(docSnap(s)), e => onErr && onErr(mapErr(e))),
    set: d => wrap(setDoc(r, d)),
    update: d => wrap(setDoc(r, d, { merge: true })),
    delete: () => wrap(deleteDoc(r)),
  };
}
function colApi(name){
  const c = collection(fs, name);
  return {
    onSnapshot: (cb, onErr) => onSnapshot(c, s => cb({ docs: s.docs.map(docSnap) }), e => onErr && onErr(mapErr(e))),
    add: d => wrap(addDoc(c, d)).then(r => ({ id: r.id })),
    doc: id => docApi(name + "/" + id),
  };
}
const dbApi = { collection: colApi, doc: docApi };

// ---------- 房客／屋主：只讀得到自己房號的資料 ----------
const denied = () => Promise.reject(Object.assign(new Error("唯讀"), { code: "invalid_argument" }));
const emptyCol = { onSnapshot: cb => { setTimeout(() => cb({ docs: [] }), 0); return () => {}; }, add: denied, doc: () => emptyDoc };
const emptyDoc = { onSnapshot: cb => { setTimeout(() => cb({ id: "", exists: false, data: () => undefined }), 0); return () => {}; }, set: denied, update: denied, delete: denied };
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
// 多個 query（每次最多 30 個房號）合併成一個快照
function mergedQuery(queries){
  return {
    onSnapshot: (cb, onErr) => {
      if (!queries.length){ setTimeout(() => cb({ docs: [] }), 0); return () => {}; }
      const parts = queries.map(() => null);
      const unsubs = queries.map((q, i) => onSnapshot(q, s => { parts[i] = s.docs.map(docSnap); if (parts.every(Boolean)) cb({ docs: parts.flat() }); }, e => onErr && onErr(mapErr(e))));
      return () => unsubs.forEach(u => u());
    },
    add: denied,
    doc: () => emptyDoc,
  };
}
function perDoc(colName, ids){   // 逐一監聽指定文件（屋主的房號）
  return {
    onSnapshot: (cb, onErr) => {
      if (!ids.length){ setTimeout(() => cb({ docs: [] }), 0); return () => {}; }
      const got = new Map();
      const unsubs = ids.map(id => onSnapshot(doc(fs, colName, id), s => { got.set(id, s.exists() ? docSnap(s) : null); if (got.size === ids.length) cb({ docs: [...got.values()].filter(Boolean) }); }, () => { got.set(id, null); if (got.size === ids.length) cb({ docs: [...got.values()].filter(Boolean) }); }));
      return () => unsubs.forEach(u => u());
    },
    add: denied, doc: () => emptyDoc,
  };
}
function roleDb(role, acc){
  const ids = acc.unitIds || [];
  const inIds = (col, extra = []) => chunks(ids, 30).map(c => query(collection(fs, col), where("unitId", "in", c), ...extra));
  const readDoc = path => ({ ...docApi(path), set: denied, update: denied, delete: denied });
  const settingsOk = p => p === "settings/agent" || p === "settings/doc";
  if (role === "owner") return {
    collection: name => name === "units" ? perDoc("ownerUnits", ids)
      : name === "contracts" ? mergedQuery(inIds("ownerContracts"))
      : name === "records" ? mergedQuery(inIds("records")) : emptyCol,
    doc: path => settingsOk(path) ? readDoc(path) : emptyDoc,
  };
  // tenant
  return {
    collection: name => {
      if (name !== "contracts") return emptyCol;
      const m = mergedQuery(inIds("contracts", [where("shareTenant", "==", true)]));
      m.doc = id => docApi("contracts/" + id);
      return m;
    },
    doc: path => settingsOk(path) ? readDoc(path) : emptyDoc,
  };
}

// ---------- 檔案（照片、簽名、印章、合約 PDF） ----------
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
let uploadDir = "files";
async function upload(blob, opts){
  const type = (opts && opts.type) || blob.type || "application/octet-stream";
  const r = ref(st, `${uploadDir}/${rid()}.${EXT[type] || "bin"}`);
  await wrap(uploadBytes(r, blob, { contentType: type, cacheControl: "public,max-age=31536000" }));
  return { id: await getDownloadURL(r) };     // 之後直接用這個網址顯示
}
const assetsApi = {
  upload,
  delete: async id => { if (/^https?:/.test(id)) await deleteObject(ref(st, id)); },
  list: async () => { throw new Error("not supported"); },
};

// ---------- 下載 ----------
const downloadsApi = {
  save: async ({ filename, data }) => {
    const url = URL.createObjectURL(data);
    const a = document.createElement("a"); a.href = url; a.download = filename || "download";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
};

// ---------- 登入畫面 ----------
const isAdmin = u => !!u && u.emailVerified && ADMIN_EMAILS.includes((u.email || "").toLowerCase());
function showAuth(mode, msg){
  $("authBox").hidden = false; $("authMsg").textContent = msg || ""; $("authMsg").hidden = !msg;
  $("authForm").hidden = mode !== "form";
  $("authWait").hidden = mode !== "verify" && mode !== "denied";
  $("authWaitText").textContent = mode === "verify"
    ? `驗證信已寄到 ${auth.currentUser && auth.currentUser.email}。請到信箱點信裡的連結完成驗證，再回來按「我已完成驗證」。（找不到請看垃圾郵件）`
    : mode === "denied" ? `這個帳號（${auth.currentUser && auth.currentUser.email}）尚未開通使用權限，請聯絡管理員。` : "";
  $("authRecheck").hidden = mode !== "verify"; $("authResend").hidden = mode !== "verify";
}
const zhAuthErr = e => {
  const c = (e && e.code) || "";
  return c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found") ? "Email 或密碼不正確。"
    : c.includes("email-already-in-use") ? "這個 Email 已經註冊過了，請直接登入。"
    : c.includes("weak-password") ? "密碼至少要 6 個字元。"
    : c.includes("invalid-email") ? "Email 格式不正確。"
    : c.includes("too-many-requests") ? "嘗試次數太多，請稍後再試。"
    : c.includes("network") ? "網路連線有問題，請稍後再試。" : "發生錯誤：" + c;
};
const vals = () => ({ email: $("authEmail").value.trim(), pw: $("authPw").value });
$("authLogin").onclick = async () => {
  const { email, pw } = vals(); if (!email || !pw) return showAuth("form", "請輸入 Email 和密碼。");
  try { await signInWithEmailAndPassword(auth, email, pw); } catch (e) { showAuth("form", zhAuthErr(e)); }
};
$("authSignup").onclick = async () => {
  const { email, pw } = vals(); if (!email || !pw) return showAuth("form", "請輸入 Email 和想設定的密碼。");
  try { const r = await createUserWithEmailAndPassword(auth, email, pw); await sendEmailVerification(r.user); }
  catch (e) { showAuth("form", zhAuthErr(e)); }
};
$("authReset").onclick = async () => {
  const { email } = vals(); if (!email) return showAuth("form", "請先在上面輸入 Email，再按忘記密碼。");
  try { await sendPasswordResetEmail(auth, email); showAuth("form", "重設密碼的信已寄出，請到信箱收信。"); }
  catch (e) { showAuth("form", zhAuthErr(e)); }
};
$("authRecheck").onclick = async () => { await auth.currentUser.reload(); await auth.currentUser.getIdToken(true); route(auth.currentUser); };
$("authResend").onclick = async () => { try { await sendEmailVerification(auth.currentUser); showAuth("verify", "已重新寄出驗證信。"); } catch (e) { showAuth("verify", zhAuthErr(e)); } };
$("authOut").onclick = () => signOut(auth);
document.addEventListener("click", e => { if (e.target && e.target.id === "logoutBtn") signOut(auth).then(() => location.reload()); });

let started = false;
async function route(u){
  if (!u) return showAuth("form");
  if (!u.emailVerified) return showAuth("verify");
  let role = "admin", acc = {};
  if (!isAdmin(u)){
    try{
      const s = await getDoc(doc(fs, "access", (u.email || "").toLowerCase()));
      if (!s.exists()) return showAuth("denied");
      acc = s.data(); role = acc.role;
      if (role !== "tenant" && role !== "owner") return showAuth("denied");
    }catch(e){ return showAuth("denied"); }
  }
  // 管理員的「預覽身分」：用自己的帳號看屋主／房客看到的畫面
  let preview = null;
  if (role === "admin"){ try{ preview = JSON.parse(sessionStorage.getItem("rolePreview") || "null"); }catch(_){} }
  if (preview && (preview.role === "owner" || preview.role === "tenant")){ role = preview.role; acc = preview.acc || {}; window.__preview = true; }
  $("authBox").hidden = true;
  if (started) return;
  started = true;
  window.__role = role; window.__acc = acc; window.__uid = u.uid;
  document.body.classList.add("role-" + role);
  $("whoami").textContent = (acc.name ? acc.name + "・" : "") + u.email; $("whoBar").hidden = false;
  if (role === "tenant") uploadDir = "t/" + u.uid;
  if (window.__preview){
    const bar = document.createElement("div"); bar.className = "pvbar";
    bar.innerHTML = `<span>預覽模式：目前以${role === "owner" ? "屋主" : "房客"}「${(acc.name || "").replace(/[<>&"]/g, "")}」看到的畫面顯示</span><button type="button" id="pvExit">回到管理員</button>`;
    document.body.prepend(bar);
    $("pvExit").onclick = () => { sessionStorage.removeItem("rolePreview"); location.reload(); };
  }
  const ro = { can: async () => role === "admin" };
  hub.resolve({ db: role === "admin" ? dbApi : roleDb(role, acc), assets: role === "owner" ? null : assetsApi,
    downloads: downloadsApi, user: role === "admin" ? null : ro, role, acc });
}
setPersistence(auth, browserLocalPersistence).catch(() => {});
onAuthStateChanged(auth, u => route(u));

// ---------- 搬家：匯入舊紀錄簿匯出的檔案 ----------
const b64ToBlob = (b64, type) => { const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type }); };
function swapIds(v, map){
  if (typeof v === "string") return map[v] || v;
  if (Array.isArray(v)) return v.map(x => swapIds(x, map));
  if (v && typeof v === "object"){ const o = {}; for (const k in v) o[k] = swapIds(v[k], map); return o; }
  return v;
}
window.__fbImport = async (file, progress) => {
  const data = JSON.parse(await file.text());
  if (!data || data.kind !== "rental-log-export") throw new Error("這不是紀錄簿匯出的搬家檔。");
  const map = {}, ids = Object.keys(data.assets || {});
  let n = 0;
  for (const id of ids){
    const a = data.assets[id];
    map[id] = (await upload(b64ToBlob(a.b64, a.type), { type: a.type })).id;
    progress(`上傳照片與檔案 ${++n} / ${ids.length}`);
  }
  const writes = [];
  for (const [colName, docs] of Object.entries(data.collections || {}))
    for (const d of docs) writes.push([colName + "/" + d.id, swapIds(d.data, map)]);
  for (let i = 0; i < writes.length; i += 400){
    const b = writeBatch(fs);
    writes.slice(i, i + 400).forEach(([p, d]) => b.set(doc(fs, p), d));
    await b.commit();
    progress(`寫入資料 ${Math.min(i + 400, writes.length)} / ${writes.length}`);
  }
  return { files: ids.length, docs: writes.length };
};
window.__fbIsEmpty = async () => (await getDocs(collection(fs, "units"))).empty && (await getDocs(collection(fs, "contracts"))).empty;

// ---------- 給 roles.js 用的工具 ----------
window.__fb = {
  addDoc: (col, d) => wrap(addDoc(collection(fs, col), d)).then(r => r.id),
  setDoc: (path, d, merge) => wrap(setDoc(doc(fs, path), d, merge ? { merge: true } : undefined)),
  deleteDoc: path => wrap(deleteDoc(doc(fs, path))),
  watch: (col, cb, filters) => onSnapshot(filters ? query(collection(fs, col), ...filters.map(f => where(...f))) : collection(fs, col),
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => cb([])),
  upload,
};
