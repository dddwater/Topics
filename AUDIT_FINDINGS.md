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

## 🔴 高風險（原本未覆核，這次一併修復並補上回歸測試）

- [x] **transient/uncertain 狀態沒被完整忽略，可能誤觸換歌**（本次已修復）— `main.js`
  `currentState` 有防護「瞬間噪音判定不採用」，但驅動換歌決策的 `latestDecisionEnergy` 沒有同樣防護。
  → 修法：把 `latestDecisionEnergy` 的賦值併入 `currentState` 那個既有的 guard，transient/uncertain 這種 tick 完全不更新它。新增回歸測試 `testTransientSpikeDoesNotSwitchCategory`（在真的 Busy 播放中注入一次瞬間尖峰，驗證曲目邊界事件不會被誤導去切到別的類別）。

- [x] **`start()` 失敗沒有清理，麥克風／AudioContext 會卡住**（本次已修復）— `main.js`
  `player.play()` reject 時（例如瀏覽器自動播放政策擋下），已取得的資源不會釋放，下次點擊直接拋錯，需重整頁面才能恢復。
  → 修法：把資源取得到 `player.play()` 這段包進 try/catch，失敗時呼叫既有的 `stop()` 做完整清理再 rethrow。新增回歸測試 `testStartCleansUpAfterPlayFailure`（模擬第一次 play() reject，驗證麥克風被釋放、AudioContext 被關閉、且第二次呼叫 `start()` 真的能重試成功）。

- [x] **Manual 模式沒有完全凍結自動換歌**（本次已修復）— `main.js`（`handleTrackCycleComplete`）
  目前曲目跑完 2-3 輪循環後，即使 Manual 模式還是會自動選下一首；且原本的「未覆核」判斷低估了問題——真正的風險不是「有自動接歌」（完全靜音其實更糟），而是接歌時可能用到過期的 `latestDecisionEnergy`，導致 Manual 模式下悄悄跳到別的曲風類別。
  → 修法：Manual 模式下強制 `nextEnergy = event.energy`（維持剛結束那首歌的類別），而不是用 `latestDecisionEnergy`——播放不中斷、也保證曲風不會自動跳類別。新增回歸測試 `testManualModeDoesNotAutoSwitchCategoryOnCycleComplete`（刻意製造 `latestDecisionEnergy` 與實際播放類別不一致的情境，驗證 Manual 模式下曲風不會被帶著跑）。

三項回歸測試都先在還沒修的程式碼上跑過一次，確認真的會失敗，再套用修法確認轉綠——不是空測試。

- [x] **選好的模式重整/新 session 後不會保留**（上游已修復，commit `3a83af4`）
  `loadSavedSettings()` 現在會用 `VALID_OPERATION_MODES` 白名單驗證後讀回 `saved.operationMode`。

- [x] **狀態文字在瞬間噪音時會閃爍**（本次已修復，使用者截圖回報）— `main.js`（`renderDecision`）
  這項不在原始稽核清單裡，是使用者實際使用時截圖回報「常常會一閃一閃的很難看」才發現。原因：`TRANSIENT_IGNORED`/`LOW_DATA_QUALITY` 這兩種「應該完全被忽略」的 tick，`decision.energy` 會被強制設成 `"medium"`，導致 UI 把它映射回 `"social"`，讓狀態文字在那一幀短暫閃成「Social」再跳回「Quiet」——現場只要有一點雜音（腳步聲、關門聲）就會常態性觸發。
  → 修法：`renderDecision()` 在 `decision.state` 是 `"transient"`/`"uncertain"` 時直接跳過這次畫面更新，維持顯示上一個穩定狀態，音量指示條不受影響仍會照實反映音量。

