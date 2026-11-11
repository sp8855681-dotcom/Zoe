const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const { createServer } = require("../server");

let server;
let origin;

before(async () => {
  server = createServer();
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

test("health endpoint reports the local service", async () => {
  const response = await fetch(`${origin}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "zoe-local-demo" });
});

test("desktop widget page and script are served for the Electron overlay", async () => {
  const page = await fetch(`${origin}/widget.html`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(await page.text(), /Open Zoe chat/);

  const script = await fetch(`${origin}/widget.js`);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /zoeDesktop\.openAssistant/);
});

test("PWA assets are served with install and offline-shell metadata", async () => {
  const [page, manifest, worker, icon] = await Promise.all([
    fetch(`${origin}/`),
    fetch(`${origin}/manifest.webmanifest`),
    fetch(`${origin}/service-worker.js`),
    fetch(`${origin}/icons/zoe.svg`),
  ]);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /worker-src 'self'/);
  const pageSource = await page.text();
  assert.match(pageSource, /href="styles\.css"/);
  assert.match(pageSource, /src="app\.js"/);
  assert.doesNotMatch(pageSource, /(?:href|src)="\//);
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get("content-type"), "application/manifest+json; charset=utf-8");
  const manifestData = await manifest.json();
  assert.equal(manifestData.display, "standalone");
  assert.equal(manifestData.start_url, "./");
  assert.equal(manifestData.scope, "./");
  assert.equal(worker.status, 200);
  const workerSource = await worker.text();
  assert.match(workerSource, /zoe-app-shell-v1/);
  assert.match(workerSource, /new URL\("chat\.html", appScope\)/);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get("content-type"), /image\/svg\+xml/);
});

test("minimize requests only propose an action", async () => {
  const response = await fetch(`${origin}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Please minimize the app I was using" }),
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.actionProposal, "minimize-previous-window");
  assert.match(result.reply, /nothing changes unless you approve/i);
});

test("unsupported computer commands do not produce an action proposal", async () => {
  const response = await fetch(`${origin}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Run a command" }),
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.actionProposal, undefined);
  assert.match(result.reply, /can't run commands/i);
});
