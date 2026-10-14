# 包租代管紀錄簿（網站版）

網址：https://raywu02070209-ship-it.github.io/rent/

- `index.html`：網站本體（最初由 `tools/build.py` 從 Claude 版紀錄簿轉換，之後直接修改這個檔案）
- `js/roles.js`、`css/roles.css`：房客、屋主、管理員各自的功能（報修、線上簽續約、帳號權限）
- `js/fb.js`：登入、資料庫、檔案儲存（Firebase）
- `firestore.rules`、`storage.rules`：資料權限規則（貼到 Firebase 控制台）
- `cors.json`：檔案儲存的跨網域設定（產生合約 PDF 需要）

資料（房客、合約、照片）都存在 Firebase，需登入才能存取，不在這個公開的程式碼倉庫裡。