- [x] **`main.js` 裡另一處過時註解 + Flow caption 重複「反應更快」的沒有依據的說法**（本次已修復）— `main.js`（`MODE_COPY` 上方）
  跟 `index.html:87`（PR #40 已修）是同一類問題，但這裡是另一個獨立出處：程式碼註解還寫著「Comfort/Balanced/Flow 只有在 Busy 時才不同，安靜房間三者完全一樣」，跟現況（Quiet/Social 音量其實也有 1dB 差距）不符；Flow 的即時 caption 文字（`#vibeModeCaption`，按下 Flow 按鈕時畫面上顯示的說明）也寫著「並更快切換到有活力的曲目」，但 Flow 跟 Balanced 用同一套 10 秒確認窗跟門檻值，沒有比較快，只有音量幅度比較大。
  → 修法：把註解改成準確描述現況（音量在每個狀態都有差，但差距很小、Busy 才會真的換曲風），Flow caption 拿掉「更快切換」，只保留「更積極提高音量，並換成有活力的曲目」。

## 🟡 中風險

> 2026-09-04 demo 前二次更新：以下 5 項是從「上台 demo 給觀眾看」角度重新篩選、優先處理的（明顯會在畫面上出錯、有雜音、或會把人踢出登入頁），其餘中風險項目維持不動、demo 後再排時間處理。

