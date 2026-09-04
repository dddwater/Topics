(() => {
  let client = null;

  function getClient() {
    if (client) return client;
    const config = window.VIBESPACE_SUPABASE;
    if (!config?.url || !config?.anonKey || config.url.includes("YOUR_PROJECT")) {
      throw new Error("尚未設定 Supabase。請建立 assets/js/supabase-config.js。 ");
    }
    if (!window.supabase?.createClient) {
      throw new Error("Supabase SDK 尚未載入。");
    }
    client = window.supabase.createClient(config.url, config.anonKey);
    return client;
  }

  async function signUp(email, password, displayName = "") {
    const supabase = getClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const supabase = getClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const supabase = getClient();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  async function getUser() {
    const supabase = getClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user;
  }

  // Unlike getUser(), this reads the locally-stored session and only hits
  // the network if the token actually needs refreshing — safe to call from
  // a hot path (e.g. as a quick "are we logged in at all" check) without
  // depending on a live round-trip every time.
  async function getSession() {
    const supabase = getClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function requireUser(redirectTo = "login.html") {
    try {
      const user = await getUser();
      if (!user) window.location.href = redirectTo;
      return user;
    } catch (error) {
      // A network/server error here is not the same as "confirmed logged
      // out" — redirecting on it would force an already-listening user
      // straight to the login page over a transient blip (session-recorder.js
      // re-checks this on every session start). Fail open instead.
      console.warn("VibeSpace: could not verify the current user (leaving session as-is):", error);
      return null;
    }
  }

  async function addUsageRecord(record) {
    const supabase = getClient();
    const user = await getUser();
    if (!user) throw new Error("尚未登入");

    const payload = {
      user_id: user.id,
      started_at: record.startedAt,
      ended_at: record.endedAt,
      duration_seconds: record.durationSeconds,
      operation_mode: record.operationMode || null,
      avg_db: Number.isFinite(record.avgDb) ? record.avgDb : null,
      acoustic_profile: record.acousticProfile || null,
    };

    const { data, error } = await supabase
      .from("usage_records")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function listUsageRecords(limit = 50) {
    const supabase = getClient();
    const user = await getUser();
    if (!user) throw new Error("尚未登入");

    const { data, error } = await supabase
      .from("usage_records")
      .select("id, started_at, ended_at, duration_seconds, operation_mode, avg_db, acoustic_profile")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  window.VibeSpaceAuth = {
    getClient,
    signUp,
    signIn,
    signOut,
    getUser,
    getSession,
    requireUser,
    addUsageRecord,
    listUsageRecords,
  };
})();
