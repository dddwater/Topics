# VibeSpace

> 智慧環境音效 Web App

VibeSpace 是一個以瀏覽器運作的智慧環境音效網站。使用者可在咖啡廳、工作空間或其他室內場域開啟網站並授權麥克風；系統分析即時環境音量，再透過 Web Audio API 自動調整背景音樂、音量與混音效果。

## 自動選曲與 Freesound 候選來源

- 正式播放只使用已下載、已審核且記錄來源的本機 CC0 曲庫。
- 每首歌曲隨機循環 2 或 3 次，再於相同環境分類內隨機換歌。
- 每個分類保留最近 2 首的選曲紀錄，盡量避免短時間重複。
- 只有 Quiet、Social、Busy 偵測狀態改變時，才會切換到另一個分類。
- Freesound API 僅作為候選搜尋來源，不會直接播放或正式加入未審核歌曲。
- 候選結果必須是 CC0、Music 類別、至少 60 秒，並提供可播放預覽。
- 下載或正式加入候選曲前，先呼叫 `VibeSpaceFreesound.saveLicenseSnapshot(candidate)` 保存作者、來源、授權與時間快照。

Freesound API Key 不得提交到 Git。測試時可在載入應用程式前以執行環境注入：

```js
window.VIBESPACE_FREESOUND_API_KEY = "YOUR_LOCAL_TEST_TOKEN";
```

沒有設定 Key 時，Freesound 候選功能會保持停用，本機曲庫仍可正常播放。

## Demo 使用情境

1. 使用者以筆電或 iPad 開啟 VibeSpace。
2. 網頁請求麥克風權限。
3. 主畫面顯示具有動態效果的 Vibe UI。
4. 網頁即時分析麥克風接收到的環境音量。
5. 系統根據噪音與空間設定，自動調整環境音樂。

## 團隊分工

### 1. AI／電聲碩 A：核心後端

- 負責主要 API，建議使用 Python FastAPI 或 Flask。
- 接收前端聲音分析資料與空間參數。
- 處理核心判斷邏輯並將結果回傳前端。
- 主要交付：後端伺服器、API 文件與資料格式。

### 2. AI／電聲碩 B：前端聲音引擎

- 使用 JavaScript 與 Web Audio API 開發瀏覽器端聲音處理。
- 取得麥克風音訊並分析環境音量。
- 負責播放音樂、調整音量，以及 Crossfade 混音。
- 主要交付：可供主畫面呼叫的聲音引擎模組。

### 3. 電影／電聲碩：主視覺播放頁面

- 負責使用者進入網站後看到的主播放畫面。
- 以 HTML、CSS 與 JavaScript 製作具有電影感的動態背景。
- 視覺方向可包含毛玻璃、隨機漸層、呼吸燈與聲音反應動畫。
- 主要交付：`index.html` 與相關樣式、互動檔案。

### 4. 營建管理（水電）：空間參數設定頁

- 負責 `settings.html`。
- 將營建與空間知識轉換為後端及混音引擎可以使用的選項。
- 設定項目：
  - 空間坪數：小型／中型／大型。
  - 使用環境：餐廳／辦公室／咖啡廳／教室或會議室。
  - 空間類別：開放／半開放／封閉。
- 使用者儲存設定後，播放器會優先使用手動聲學模式；天花板、空調與混音參數由系統推導。
- 主要交付：設定頁的 HTML、CSS、JavaScript，以及明確的設定資料格式。

建議設定資料格式：

```json
{
  "version": 2,
  "source": "manual",
  "spaceSize": "medium",
  "environment": "office",
  "spaceType": "enclosed",
  "acousticProfile": {
    "id": "near-field",
    "name": "近場清晰"
  }
}
```

### 5. 會計系：ROI 試算與定價頁

- 負責 `pricing.html`。
- 讓企業輸入員工月薪與員工人數。
- 以簡單公式試算每月預估提升的生產力價值，例如：`員工總薪資 × 0.05`。
- 顯示不同版本的訂閱月費方案。
- 主要交付：ROI 計算互動、定價表與相關前端檔案。

## 建議專案結構

```text
Topics/
├── index.html
├── settings.html
├── pricing.html
├── assets/
│   ├── audio/
│   ├── css/
│   ├── images/
│   └── js/
├── backend/
│   ├── app.py
│   └── requirements.txt
└── README.md
```

共用檔案請依類型放入 `assets`，避免每位組員各自複製相同內容。各頁面先保持可獨立執行，最後再由 `index.html` 加入導覽連結完成整合。

## 分支規劃

```text
main
└── delivery
    ├── feature/settings
    ├── feature/main-ui
    ├── feature/audio-engine
    └── feature/pricing
```

| 分支 | 用途 |
| --- | --- |
| `main` | 穩定、可展示的版本，只接收由 `delivery` 提出的 PR |
| `delivery` | 全組整合與測試分支 |
| `feature/settings` | 空間參數設定頁 |
| `feature/main-ui` | 主視覺播放頁面 |
| `feature/audio-engine` | 麥克風分析、播放及混音邏輯 |
| `feature/pricing` | ROI 試算與定價頁 |

核心後端負責人可在開始開發時，另外從 `delivery` 建立 `feature/backend-api`。

## Pull Request 協作流程

1. 開始工作前，先將最新的 `delivery` 同步到自己的功能分支。
2. 每個人只在自己的 `feature/*` 分支開發，不直接修改 `main`。
3. 完成一個可測試的功能後，建立 Pull Request：`feature/* → delivery`。
4. 至少請一位相關組員檢查頁面能否開啟、資料格式是否一致。
5. 全部功能在 `delivery` 完成整合與 Demo 測試後，由組長建立 Pull Request：`delivery → main`。
6. 發生衝突時，由該功能負責人與組長一起處理，避免直接覆蓋其他人的檔案。

## 整合原則

- 頁面之間使用相對路徑，例如 `settings.html` 與 `pricing.html`。
- JavaScript 模組應清楚說明輸入、輸出與事件名稱。
- 前後端交換資料時統一使用 JSON。
- 不提交密碼、API key、麥克風錄音或個人資料。
- 合併前至少在桌面與行動裝置尺寸各測試一次。
