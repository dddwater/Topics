# VibeSpace Backend API

此資料夾對應團隊分工第 1 點「AI／電聲碩 A：核心後端」。

## 功能

- 使用 FastAPI 提供主要 API。
- 接收前端聲音分析資料。
- 接收空間參數：
  - `spaceSize`: `small` / `medium` / `large`
  - `ceilingMaterial`: `steel` / `concrete` / `wood`
  - `airConditioning`: `split` / `central`
- 依環境音量與空間條件進行規則式判斷。
- 回傳音樂音量、Crossfade 與空間模式。
- 提供 Swagger API 文件：`/docs`

## 啟動方式

在專案根目錄執行：

```bash
pip install -r backend/requirements.txt
uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000
```

啟動後：

- API 首頁：`http://127.0.0.1:8000/`
- 健康檢查：`http://127.0.0.1:8000/api/health`
- Swagger 文件：`http://127.0.0.1:8000/docs`

## POST /api/analyze

### Request

目前 `feature/audio-engine` 尚未提供最終資料格式，因此後端先定義最小且容易串接的聲音介面：

- `sound.level`: 必填，0.0 ~ 1.0 的正規化環境音量
- `sound.db`: 選填
- `sound.peak`: 選填，0.0 ~ 1.0

空間設定格式與現有 `feature/settings` 一致。

```json
{
  "sound": {
    "level": 0.42,
    "db": -37.5,
    "peak": 0.61
  },
  "space": {
    "spaceSize": "medium",
    "ceilingMaterial": "wood",
    "airConditioning": "central"
  }
}
```

### Response

```json
{
  "recommendation": {
    "musicVolume": 0.486,
    "crossfade": 0.539,
    "profile": "balanced-surround",
    "reason": "環境音量與空間條件的判斷說明"
  }
}
```

## 前端串接範例

```javascript
const response = await fetch("http://127.0.0.1:8000/api/analyze", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    sound: {
      level: 0.42
    },
    space: {
      spaceSize: "medium",
      ceilingMaterial: "wood",
      airConditioning: "central"
    }
  })
});

const data = await response.json();

console.log(data.recommendation.musicVolume);
console.log(data.recommendation.crossfade);
```

## 備註

目前核心判斷採「可展示、可測試、容易和前端串接」的規則式版本。

等 `feature/audio-engine` 確定實際輸出欄位後，可再擴充 `SoundAnalysis` 與
`build_recommendation()`；不需要改動空間設定資料格式。
