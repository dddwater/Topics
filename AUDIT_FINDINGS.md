# VibeSpace 專案問題清單

> 產生日期：2026-09-04 · 分支：`style/insights-morandi-state-colors`
> 方法：5 個子系統（音訊/情境引擎、Auth/帳號/資料、Insights/History、主控頁 main.js、Pricing/Freesound）各由一個審查代理深入讀碼，共找出 43 項發現；其中 26 項由第二位審查代理重新讀碼獨立驗證（全數 **CONFIRMED**，0 項被推翻）。另外 17 項因驗證階段中途撞到帳號 session 額度上限而未能覆核，標記為「未覆核」——這些只是單一審查員的判斷，實際修之前建議自己再確認一次。
>
> 用法：這是一份可勾選的待辦清單，修完就打勾；如果判斷某項其實不算問題，也可以直接刪掉或加註說明。

## 🔴 高風險（已交叉驗證）

> 2026-09-04 更新：開始修這批之前重新核對了一次現況，發現 `delivery` 在稽核之後、開始修之前，已經有 3 個 PR（#34/#35/#36，同樣是這個帳號 CHIN FE LIU 推的）先修掉了「模式不保留」「插曲百分比加總」「pricing.js/css 孤兒檔案」三項——這兩項下面標成「上游已修復」。其餘由這次 session 實作修復，標成「本次已修復」。

- [x] **登入檢查沒有真正生效**（本次已修復）— `index.html:96`, `main.js:203`
  `requireUser()` 沒有 `await`，頁面（含麥克風按鈕）在導頁生效前就可互動；`VibeAudioEngine.start()` 本身也不檢查登入狀態。「未登入導向登入頁」原本只是裝飾性跳轉，不是真正的存取控制。
  → 修法：`index.html` 的 `<main id="vibePanel">` 預設 `hidden`，`await requireUser()` 拿到真的使用者才移除；`main.css` 加 `.vibe-panel[hidden]{display:none}` 蓋掉原本 `display:flex`；`main.js` 的 `start()` 內部也加上 `await window.VibeSpaceAuth?.getUser?.()` 檢查，當作縱深防禦。

- [x] **離開頁面時當次使用紀錄會遺失**（本次已修復）— `main.js:291`
  `pagehide` 監聽器原本直接呼叫底層引擎的 `stop()`，繞過 UI 的 `stop()` wrapper，不會觸發 `vibespace:session-stop`，`session-recorder.js` 完全不知道要寫紀錄。
  → 修法：把 `pagehide` 監聽器移到 UI IIFE，改呼叫 UI 自己的 `stop()`（跟按「停止」鈕走同一條路徑，會正確 dispatch `vibespace:session-stop`）。

- [x] **Supabase 寫入失敗只 `console.warn`，使用者不會知道**（本次已修復）— `session-recorder.js:34`
  失敗時紀錄直接消失，沒有 UI 提示或重試機制。
  → 修法：新增 `showSaveFailureNotice()`，失敗時在畫面下方彈出 6 秒的提示文字（`.vibe-save-notice`，新增於 `main.css`）。未做佇列重試（範圍超出這次的修法）。

- [x] **`pricing.js` / `pricing.css` 是孤兒檔案**（上游已修復，commit `af8d9d3`）
  已被刪除；`pricing.html` 的 inline `<style>`/`<script>` 是唯一實際生效的版本。

- [x] **ROI 試算頁：輸入框 clamp 沒生效**（本次已修復）— `pricing.html:1371`
  員工數／薪資輸入框的數字 clamp 到局部變數後，原本只套用到滑桿，顯示與計算讀的還是輸入框裡未夾限的原始值。
  → 修法：clamp 後把值寫回 `empInput.value` / `salaryInput.value` 本身。已用 Node 直接執行實際程式碼驗證：輸入 250（上限 200）後欄位正確變回 `200`。

- [x] **ROI 試算頁：年繳折扣沒反映在試算結果**（本次已修復）— `pricing.html:1439`
  切換「年繳方案」原本只改方案卡片顯示，`calculateROI()` 沒吃到那個折扣，ROI 數字跟月繳一樣。
  → 修法：`calculateROI()` 內的 `monthlyPlanCost` 依 `isYearly` 套用與價格卡片相同的 0.8 折扣係數。已驗證切換年繳後 `outAnnualGain` 數字確實改變。

## 🔴 高風險（未覆核，僅單一審查員判斷，尚未修）

- [ ] **transient/uncertain 狀態沒被完整忽略，可能誤觸換歌** — `main.js:180`（原稿標 163，現況行號已偏移）
  `currentState` 有防護「瞬間噪音判定不採用」，但驅動換歌決策的 `latestDecisionEnergy` 沒有同樣防護。已重新核對現況程式碼，bug 仍在。

- [ ] **`start()` 失敗沒有清理，麥克風／AudioContext 會卡住** — `main.js:221`（原稿標 203，現況行號已偏移）
  `player.play()` reject 時（例如瀏覽器自動播放政策擋下），已取得的資源不會釋放，下次點擊直接拋錯，需重整頁面才能恢復。已重新核對現況程式碼，bug 仍在。

- [ ] **Manual 模式沒有完全凍結自動換歌** — `main.js:83`（`handleTrackCycleComplete` 沒有 `operationMode === "manual"` 的早退，`handleTrackEnded` 有）
  目前曲目跑完 2-3 輪循環後，即使 Manual 模式還是會自動選下一首。已重新核對現況程式碼，bug 仍在。

