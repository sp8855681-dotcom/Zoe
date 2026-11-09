const http = require("node:http");
const { randomUUID } = require("node:crypto");

const MAX_BODY_BYTES = 16 * 1024;
const AUTH_LIMIT = { count: 8, windowMs: 60_000 };
const CHAT_LIMIT = { count: 20, windowMs: 60_000 };
const requestCounts = new Map();

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function isRateLimited(key, limit, now = Date.now()) {
  const current = requestCounts.get(key);
  if (requestCounts.size >= 5000 && (!current || current.resetAt <= now)) {
    for (const [storedKey, entry] of requestCounts) {
      if (entry.resetAt <= now) requestCounts.delete(storedKey);
    }
    if (requestCounts.size >= 5000) return true;
  }
  if (!current || current.resetAt <= now) {
    requestCounts.set(key, { count: 1, resetAt: now + limit.windowMs });
    return false;
  }
  current.count += 1;
  return current.count > limit.count;
}

function profileFrom(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.display_name || user.email?.split("@")[0] || "there",
  };
}

function createServer({ env = process.env, fetchImpl = fetch } = {}) {
  async function supabaseRequest(path, options = {}) {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      throw Object.assign(new Error("The account service is not configured."), { status: 503 });
    }
    const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, "")}${path}`, {
      ...options,
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(result.msg || result.message || result.error_description || "The account service rejected the request."), {
        status: response.status === 401 ? 401 : response.status === 429 ? 429 : response.status >= 500 ? 502 : 400,
      });
    }
    return result;
  }

  async function authenticate(body, mode) {
    if (typeof body.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
    }
    if (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 256) {
      throw Object.assign(new Error("Password must be between 10 and 256 characters."), { status: 400 });
    }

    const isSignup = mode === "signup";
    if (isSignup && (typeof body.name !== "string" || !body.name.trim() || body.name.length > 60)) {
      throw Object.assign(new Error("Enter a name of at most 60 characters."), { status: 400 });
    }
    const path = isSignup ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
    const payload = {
      email: body.email.trim().toLowerCase(),
      password: body.password,
      ...(isSignup ? { data: { display_name: body.name.trim() } } : {}),
    };
    const result = await supabaseRequest(path, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (isSignup && !result.access_token) {
      return { needsEmailConfirmation: true };
    }
    if (!result.access_token || !result.refresh_token || !result.user) {
      throw Object.assign(new Error("The account service did not return a usable session."), { status: 502 });
    }
    return {
      session: {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
      },
      user: profileFrom(result.user),
    };
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        configured: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.OPENAI_API_KEY),
      });
      return;
    }

    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    const body = await readJson(request);
    if (url.pathname === "/v1/auth/signup" || url.pathname === "/v1/auth/signin") {
      const address = request.socket.remoteAddress || "unknown";
      if (isRateLimited(`auth:${address}`, AUTH_LIMIT)) {
        sendJson(response, 429, { error: "Too many sign-in attempts. Please wait a minute and try again." });
        return;
      }
      const result = await authenticate(body, url.pathname.endsWith("signup") ? "signup" : "signin");
      sendJson(response, 200, result);
      return;
    }

    const authorization = request.headers.authorization || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) {
      sendJson(response, 401, { error: "Sign in to continue." });
      return;
    }

    if (url.pathname === "/v1/auth/refresh") {
      if (typeof body.refreshToken !== "string" || !body.refreshToken) {
        sendJson(response, 400, { error: "A refresh token is required." });
        return;
      }
      const refreshed = await supabaseRequest("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: body.refreshToken }),
      });
      if (!refreshed.access_token || !refreshed.refresh_token || !refreshed.user) {
        throw Object.assign(new Error("The account service did not return a refreshed session."), { status: 502 });
      }
      sendJson(response, 200, {
        session: {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
        },
        user: profileFrom(refreshed.user),
      });
      return;
    }

    const authUser = await supabaseRequest("/auth/v1/user", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (url.pathname === "/v1/auth/session") {
      sendJson(response, 200, { user: profileFrom(authUser) });
      return;
    }

    if (url.pathname === "/v1/auth/signout") {
      await supabaseRequest("/auth/v1/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      sendJson(response, 200, { signedOut: true });
      return;
    }

    if (url.pathname !== "/v1/chat") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    if (!env.OPENAI_API_KEY) {
      sendJson(response, 503, { error: "The AI service is not configured." });
      return;
    }
    if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 1000) {
      sendJson(response, 400, { error: "Message must be a non-empty string of at most 1000 characters." });
      return;
    }
    if (isRateLimited(`chat:${authUser.id}`, CHAT_LIMIT)) {
      sendJson(response, 429, { error: "You’ve reached the short-term message limit. Please wait a minute." });
      return;
    }

    const aiResponse = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are Zoe, a helpful Windows desktop assistant. You may answer questions and propose minimizing only the app Zoe most recently left. Never claim to have performed a computer action. Never run shell commands, inspect files, or control other apps. Ask the user before proposing the single allowed minimize action; the desktop app will show a separate Windows confirmation.",
          },
          { role: "user", content: body.message.trim() },
        ],
        tools: [{
          type: "function",
          function: {
            name: "request_minimize_previous_window",
            description: "Propose minimizing only the app Zoe was focused on before. Use only when the user explicitly asks to minimize an app. This function does not execute the action.",
            strict: true,
            parameters: {
              type: "object",
              properties: {},
              required: [],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: "auto",
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) {
      console.error("OpenAI request failed:", aiResponse.status);
      sendJson(response, 502, { error: "Zoe could not get an AI response just now. Please try again." });
      return;
    }

    const choice = result.choices?.[0]?.message;
    const requestsMinimize = choice?.tool_calls?.some(
      (toolCall) => toolCall.function?.name === "request_minimize_previous_window",
    );
    if (requestsMinimize) {
      sendJson(response, 200, {
        reply: "I can ask Windows to minimize the app you were using before Zoe. A Windows confirmation will appear, and nothing changes unless you approve it.",
        actionProposal: "minimize-previous-window",
      });
      return;
    }
    if (typeof choice?.content !== "string" || !choice.content.trim()) {
      throw Object.assign(new Error("The AI service returned an empty response."), { status: 502 });
    }
    sendJson(response, 200, { reply: choice.content.trim() });
  }

  return http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (request.destroyed) return;
      if (!response.headersSent) {
        sendJson(response, error.status || 500, {
          error: error.status ? error.message : "The assistant service encountered an error.",
          requestId: randomUUID(),
        });
      } else {
        response.destroy(error);
      }
    });
  });
}

if (require.main === module) {
  const server = createServer();
  const host = process.env.HOST || "0.0.0.0";
  const port = Number(process.env.PORT) || 4180;
  server.listen(port, host, () => {
    console.log(`Zoe API listening on ${host}:${port}`);
  });
  server.on("error", (error) => {
    console.error("Could not start Zoe API:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { createServer };
