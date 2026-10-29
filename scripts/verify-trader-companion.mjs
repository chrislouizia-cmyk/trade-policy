// Run after npm run build: node --env-file=.env.local scripts/verify-trader-companion.mjs
// Creates two disposable QA accounts, exercises the actual HTTP API, then deletes them.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
])
  if (!process.env[key])
    throw new Error(`Missing runtime configuration: ${key}`);
const base = "http://127.0.0.1:3478";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const users = [];
let server;
async function account() {
  const email = `qa-companion-${randomUUID()}@example.com`,
    password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Disposable Companion QA" },
  });
  if (error) throw error;
  users.push(data.user.id);
  const cookies = new Map();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
        setAll: (entries) =>
          entries.forEach((e) => cookies.set(e.name, e.value)),
      },
    },
  );
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return {
    id: data.user.id,
    cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
  };
}
async function request(actor, path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Cookie: actor.cookie,
      Origin: base,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
try {
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3478",
    ],
    { stdio: ["ignore", "ignore", "pipe"], env: process.env },
  );
  let serverError = "";
  server.stderr.on("data", (chunk) => (serverError += String(chunk)));
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(base);
      break;
    } catch {
      if (attempt === 59)
        throw new Error(`Server did not start: ${serverError}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const a = await account(),
    b = await account();
  const sessionId = randomUUID();
  const unauth = await fetch(`${base}/api/trader-companion`);
  assert.equal(unauth.status, 401);
  const context = await request(a, "/api/trader-companion");
  assert.equal(context.status, 200);
  assert.equal(context.data.summary.closedTrades, 0);
  const first = await request(a, "/api/trader-companion", "POST", {
    sessionId,
    version: 0,
    locale: "es",
    context: {},
    message:
      "Prefiero revisar mis reglas con ejemplos concretos. ¿Qué necesitas para entender mi proceso?",
    remember: "PREFERENCE",
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.source, "OPENAI", first.data.failureCode);
  assert.equal(first.data.memorySaved, true);
  assert.equal(first.data.version, 1);
  const persisted = await request(
    a,
    `/api/trader-companion?sessionId=${sessionId}`,
  );
  assert.equal(persisted.data.session.messages.length, 2);
  assert.equal(persisted.data.memories.length, 1);
  const memoryId = persisted.data.memories[0].id;
  const other = await request(
    b,
    `/api/trader-companion?sessionId=${sessionId}`,
  );
  assert.equal(other.data.session, null);
  assert.equal(other.data.memories.length, 0);
  const stolen = await request(b, "/api/trader-companion", "POST", {
    sessionId,
    version: 0,
    message: "Overwrite",
    context: {},
  });
  assert.equal(stolen.status, 409);
  const stale = await request(a, "/api/trader-companion", "POST", {
    sessionId,
    version: 0,
    message: "Stale reply",
    context: {},
  });
  assert.equal(stale.status, 409);
  await request(b, "/api/trader-companion", "DELETE", { memoryId });
  assert.equal(
    (await request(a, "/api/trader-companion")).data.memories.length,
    1,
  );
  const maliciousOrigin = await fetch(`${base}/api/trader-companion`, {
    method: "POST",
    headers: {
      Cookie: a.cookie,
      Origin: "https://unrelated.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(maliciousOrigin.status, 403);
  const removed = await request(a, "/api/trader-companion", "DELETE", {
    memoryId,
  });
  assert.equal(removed.status, 200);
  assert.equal(
    (await request(a, "/api/trader-companion")).data.memories.length,
    0,
  );
  const correction = await request(a, "/api/trader-companion", "POST", {
    sessionId,
    version: 1,
    message:
      "No conozco todavía mis reglas exactas. Hazme una pregunta para identificarlas.",
    locale: "es",
    context: {},
  });
  assert.equal(correction.status, 200);
  assert.equal(correction.data.source, "OPENAI", correction.data.failureCode);
  assert.ok(correction.data.reply.question.length > 0);
  console.log(
    JSON.stringify({
      passed: true,
      realAI: true,
      persistentConversation: true,
      explicitMemory: true,
      userIsolation: true,
      staleWriteRejected: true,
      originChecked: true,
      memoryDeletion: true,
      clarificationQuestion: true,
    }),
  );
} finally {
  for (const id of users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error("QA cleanup failed for a disposable account.");
  }
  server?.kill("SIGTERM");
}