- [x] **選好的模式重整/新 session 後不會保留**（上游已修復，commit `3a83af4`）
  `loadSavedSettings()` 現在會用 `VALID_OPERATION_MODES` 白名單驗證後讀回 `saved.operationMode`。

## 🟡 中風險

- [ ] **快速停止→重啟可能漏記一筆**（未覆核）`session-recorder.js:36` — stop→立刻 start→stop 時，第二次 session 的開始時間可能被第一次的 `finally` 清掉。
- [ ] **連點「下一首」可能兩首同時有聲音**（未覆核）`soundscape-player.js:177` — 沒有防連點/disable。
- [ ] **網路暫時失敗會把使用者踢出登入頁**（已確認）`auth.js:48` — `requireUser()` 把「網路失敗」跟「真的沒登入」一視同仁，強制導回登入頁，會中斷正在使用的 session。
- [ ] **總使用次數/總時間統計只算最近 100 筆**（已確認）`history.js:34` + `history.html:170`（同一顆 bug） — 超過 100 筆的使用者統計悄悄變少，沒有提示。
- [ ] **甜甜圈圖中央數字寫死**（已確認）`insights-view.js:28` — 顯示 `summary.social`，不是真正比例最高的狀態。
- [ ] **登入檢查/登出綁定被重複寫兩次**（已確認）`history.html:184` — inline script + `history.js` 各跑一次。
- [ ] **Morandi 配色小字對比度不足**（已確認）`insights.html:116` — `--busy`/`--quiet` 當文字色只有 ~3:1，未達 WCAG AA 4.5:1（舊配色 ~7.4:1）。
- [ ] **insights.html 登出按鈕沒有接事件**（已確認）`insights.html:159`
- [ ] **`main.js` 混雜引擎邏輯與 UI 綁定**（未覆核，架構建議）建議拆成 `audio-engine.js` + UI glue。
- [ ] **Comfort 模式下兩個狀態欄位顯示矛盾**（已確認）`main.js:389` — `#vibeStatus` 顯示 Busy，旁邊「目前狀態」卻顯示 Social。
- [ ] **start() 失敗後診斷欄位留著舊資料**（未覆核）`main.js:454`
- [ ] **隱藏的「聲學係數」悄悄縮放生產力提升%**（已確認）`pricing.html:1432` — 不同方案有 0.8/1.0/1.25 係數，UI 完全沒揭露。
- [ ] **負數金額格式化不一致**（已確認）`pricing.html:1466`

## 🟢 低風險／可讀性、維護性

- [ ] `context-engine.js:108` + `main.js:150`（未覆核）`tempoChange`/`canChangeTrack` 是死碼，呼叫端永遠傳 `true`，欄位算出來沒人讀。
- [ ] `track-selector.js:30`（未覆核）選歌後立刻記入防重複歷史，即使後續播放失敗也不撤銷。
- [ ] `login.js:35`（已確認）Email 已註冊時的防列舉回應跟真的新註冊成功文案一樣，會誤導使用者。
- [ ] `login.js:51`（已確認）外層 try/catch 永遠不會被觸發，錯誤實際被 `.catch(() => {})` 吞掉。
- [ ] `session-recorder.js:32`（已確認）`avg_db` 永遠寫死 `null`，main.js 有算即時 dB 卻沒接進去。
- [ ] `schema.sql:10`（已確認）`operation_mode`/`acoustic_profile` 沒有 CHECK constraint。
- [x] `insights.js:73`（上游已修復，commit `b019df3`）三個百分比原本各自四捨五入不保證加總 100；已改為 largest-remainder 演算法保證加總等於 100。
- [ ] `insights.html:19`（已確認）`--accent-cyan` 是配色改版後的死 CSS 變數。
- [ ] `insights.html:121`（已確認）熱力圖時間標籤跟資料格子欄寬算法不同，沒對齊。
- [ ] `insights.html:165`（已確認）文案宣稱「本週實際聲景」，但整頁是寫死的示範資料，沒接 Supabase。
- [ ] `main.js:297`（未覆核）頂層 DOM 查詢沒有 null guard。
- [ ] `main.js:374`（未覆核）`renderDecision` 的 `context` 參數完全沒用到。
- [ ] `main.js:500`（未覆核）Skip 失敗沒有任何提示。
- [ ] `main.js:501`（未覆核）Skip 按鈕多呼叫一次其實引擎回呼已經會觸發的 `renderTrack`。
- [ ] `session-recorder.js:51`（未覆核）模式狀態在這裡又維護了一份重複的來源。
- [ ] `freesound-candidates.js:19`（已確認）候選過濾器沒有二次驗證「Music 分類」，只信任 API。

## 測試涵蓋度

- [ ] `tests/audio-selection.test.js`（未覆核）沒有測試涵蓋 `decideContext` 的 TRANSIENT_IGNORED / LOW_DATA_QUALITY 分支——正好是上面「main.js:163」那顆 bug 藏身的地方。

## 建議優先順序

1. 🔴 已確認的 6 項高風險（auth gate、pagehide 漏記、靜默失敗、pricing 三項）
2. 模式不保留（已確認，影響核心體驗與統計正確性）
3. Pricing 頁其餘中風險項目
4. 其餘中/低風險依團隊時間排入
