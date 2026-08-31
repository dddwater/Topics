# VibeSpace

> 讓空間自己找到它的聲音 — 智慧環境音樂 Web App

[正式展示網站](https://dddwater.github.io/Topics/) · 穩定展示分支：`delivery`

VibeSpace 是一個以瀏覽器運作的智慧環境音樂原型。使用者登入並授權麥克風後，系統會分析環境音量，判定 Quiet、Social 或 Busy 情境，再依營運策略調整播放音量與音樂能量。系統不儲存麥克風錄音，只保存使用者自己的使用時段與模式紀錄。

## 目前完成的功能

- 麥克風即時音量分析與環境情境判定。
- Quiet／Social／Busy 三類 CC0 本機音樂庫，各 5 首。
- 同類別內隨機選曲，避開目前曲目與最近 2 首。
- 環境類別不變時，每首循環 2～3 次後再換歌。
- 環境 `energy` 改變時，不中斷目前這一遍；播放結束後才依最新判定換類別。
- Comfort／Balanced／Flow／Manual 四種營運策略。
- 「下一首」手動切歌，並在新曲成功播放後才更新曲目標籤。
- Supabase Email／密碼註冊、登入、登出及 Row Level Security。
- 個人使用次數、總時間、常用模式與歷史紀錄。
- Freesound CC0 候選搜尋與授權快照規格。
- 響應式主畫面、登入頁、品牌聲景與 ROI／定價頁。

## 營運策略

| 模式 | 定位 | 系統行為 |
| --- | --- | --- |
| `Comfort` | 舒適優先 | 環境變吵時只做小幅補償，維持較柔和的音樂能量。 |
| `Balanced` | 平衡模式 | 在舒適度與現場氣氛間適度調整，為預設展示模式。 |
| `Flow` | 氣氛優先 | 現場持續活躍時，較積極提高音樂能量與少量音量。 |
| `Manual` | 人工控制 | 暫停自動類別切換，由現場人員使用「下一首」控制。 |

## 系統流程

```text
登入／註冊（Supabase Auth）
        ↓
授權麥克風（Web Audio API）
        ↓
RMS 音量分析與平滑處理
        ↓
情境判定（Quiet / Social / Busy）
        ↓
營運策略（Comfort / Balanced / Flow / Manual）
        ↓
分類內隨機選曲 → 播放與音量控制
        ↓
停止使用 → 寫入個人 usage_records
```

目前競賽版本採用靜態前端搭配 Supabase，部署於 GitHub Pages。正式商用版本可再加入後端代理，以保護 Freesound Token、集中稽核與執行更完整的資安控管。

## 主要頁面與目錄

```text
Topics/
├── index.html                  # 主播放與環境偵測頁
├── login.html                  # 登入／註冊
├── history.html                # 個人使用紀錄
├── insights.html               # 品牌聲景展示
├── pricing.html                # ROI 試算與方案頁
├── assets/
│   ├── audio/                  # 已審核 CC0 本機曲庫
│   ├── css/                    # 各頁樣式
│   ├── images/                 # 圖示與視覺資產
│   └── js/                     # 判定、播放、帳號與頁面互動
├── supabase/
│   └── schema.sql              # usage_records、RLS 與權限規格
├── tests/
│   └── audio-selection.test.js # 選曲、循環與音訊切換測試
├── ACCOUNT_SETUP.md            # Supabase 設定說明
└── README.md
```

## 團隊分工

以下依 Git commit、功能分支與已合併 PR 整理：

| 貢獻者 | 主要分工 | 對應分支／內容 |
| --- | --- | --- |
| `dddwater` | 專案整合、PR 管理、測試與 GitHub Pages 部署 | `delivery`、各整合與修正 PR |
| `CHIN FE LIU`（`emma63194`） | 主視覺播放頁、情境判定與核心播放引擎移植 | `feature/main-ui`、`feature/vibespace-core-port` |
| `shine971103` | ROI／定價頁、響應式版面與部分介面優化 | `feature/pricing`、`feature/settings` |
| `Lin Li Cheng`（`Lee9207212`） | Supabase Auth、登入註冊、個人使用紀錄、資料表與 RLS | `feature/user-account` |
| `吳志傑`（`Jay1047112`） | Supabase 專案連線與正式環境設定 | `feature/user-account` |

開發過程亦使用 Codex 協助程式檢查、測試、音樂授權整理、PR 建立與缺陷修正；所有變更皆透過分支與 PR 進入 `delivery`。

## 分支與交付狀態

| 分支 | 用途與目前狀態 |
| --- | --- |
| `main` | 最終發佈目標；目前比賽展示仍以已驗收的 `delivery` 為準。 |
| `delivery` | 團隊整合、測試、GitHub Pages 與競賽展示的穩定分支。 |
| `feature/main-ui` | 主畫面與動態視覺。已整合。 |
| `feature/audio-engine` | 早期 Web Audio 原型；經 `agent/audio-engine-delivery` 整合至現有 UI。 |
| `feature/vibespace-core-port` | 情境引擎、播放核心、分類曲庫、Freesound 候選與選曲規則。已整合。 |
| `feature/pricing` | ROI 試算與定價頁。已整合。 |
| `feature/user-account` | Supabase 帳號、使用紀錄與 favicon。已整合。 |
| `feature/login-page-redesign` | 登入頁視覺統一。已整合。 |
| `feature/settings` | 歷史空間設定功能；目前頁面已從展示版本移除。 |
| `feature/backend-api` | 後端代理規劃分支；GitHub Pages 競賽版尚未啟用。 |
| `fix/*`、`chore/*` | 播放切換、紀錄寫入、快取與頁面整理等短期修正分支。 |

## Pull Request 協作流程

1. 從最新 `delivery` 建立 `feature/*`、`fix/*` 或 `chore/*` 分支。
2. 每位成員只修改自己負責的功能，不直接改動 `main`。
3. 完成功能與測試後建立 PR：`功能分支 → delivery`。
4. 確認沒有衝突，並至少完成桌面版、行動版或相關功能測試。
5. PR 合併後等待 GitHub Pages 部署，再於正式網址驗收。
6. 比賽版本穩定後，才由組長評估建立 `delivery → main` 的 PR。

## 本機執行與測試

這是靜態網站，不建議直接以 `file://` 開啟。請在專案根目錄啟動本機 HTTP Server，例如：

```powershell
py -m http.server 8765
```

再開啟 `http://127.0.0.1:8765/`。麥克風功能需要瀏覽器授權；帳號與使用紀錄需要有效的 `assets/js/supabase-config.js`。

若已安裝 Node.js，可執行：

```powershell
node --test tests/audio-selection.test.js
```

測試涵蓋分類內短期不重複、2／3 次循環、環境變化後於歌曲邊界換類別、快速切歌單一音軌，以及 Freesound 候選篩選。

## 音樂來源與 Freesound 規範

- 正式播放只使用已下載、已人工審核並記錄來源的本機 CC0 曲庫。
- Freesound API 只提供動態候選，不直接自動加入正式曲庫。
- 候選必須為 CC0、Music 類別、至少 60 秒且具有可播放預覽。
- 正式加入前保存作者、來源 URL、授權類型與取得時間快照。
- API Token 不得提交到 Git；正式產品應由後端代理保管。

本機測試可在載入應用前注入：

```js
window.VIBESPACE_FREESOUND_API_KEY = "YOUR_LOCAL_TEST_TOKEN";
```

未設定 Token 時，Freesound 候選功能保持停用，不影響本機 CC0 曲庫播放。

## 資料與資安原則

- 麥克風資料只在瀏覽器即時分析，不錄音、不上傳原始音訊。
- 使用紀錄透過 Supabase RLS 限制為本人讀取與寫入。
- 儲存內容以使用時間、模式與場景資料為主，不保存密碼或麥克風內容。
- 不將 API Key、Token、密碼或服務端金鑰提交到 GitHub。
- 展示環境使用匿名 Key 搭配 RLS；正式商用環境仍需後端代理、日誌與異常監控。

## Demo 建議流程

1. 註冊或登入測試帳號。
2. 回到主畫面，選擇 `Balanced` 後按「開始」。
3. 允許麥克風，觀察環境狀態、音量視覺與曲目標籤。
4. 展示同類別循環、環境改變後於曲目結束時換類別，以及手動「下一首」。
5. 按「停止」，進入「我的紀錄」確認使用次數與時間。

