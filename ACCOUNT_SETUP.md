# VibeSpace 帳號功能設定

此功能位於 `feature/user-account`，並以 `delivery` 為基底。

## 已加入功能

- Email / Password 註冊與登入
- Supabase Auth 登入狀態
- 未登入時由首頁導向 `login.html`
- 登出
- 個人使用紀錄
- 每次 VibeSpace 啟動到停止會儲存一筆 session
- `history.html` 顯示個人總使用次數、總時間、常用模式與歷史紀錄
- PostgreSQL Row Level Security (RLS)，每位使用者只能讀寫自己的紀錄

## 1. 建立 Supabase Project

建立專案後，在 Supabase Dashboard 找到：

- Project URL
- anon / public key

不要把 `service_role` key 放在前端。

## 2. 設定前端

編輯：

`assets/js/supabase-config.js`

```js
window.VIBESPACE_SUPABASE = {
  url: "https://YOUR_PROJECT.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY",
};
```

## 3. 建立資料表

到 Supabase > SQL Editor，執行：

`supabase/schema.sql`

此 SQL 會建立 `usage_records`，並啟用 RLS。

## 4. Auth 設定

到 Supabase > Authentication > Providers，確認 Email provider 已啟用。

開發階段若希望註冊後立即登入，可以暫時關閉 Confirm email；正式環境建議保留 Email 驗證。

## 5. 本機測試

因為瀏覽器登入與麥克風 API 最好透過 HTTP server 執行，不建議直接雙擊 HTML。

例如：

```bash
python -m http.server 8000
```

然後開啟：

`http://localhost:8000/login.html`

## 檔案位置

```text
Topics/
├── login.html
├── history.html
├── ACCOUNT_SETUP.md
├── supabase/
│   └── schema.sql
└── assets/
    ├── css/
    │   └── account.css
    └── js/
        ├── auth.js
        ├── login.js
        ├── history.js
        ├── session-recorder.js
        ├── supabase-config.js
        └── supabase-config.example.js
```

另外 `index.html` 已加入登入驗證、我的紀錄與登出入口。

## 合併流程

完成 Supabase 實際設定並測試後：

`feature/user-account` → Pull Request → `delivery`

確認與其他功能整合無誤後，再由 `delivery` 合併至 `main`。
