# 包租代管紀錄簿（網站版）

網址：https://raywu02070209-ship-it.github.io/rent/

- `index.html`：網站本體（由 `tools/build.py` 從紀錄簿產生）
- `js/fb.js`：登入、資料庫、檔案儲存（Firebase）
- `firestore.rules`、`storage.rules`：資料權限規則（貼到 Firebase 控制台）
- `cors.json`：檔案儲存的跨網域設定（產生合約 PDF 需要）

資料（房客、合約、照片）都存在 Firebase，需登入才能存取，不在這個公開的程式碼倉庫裡。
