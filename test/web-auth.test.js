const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "web-auth.js"), "utf8");

function createWebAuth(fetchImpl) {
  const values = new Map();
  const sessionStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const window = {};
  vm.runInNewContext(source, { window, sessionStorage, fetch: fetchImpl });
  return { auth: window.zoeWebAuth, values };
}

function jsonResponse(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  };
}

test("web sign-in stores the returned session without exposing it in a URL", async () => {
  let request;
  const { auth, values } = createWebAuth(async (url, options) => {
    request = { url, options };
    return jsonResponse(200, {
      session: { accessToken: "access-1", refreshToken: "refresh-1" },
      user: { id: "user-1", name: "Zoe User" },
    });
  });

  const result = await auth.authenticate({
    mode: "signin",
    email: "zoe@example.com",
    password: "a-secure-password",
    name: "",
  });

  assert.equal(request.url, "/v1/auth/signin");
  assert.deepEqual(JSON.parse(request.options.body), {
    email: "zoe@example.com",
    password: "a-secure-password",
    name: "",
  });
  assert.deepEqual(JSON.parse(values.get("zoeWebSession")), {
    accessToken: "access-1",
    refreshToken: "refresh-1",
  });
  assert.equal(result.user.name, "Zoe User");
});

test("web chat refreshes an expired access token and retries the same-origin request", async () => {
  const requests = [];
  const { auth } = createWebAuth(async (url, options) => {
    requests.push({ url, options });
    if (url === "/v1/auth/signin") {
      return jsonResponse(200, {
        session: { accessToken: "access-1", refreshToken: "refresh-1" },
        user: { id: "user-1", name: "Zoe User" },
      });
    }
    if (url === "/v1/chat" && requests.filter((request) => request.url === url).length === 1) {
      return jsonResponse(401, { error: "Expired access token." });
    }
    if (url === "/v1/auth/refresh") {
      return jsonResponse(200, {
        session: { accessToken: "access-2", refreshToken: "refresh-2" },
      });
    }
    if (url === "/v1/chat") return jsonResponse(200, { reply: "Hello from Zoe." });
    throw new Error(`Unexpected request: ${url}`);
  });

  await auth.authenticate({ mode: "signin", email: "zoe@example.com", password: "a-secure-password", name: "" });
  const result = await auth.chat("Hello Zoe");

  assert.deepEqual(result, { reply: "Hello from Zoe." });
  assert.equal(requests[1].options.headers.Authorization, "Bearer access-1");
  assert.equal(requests[2].url, "/v1/auth/refresh");
  assert.deepEqual(JSON.parse(requests[2].options.body), { refreshToken: "refresh-1" });
  assert.equal(requests[3].options.headers.Authorization, "Bearer access-2");
  assert.deepEqual(JSON.parse(requests[3].options.body), { message: "Hello Zoe", surface: "web" });
});

test("web session restoration does not make an API request without a saved session", async () => {
  let requestCount = 0;
  const { auth } = createWebAuth(async () => {
    requestCount += 1;
    return jsonResponse(500, {});
  });

  assert.equal(await auth.getSession(), null);
  assert.equal(requestCount, 0);
});
