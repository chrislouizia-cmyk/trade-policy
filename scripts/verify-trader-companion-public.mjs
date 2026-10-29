import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:3479";
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3479",
  ],
  { stdio: "ignore", env: process.env },
);
try {
  let page;
  for (let i = 0; i < 50; i++) {
    try {
      page = await fetch(base);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.equal(page?.status, 200);
  assert.match(await page.text(), /Trade Police/);
  assert.equal(
    (await fetch(`${base}/api/trader-companion`, { redirect: "manual" }))
      .status,
    401,
  );
  assert.equal(
    (
      await fetch(`${base}/api/trader-companion`, {
        method: "POST",
        redirect: "manual",
        headers: {
          Origin: "https://unrelated.example",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base}/api/trader-companion`, {
        method: "POST",
        redirect: "manual",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    401,
  );
  console.log(
    JSON.stringify({
      passed: true,
      home: 200,
      unauthenticatedRead: 401,
      unauthenticatedWrite: 401,
      crossOrigin: 403,
    }),
  );
} finally {
  server.kill("SIGTERM");
}
