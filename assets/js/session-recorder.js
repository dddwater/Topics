(() => {
  const toggle = document.getElementById("vibeToggle");
  if (!toggle || !window.VibeSpaceAuth) return;

  let sessionStartedAt = null;
  let profileName = null;
  let mode = null;
  let saving = false;
  let noticeTimer = null;

  function showSaveFailureNotice() {
    let notice = document.getElementById("vibeSaveNotice");
    if (!notice) {
      notice = document.createElement("p");
      notice.id = "vibeSaveNotice";
      notice.className = "vibe-save-notice";
      notice.setAttribute("role", "alert");
      document.body.appendChild(notice);
    }
    notice.textContent = "本次使用紀錄儲存失敗，請確認網路連線；可稍後至「我的紀錄」查看。";
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 6000);
  }

  async function refreshIdentity() {
    const user = await window.VibeSpaceAuth.requireUser();
    if (!user) return null;
    const config = window.VibeAudioEngine?.getConfiguration?.();
    profileName = config?.profile?.name || null;
    mode = config?.operationMode || null;
    return user;
  }

  async function saveSession() {
    if (!sessionStartedAt || saving) return;
    saving = true;
    const endedAt = new Date();
    const durationSeconds = Math.max(1, Math.round((endedAt.getTime() - sessionStartedAt.getTime()) / 1000));

    try {
      await window.VibeSpaceAuth.addUsageRecord({
        startedAt: sessionStartedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds,
        operationMode: mode,
        acousticProfile: profileName,
        avgDb: null,
      });
    } catch (error) {
      console.warn("VibeSpace usage record was not saved:", error);
      showSaveFailureNotice();
    } finally {
      sessionStartedAt = null;
      saving = false;
    }
  }

  window.addEventListener("vibespace:session-start", async () => {
    const user = await refreshIdentity();
    if (user) sessionStartedAt = new Date();
  });

  window.addEventListener("vibespace:session-stop", async () => {
    await saveSession();
  });

  document.querySelectorAll("[data-vibe-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      mode = button.dataset.vibeMode || mode;
    });
  });

  refreshIdentity().catch((error) => console.warn(error));
})();

