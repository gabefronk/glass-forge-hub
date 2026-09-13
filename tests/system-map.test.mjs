import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../base44/functions/system-map/entry.ts", import.meta.url), "utf8");
const snapshot = JSON.parse(await readFile(new URL("./system-map-data.json", import.meta.url), "utf8"));
const sdkImport = /^import \{ createClientFromRequest \} from "npm:@base44\/sdk@0\.8\.48";\r?\n/m;
const denoServe = /^Deno\.serve\(handleSystemMap\);\s*$/m;
assert.match(source, sdkImport, "The actual entry must import the Base44 request-authentication client");
assert.match(source, denoServe, "The deployed entry must start the actual handler");
const executableSource = source.replace(sdkImport, "").replace(denoServe, "");
const { handleSystemMap } = await import(`data:text/javascript;base64,${Buffer.from(executableSource).toString("base64")}`);

function request(method = "GET", headers = {}, body) {
  return new Request("https://example.invalid/functions/systemMap", { method, headers, body });
}

function assertPrivateHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(
    response.headers.get("vary").split(",").map((value) => value.trim().toLowerCase()).sort(),
    ["authorization", "cookie"],
  );
  assert.match(response.headers.get("content-type"), /^application\/json\b/);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}

async function assertDenied(response, expectedStatus) {
  assert.equal(response.status, expectedStatus);
  assertPrivateHeaders(response);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.equal(typeof body.error, "string");
  assert.equal(JSON.stringify(body).includes("Glass Forge"), false, "Denied responses must not reveal the snapshot");
}

test("both exact owner accounts receive the current snapshot using GET and POST", async () => {
  for (const email of ["gabefronk@gmail.com", "gabriel.fronk.wd@gmail.com"]) {
    for (const method of ["GET", "POST"]) {
      let calls = 0;
      const response = await handleSystemMap(request(method), async () => {
        calls += 1;
        return { email, role: "admin" };
      });
      assert.equal(calls, 1);
      assert.equal(response.status, 200);
      assertPrivateHeaders(response);
      assert.deepEqual(await response.json(), snapshot, "The embedded deployment data must match the latest local snapshot");
    }
  }
});

test("owner email matching trims whitespace and normalizes case", async () => {
  const response = await handleSystemMap(request(), async () => ({ email: "  GABRIEL.FRONK.WD@GMAIL.COM \n", role: "admin" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), snapshot);
});

test("Deno handler info and the default resolver both authenticate the actual request through the SDK", async () => {
  const previousClient = Object.getOwnPropertyDescriptor(globalThis, "createClientFromRequest");
  const seenRequests = [];
  Object.defineProperty(globalThis, "createClientFromRequest", {
    configurable: true,
    value: (req) => {
      seenRequests.push(req);
      return { auth: { me: async () => ({ email: "gabefronk@gmail.com", role: "admin" }) } };
    },
  });
  try {
    for (const secondArgument of [undefined, { remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 12345 } }]) {
      const req = request();
      const response = await handleSystemMap(req, secondArgument);
      assert.equal(seenRequests.at(-1), req);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), snapshot);
    }
    assert.equal(seenRequests.length, 2);
  } finally {
    if (previousClient) Object.defineProperty(globalThis, "createClientFromRequest", previousClient);
    else delete globalThis.createClientFromRequest;
  }
});

test("owner emails without the exact admin role are forbidden", async () => {
  for (const role of ["user", "Admin", "owner", "", undefined, null]) {
    await assertDenied(await handleSystemMap(request(), async () => ({ email: "gabefronk@gmail.com", role })), 403);
  }
});

test("authenticated admins with missing or non-string email are forbidden", async () => {
  for (const email of [undefined, null, "", 123, {}, ["gabefronk@gmail.com"]]) {
    await assertDenied(await handleSystemMap(request(), async () => ({ role: "admin", email })), 403);
  }
});

test("unrelated admins, including Trevor, cannot read the map", async () => {
  for (const email of ["trevor@example.com", "another-admin@example.com"]) {
    await assertDenied(await handleSystemMap(request(), async () => ({ role: "admin", email })), 403);
  }
});

test("lookalike, suffix, plus-tag and dotted owner emails are not allowlisted", async () => {
  for (const email of [
    "gabefronk@gmail.com.attacker.example",
    "attacker+gabefronk@gmail.com",
    "gabefronk+admin@gmail.com",
    "gabe.fronk@gmail.com",
    "gabriel.fronk.wd@gmail.com.attacker.example",
  ]) {
    await assertDenied(await handleSystemMap(request(), async () => ({ role: "admin", email })), 403);
  }
});

test("anonymous authentication results receive 401", async () => {
  for (const user of [null, undefined, false]) {
    await assertDenied(await handleSystemMap(request(), async () => user), 401);
  }
});

