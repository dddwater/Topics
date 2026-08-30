(() => {
  const form = document.getElementById("accountForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const displayNameInput = document.getElementById("displayName");
  const nameField = document.getElementById("nameField");
  const submitButton = document.getElementById("submitBtn");
  const message = document.getElementById("message");
  const tabs = Array.from(document.querySelectorAll("[data-mode]"));
  let mode = "login";

  function setMode(nextMode) {
    mode = nextMode;
    tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.mode === mode));
    nameField.classList.toggle("is-hidden", mode !== "signup");
    passwordInput.autocomplete = mode === "signup" ? "new-password" : "current-password";
    submitButton.textContent = mode === "signup" ? "建立帳號" : "登入";
    message.textContent = "";
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    message.textContent = "處理中…";

    try {
      if (mode === "signup") {
        const result = await window.VibeSpaceAuth.signUp(
          emailInput.value.trim(),
          passwordInput.value,
          displayNameInput.value.trim()
        );
        if (result.session) {
          window.location.href = "index.html";
          return;
        }
        message.textContent = "帳號已建立。若專案啟用 Email 驗證，請先到信箱完成驗證。";
      } else {
        await window.VibeSpaceAuth.signIn(emailInput.value.trim(), passwordInput.value);
        window.location.href = "index.html";
      }
    } catch (error) {
      message.textContent = error.message || "登入失敗，請稍後再試。";
    } finally {
      submitButton.disabled = false;
    }
  });

  try {
    window.VibeSpaceAuth.getUser().then((user) => {
      if (user) window.location.href = "index.html";
    }).catch(() => {});
  } catch (error) {
    message.textContent = error.message;
  }
})();
