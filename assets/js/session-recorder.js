(() => {
  const toggle = document.getElementById("vibeToggle");
  if (!toggle || !window.VibeSpaceAuth) return;

  let sessionStartedAt = null;
  let profileName = null;
  let mode = null;
  let saving = false;

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
    } finally {
      sessionStartedAt = null;
      saving = false;
    }
  }

  toggle.addEventListener("click", () => {
    const wasActive = toggle.getAttribute("aria-pressed") === "true";

    setTimeout(async () => {
      const isActive = toggle.getAttribute("aria-pressed") === "true";
      if (!wasActive && isActive) {
        const user = await refreshIdentity();
        if (user) sessionStartedAt = new Date();
      } else if (wasActive && !isActive) {
        await saveSession();
      }
    }, 250);
  });

  document.querySelectorAll("[data-vibe-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      mode = button.dataset.vibeMode || mode;
    });
  });

  refreshIdentity().catch((error) => console.warn(error));
})();
