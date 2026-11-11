const http = require("node:http");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 4173;
const ROOT = __dirname;
const MAX_BODY_BYTES = 16 * 1024;
const PROPOSAL_TTL_MS = 5 * 60 * 1000;

const pendingApprovals = new Map();
const pages = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/chat.html", ["chat.html", "text/html; charset=utf-8"]],
  ["/widget.html", ["widget.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/chat.js", ["chat.js", "text/javascript; charset=utf-8"]],
  ["/web-auth.js", ["web-auth.js", "text/javascript; charset=utf-8"]],
  ["/pwa.js", ["pwa.js", "text/javascript; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/service-worker.js", ["service-worker.js", "text/javascript; charset=utf-8"]],
  ["/icons/zoe.svg", ["icons/zoe.svg", "image/svg+xml"]],
  ["/widget.js", ["widget.js", "text/javascript; charset=utf-8"]],
]);

const destinations = {
  overview: { label: "Overview", description: "Return to Zoe's overview." },
  files: { label: "Files", description: "Open the files demo panel." },
  workspace: { label: "Workspace", description: "Open the workspace demo panel." },
  activity: { label: "Activity", description: "Review Zoe's recent activity." },
};

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

function identifyDestination(message) {
  const text = message.toLowerCase();
  if (/\b(files?|documents?|downloads?)\b/.test(text)) return "files";
  if (/\b(workspace|projects?)\b/.test(text)) return "workspace";
  if (/\b(activity|history|recent)\b/.test(text)) return "activity";
  if (/\b(overview|home|dashboard)\b/.test(text)) return "overview";
  return null;
}

function handleChat(message) {
  if (/\bminimi[sz](?:e|ing)\b/i.test(message)) {
    return {
      reply: "I can ask Windows to minimize the app you were using before Zoe. A Windows confirmation will appear, and nothing changes unless you approve it.",
      actionProposal: "minimize-previous-window",
    };
  }

  const destination = identifyDestination(message);
  if (destination) {
    const id = randomUUID();
    pendingApprovals.set(id, {
      destination,
      expiresAt: Date.now() + PROPOSAL_TTL_MS,
    });
    return {
      reply: `I can take you to ${destinations[destination].label} inside the Zoe demo. Nothing will happen until you approve.`,
      proposal: {
        id,
        destination,
        title: `Open ${destinations[destination].label}`,
        description: destinations[destination].description,
      },
    };
  }

  if (/\b(run|execute|launch|shut ?down|restart|delete|install|change settings)\b/i.test(message)) {
    return {
      reply: "I can't run commands or change your computer in this prototype. I can only navigate Zoe's demo panels, and I'll ask before doing even that.",
    };
  }

  return {
    reply: "I'm here to help you find your way around. Try asking me to open your files, workspace, activity, or overview. I'll always ask before navigating.",
  };
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${HOST}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "zoe-local-demo" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJson(request);
    if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 1000) {
      sendJson(response, 400, { error: "Message must be a non-empty string of at most 1000 characters." });
      return;
    }
    sendJson(response, 200, handleChat(body.message.trim()));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/approve") {
    const body = await readJson(request);
    if (body.approved !== true || typeof body.proposalId !== "string") {
      sendJson(response, 400, { error: "Explicit approval and a valid proposal are required." });
      return;
    }
    const proposal = pendingApprovals.get(body.proposalId);
    pendingApprovals.delete(body.proposalId);
    if (!proposal || proposal.expiresAt < Date.now()) {
      sendJson(response, 410, { error: "This approval request expired. Ask Zoe again to create a new one." });
      return;
    }
    sendJson(response, 200, {
      approved: true,
      destination: proposal.destination,
      label: destinations[proposal.destination].label,
    });
    return;
  }

  if (request.method === "GET" && pages.has(url.pathname)) {
    const [file, contentType] = pages.get(url.pathname);
    response.writeHead(200, {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-cache",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    fs.createReadStream(path.join(ROOT, file)).pipe(response);
    return;
  }

  sendJson(response, 404, { error: "Not found." });
}

function createServer() {
  return http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (!response.headersSent) {
        sendJson(response, error.status || 500, {
          error: error.status ? error.message : "The local assistant encountered an error.",
        });
      } else {
        response.destroy(error);
      }
    });
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`Zoe is ready at http://${HOST}:${PORT}`);
  });
  server.on("error", (error) => {
    console.error("Could not start Zoe:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { createServer };
