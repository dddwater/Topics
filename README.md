# VibeSpace

> 智慧環境音效 Web App

VibeSpace 是一個以瀏覽器運作的智慧環境音效網站。使用者可在咖啡廳、工作空間或其他室內場域開啟網站並授權麥克風；系統分析即時環境音量，再透過 Web Audio API 自動調整背景音樂、音量與混音效果。

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
  - 天花板材質：輕鋼架／水泥／木作。
  - 空調類型：分離式／中央空調。
- 主要交付：設定頁的 HTML、CSS、JavaScript，以及明確的設定資料格式。

建議設定資料格式：

```json
{
  "spaceSize": "medium",
  "ceilingMaterial": "wood",
  "airConditioning": "central"
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
