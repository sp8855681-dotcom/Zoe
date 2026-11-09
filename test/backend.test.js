const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createServer } = require("../backend/server");

let server;
let origin;
let openAiRequest;

before(async () => {
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/auth/v1/user")) {
      return Response.json({ id: "user-1", email: "zoe@example.com", user_metadata: { display_name: "Zoe User" } });
    }
    if (url === "https://api.openai.com/v1/chat/completions") {
      openAiRequest = JSON.parse(options.body);
      if (openAiRequest.messages[1].content.toLowerCase().includes("minimize")) {
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
        choices: [{ message: { content: "Hello from Zoe.", tool_calls: [] } }],
      });
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  server = createServer({
    env: {
      SUPABASE_URL: "https://accounts.example",
      SUPABASE_ANON_KEY: "public-test-key",
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