test("rejected or synchronous authentication failures receive 401 without error details", async () => {
  for (const resolver of [
    async () => { throw new Error("sensitive upstream diagnostic"); },
    () => { throw new Error("sensitive upstream diagnostic"); },
  ]) {
    const response = await handleSystemMap(request(), resolver);
    await assertDenied(response, 401);
  }
});

test("spoofed owner, role and secret headers never substitute for authenticated identity", async () => {
  const spoofed = {
    "x-owner-email": "gabefronk@gmail.com",
    "x-user-email": "gabriel.fronk.wd@gmail.com",
    "x-user-role": "admin",
    "x-api-key": "test-only-spoofed-value",
    "x-admin-secret": "test-only-spoofed-value",
    "authorization": "Bearer test-only-spoofed-value",
    "cookie": "owner=gabefronk@gmail.com; role=admin",
  };
  await assertDenied(await handleSystemMap(request("GET", spoofed), async () => null), 401);
  await assertDenied(await handleSystemMap(request("POST", spoofed), async () => ({ email: "trevor@example.com", role: "admin" })), 403);
});

test("unsupported methods return 405 and never invoke authentication", async () => {
  for (const method of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    let calls = 0;
    const response = await handleSystemMap(request(method), async () => {
      calls += 1;
      return { email: "gabefronk@gmail.com", role: "admin" };
    });
    assert.equal(calls, 0);
    assert.equal(response.headers.get("allow"), "GET, POST");
    await assertDenied(response, 405);
  }
});

test("POST accepts an unreadable body without parsing or using request data", async () => {
  const req = request("POST", { "content-type": "application/json" }, "not JSON");
  for (const method of ["json", "text", "arrayBuffer", "formData", "blob"]) {
    req[method] = async () => { throw new Error(`Request body ${method} must not be read`); };
  }
  const response = await handleSystemMap(req, async () => ({ email: "gabefronk@gmail.com", role: "admin" }));
  assert.equal(response.status, 200);
  assert.equal(req.bodyUsed, false);
  assert.deepEqual(await response.json(), snapshot);
});

test("all node references resolve and collection identifiers are unique", () => {
  assert.ok(snapshot.nodes.length > 0);
  const ids = new Set(snapshot.nodes.map((node) => node.id));
  assert.equal(ids.size, snapshot.nodes.length, "Node IDs must be unique");
  for (const collection of [snapshot.views, snapshot.workflows]) {
    assert.equal(new Set(collection.map((item) => item.id)).size, collection.length, "View/workflow IDs must be unique");
  }
  const references = [
    ...snapshot.views.flatMap((view) => view.nodeIds),
    ...snapshot.edges.flatMap((edge) => [edge.from, edge.to]),
    ...snapshot.workflows.flatMap((workflow) => workflow.steps),
    ...snapshot.openItems.map((item) => item.nodeId),
  ];
  for (const id of references) assert.ok(ids.has(id), `Unknown node reference: ${id}`);
});

test("snapshot states its static evidence and verification limits", () => {
  assert.match(snapshot.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof snapshot.sourceNote, "string");
  assert.match(snapshot.sourceNote, /historical|static|snapshot/i);
  assert.match(`${snapshot.intro} ${snapshot.sourceNote}`, /not live health|no cloud health check|not retested/i);
});

test("snapshot omits private contact details and recognizable credential material", () => {
  const text = JSON.stringify(snapshot);
  const forbidden = [
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "email address"],
    [/(?<!\w)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\w)/, "phone number"],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
    [/\bsk-[A-Za-z0-9_-]{16,}\b/, "API secret"],
    [/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/, "JWT"],
    [/\bBearer\s+[A-Za-z0-9._~-]{12,}/i, "bearer credential"],
    [/"(?:password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)"\s*:/i, "credential field"],
  ];
  for (const [pattern, label] of forbidden) assert.doesNotMatch(text, pattern, `Snapshot must not contain ${label}`);
  for (const node of snapshot.nodes) {
    for (const link of node.links) {
      const url = new URL(link.url, "https://glass-forge-hub.base44.app");
      assert.equal(url.protocol, "https:");
      assert.equal(url.username, "");
      assert.equal(url.password, "");
      for (const key of url.searchParams.keys()) assert.doesNotMatch(key, /token|secret|password|api.?key/i);
    }
  }
});

test("deployment entry is self-contained and has no data writes, model calls or logs", () => {
  assert.doesNotMatch(executableSource, /^\s*import\b/m, "No sibling or additional imports may be required at deployment");
  assert.doesNotMatch(source, /\b(?:console|Deno\.env)\s*\.|\basServiceRole\b|\bintegrations\b|\bentities\s*\./);
  assert.doesNotMatch(source, /\b(?:fetch|eval)\s*\(|\bimport\s*\(/);
  assert.doesNotMatch(source, /\breq\s*\.\s*(?:headers|json|text|arrayBuffer|formData|blob)\b/);
});

