// Firebase 網頁設定（公開資訊，不是密碼；資料安全由 Firebase 安全規則控管）
export const firebaseConfig = {
  apiKey: "AIzaSyAOf8DUJdlElHgcZtk7GEazAOeDQycOrFU",
  authDomain: "rent-chengrui.firebaseapp.com",
  projectId: "rent-chengrui",
  storageBucket: "rent-chengrui.firebasestorage.app",
  messagingSenderId: "745584484764",
  appId: "1:745584484764:web:9b5159793232adbe6e6859"
};

// 管理員（可使用全部功能）。之後新增助理、屋主會另外設定權限。
export const ADMIN_EMAILS = ["raywu02070209@gmail.com"];