- [x] **連點「下一首」可能兩首同時有聲音**（本次已修復）`soundscape-player.js:177` — Skip 按鈕現在會在請求進行中 disable 自己（跟主開始/停止按鈕同樣的模式），避免 demo 現場手滑連點造成兩首歌同時有聲音。
- [x] **網路暫時失敗會把使用者踢出登入頁**（本次已修復）`auth.js:48` — 這是 demo 現場最怕遇到的：場地 WiFi 抖一下就把人強制登出。`requireUser()` 現在會區分「確認沒登入」跟「請求失敗」，後者不再強制導頁；順便把 `main.js` 的 `start()` 登入檢查從會打網路的 `getUser()` 換成讀本機快取的 `getSession()`，避免這個檢查本身也怕網路不穩。
- [x] **甜甜圈圖中央數字寫死**（本次已修復）`insights-view.js:28` — 原本永遠顯示 `summary.social`；用目前的示範資料實測其實 Quiet 才是最高比例（48% vs 36%），數字跟下面的圖例對不上。已改成動態算出真正比例最高的狀態，中央數字與說明文字都會正確更新。已在瀏覽器實測確認。
- [x] **insights.html 登出按鈕沒有接事件**（本次已修復）`insights.html:159` — 補上 `auth.js`/`supabase-config.js` 載入與點擊綁定（跟 index/pricing/history 同樣的寫法）；沒有改成需要登入才能看（維持原本公開展示頁的行為，只修好這顆按鈕）。已在瀏覽器實測確認會正確登出並導回登入頁。
- [x] **Comfort 模式下兩個狀態欄位顯示矛盾**（本次已修復）`main.js:389` — 原本 Comfort 模式忙碌時，「狀態」顯示 Busy 但「目前狀態」卻顯示 Social（因為 Comfort 刻意讓音樂能量跟房間判定脫鉤），畫面上兩個框互相矛盾。改成兩者共用同一個來源文字，一定一致；音樂能量若真的跟房間狀態不同，會透過既有的「· 目前仍播放 X」提示行呈現，反而更清楚。
- [ ] **快速停止→重啟可能漏記一筆**（未覆核）`session-recorder.js:36` — stop→立刻 start→stop 時，第二次 session 的開始時間可能被第一次的 `finally` 清掉。demo 正常操作步調不太會觸發，留到之後處理。
- [ ] **總使用次數/總時間統計只算最近 100 筆**（已確認）`history.js:34` + `history.html:170`（同一顆 bug） — 超過 100 筆的使用者統計悄悄變少，沒有提示。demo 帳號紀錄數不會到 100 筆，留到之後處理。
- [ ] **登入檢查/登出綁定被重複寫兩次**（已確認）`history.html:184` — inline script + `history.js` 各跑一次。不影響畫面，留到之後處理。
- [ ] **Morandi 配色小字對比度不足**（已確認）`insights.html:116` — `--busy`/`--quiet` 當文字色只有 ~3:1，未達 WCAG AA 4.5:1（舊配色 ~7.4:1）。配色本身（PR #37）已合併進 delivery，但這個對比度問題還沒修。
- [ ] **`main.js` 混雜引擎邏輯與 UI 綁定**（未覆核，架構建議）建議拆成 `audio-engine.js` + UI glue。純架構建議，不影響 demo。
- [x] **「四種模式的差異」說明面板文案與表格已過時**（本次已修復）`index.html` — intro 那句「四種模式只有在 Busy 時才會表現不同；安靜或一般交談時，四種模式完全一樣」是錯的：`context-engine.js` 的 Quiet/Social 狀態下 Comfort/Balanced/Flow 三者音量其實也都不同（commit `3a83af4` 改的，但沒有同步更新這個說明面板）。另外表格裡「Flow 反應比 Balanced 更快」也沒有程式依據——兩者用同一套 10 秒確認窗與門檻值，Flow 只有「幅度」比較大，不是「速度」比較快。已刪除該句 intro，並把表格改成列出 Quiet/Social/Busy 三種狀態的音量調整，數字都對照程式碼核對過；「Flow 更快」的說法也拿掉。已用瀏覽器實測 320–900px 寬度下表格排版都不會溢出。
- [ ] **start() 失敗後診斷欄位留著舊資料**（未覆核）`main.js:454`
- [ ] **STATE_CONFIRMING 倒數在門檻邊緣可能反覆重置，畫面可能閃爍**（已確認，使用者同意先不修）`context-engine.js` — `candidateSeconds` 只要這一幀算出的候選狀態跟上一幀不同就會歸零重來；如果現場音量長時間卡在 busy/quiet 門檻邊緣（例如客人持續進場、音量慢慢逼近門檻），畫面可能在「Social」跟「Busy · 確認中（0/10秒）」之間反覆橫跳。跟今天修的「瞬間噪音閃爍」是同一種症狀但成因不同：這個是真的卡在門檻上，不是應該被忽略的雜訊，且 `longTermDbRel` 是慢速平滑值，實務發生機率比雜訊閃爍低很多。要修的話得改 `context-engine.js` 的核心判斷邏輯（例如候選狀態要連續偏離一段時間才真的歸零），不是單純 UI 層修法，先留著。
- [ ] **隱藏的「聲學係數」悄悄縮放生產力提升%**（已確認）`pricing.html:1432` — 不同方案有 0.8/1.0/1.25 係數，UI 完全沒揭露。除非 demo 時會特別切換方案比較數字，否則不會被注意到。
- [ ] **負數金額格式化不一致**（已確認）`pricing.html:1466` — 只有刻意示範「投報為負」的極端情境才會出現。

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
- [x] `insights.html:165`（本次已修復）文案原本宣稱「本週實際聲景」「VIBE INSIGHTS · 最近 7 日」「今日時間軸」，但整頁是寫死的示範資料（`createDemoHistory()`，沒接 Supabase）。已改成「VIBE INSIGHTS · 示範資料」「本週聲景 · 示範資料」「時間軸 · 示範資料」，明確標示這是示範內容。瀏覽器實測確認排版沒有跑版。
- [ ] `main.js:297`（未覆核）頂層 DOM 查詢沒有 null guard。
- [ ] `main.js:374`（未覆核）`renderDecision` 的 `context` 參數完全沒用到。
- [ ] `main.js:500`（未覆核）Skip 失敗沒有任何提示。
- [ ] `main.js:501`（未覆核）Skip 按鈕多呼叫一次其實引擎回呼已經會觸發的 `renderTrack`。
- [ ] `session-recorder.js:51`（未覆核）模式狀態在這裡又維護了一份重複的來源。
- [ ] `freesound-candidates.js:19`（已確認）候選過濾器沒有二次驗證「Music 分類」，只信任 API。

## 測試涵蓋度

- [x] `tests/audio-selection.test.js`（本次已補上）新增 `testTransientSpikeDoesNotSwitchCategory`，涵蓋 TRANSIENT_IGNORED 在真實曲目邊界事件上的效果（`testLowDataQualityHold` 先前已涵蓋 LOW_DATA_QUALITY 分支本身）。

## 建議優先順序

1. 🔴 已確認的 6 項高風險（auth gate、pagehide 漏記、靜默失敗、pricing 三項）
2. 模式不保留（已確認，影響核心體驗與統計正確性）
3. Pricing 頁其餘中風險項目
4. 其餘中/低風險依團隊時間排入
