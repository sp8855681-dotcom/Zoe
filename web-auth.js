(() => {
  const sessionKey = "zoeWebSession";

  function readSession() {
    const stored = sessionStorage.getItem(sessionKey);
    if (!stored) return null;
    try {
      const session = JSON.parse(stored);
      return typeof session.accessToken === "string"
        && typeof session.refreshToken === "string"
        ? session
        : null;
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    if (!session?.accessToken || !session?.refreshToken) {
      throw new Error("The account service did not return a valid sign-in session.");
    }
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
  }

  function clearSession() {
    sessionStorage.removeItem(sessionKey);
  }

  async function request(endpoint, body, accessToken) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(result.error || "The account service could not complete your request."), {
        status: response.status,
      });
    }
    return result;
  }

  async function refreshSession(session) {
    try {
      const result = await request(
        "/v1/auth/refresh",
        { refreshToken: session.refreshToken },
        session.accessToken,
      );
      saveSession(result.session);
      return result.session;
    } catch (error) {
      if (error.status === 401 || error.status === 400) clearSession();
      throw error;
    }
  }

  async function authenticatedRequest(endpoint, body) {
    let session = readSession();
    if (!session) throw new Error("Sign in to continue.");

    try {
      return await request(endpoint, body, session.accessToken);
    } catch (error) {
      if (error.status !== 401) throw error;
      session = await refreshSession(session);
      return request(endpoint, body, session.accessToken);
    }
  }

  async function authenticate({ mode, email, password, name }) {
    const result = await request(`/v1/auth/${mode}`, { email, password, name });
    if (!result.needsEmailConfirmation) saveSession(result.session);
    return result;
  }

  async function getSession() {
    if (!readSession()) return null;
    try {
      const result = await authenticatedRequest("/v1/auth/session", {});
      return result.user;
    } catch (error) {
      if (error.status === 401 || error.status === 400) clearSession();
      throw error;
    }
  }

  async function signOut() {
    try {
      await authenticatedRequest("/v1/auth/signout", {});
    } finally {
      clearSession();
    }
  }

  async function chat(message) {
    return authenticatedRequest("/v1/chat", { message, surface: "web" });
  }

  window.zoeWebAuth = Object.freeze({ authenticate, getSession, signOut, chat });
})();
