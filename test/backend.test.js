const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createServer } = require("../backend/server");

let server;
let origin;
let openAiRequest;
let quotaResult = { allowed: true };
let quotaRequest;

before(async () => {
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/auth/v1/user")) {
      return Response.json({ id: "user-1", email: "zoe@example.com", user_metadata: { display_name: "Zoe User" } });
    }
    if (url.endsWith("/rest/v1/rpc/consume_zoe_chat_quota")) {
      quotaRequest = { headers: options.headers, body: JSON.parse(options.body) };
      return Response.json(quotaResult);
    }
    if (url === "https://api.openai.com/v1/chat/completions") {
      openAiRequest = JSON.parse(options.body);
      if (openAiRequest.tools && openAiRequest.messages[1].content.toLowerCase().includes("minimize")) {
        return Response.json({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                function: { name: "request_minimize_previous_window", arguments: "{}" },
              }],
            },
          }],
        });
      }
      return Response.json({
        choices: [{
          message: {
            content: openAiRequest.messages[1].content.toLowerCase().includes("minimize")
              ? "I cannot control your device from the web app."
              : "Hello from Zoe.",
            tool_calls: [],
          },
        }],
      });
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  server = createServer({
    env: {
      SUPABASE_URL: "https://accounts.example",
      SUPABASE_ANON_KEY: "public-test-key",
      SUPABASE_SERVICE_ROLE_KEY: "server-only-service-role-key",
      OPENAI_API_KEY: "server-only-test-key",
    },
    fetchImpl,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("hosted chat requires an authenticated user", async () => {
  const response = await fetch(`${origin}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hi Zoe" }),
  });
  assert.equal(response.status, 401);
});

test("hosted web assets are served from the same origin as the API", async () => {
  const [home, manifest, worker, icon] = await Promise.all([
    fetch(`${origin}/`),
    fetch(`${origin}/manifest.webmanifest`),
    fetch(`${origin}/service-worker.js`),
    fetch(`${origin}/icons/zoe.svg`),
  ]);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  const homeSource = await home.text();
  assert.match(homeSource, /src="web-auth\.js"/);
  assert.match(homeSource, /href="styles\.css"/);
  assert.doesNotMatch(homeSource, /(?:href|src)="\//);
  assert.equal(manifest.status, 200);
  const manifestData = await manifest.json();
  assert.equal(manifestData.name, "Zoe AI Assistant");
  assert.equal(manifestData.start_url, "./");
  assert.equal(manifestData.scope, "./");
  assert.equal(worker.status, 200);
  assert.match(await worker.text(), /new URL\("chat\.html", appScope\)/);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get("content-type"), /image\/svg\+xml/);
});

test("hosted chat verifies the user and keeps action requests advisory", async () => {
  const response = await fetch(`${origin}/v1/chat`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-user-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: "Hello Zoe" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: "Hello from Zoe." });
  assert.equal(openAiRequest.model, "gpt-4o-mini");
  assert.equal(openAiRequest.max_tokens, 60);
  assert.deepEqual(quotaRequest.body, {
    p_user_id: "user-1",
    p_user_daily_limit: 60,
    p_global_daily_limit: 60,
  });
  assert.equal(quotaRequest.headers.apikey, "server-only-service-role-key");
  assert.match(openAiRequest.messages[0].content, /Never run shell commands/);
});

test("AI app-control requests are returned as proposals, not executed by the API", async () => {
  const response = await fetch(`${origin}/v1/chat`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-user-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: "Please minimize the app I was using" }),
  });

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.actionProposal, "minimize-previous-window");
  assert.match(result.reply, /nothing changes unless you approve/i);
});

test("hosted web chat does not receive Windows app-control tools", async () => {
  const response = await fetch(`${origin}/v1/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "Please minimize the app I was using", surface: "web" }),
    });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reply: "I cannot control your device from the web app." });
  assert.equal(openAiRequest.tools, undefined);
  assert.match(openAiRequest.messages[0].content, /cannot control the user's device/);
});

test("daily chat quota blocks requests before calling OpenAI", async () => {
  quotaResult = { allowed: false, scope: "global" };
  openAiRequest = undefined;

  const response = await fetch(`${origin}/v1/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer quota-test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: "Hello Zoe", surface: "web" }),
    });

  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /daily chat limit/i);
  assert.equal(openAiRequest, undefined);
  quotaResult = { allowed: true };
});
