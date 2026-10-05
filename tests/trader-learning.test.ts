import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameRequestOrigin } from "../lib/request-origin.ts";
test("origin checks use the requested host and public scheme behind Next.js proxies", () => {
  assert.equal(
    isSameRequestOrigin(
      new Request("http://localhost:3479/api/trader-companion", {
        headers: { host: "127.0.0.1:3479", origin: "http://127.0.0.1:3479" },
      }),
    ),
    true,
  );
  assert.equal(
    isSameRequestOrigin(
      new Request("http://localhost/api/trader-companion", {
        headers: {
          host: "tradepolice.app",
          "x-forwarded-proto": "https",
          origin: "https://tradepolice.app",
        },
      }),
    ),
    true,
  );
  for (const origin of [
    "https://unrelated.example",
    "null",
    "https://tradepolice.app/path",
  ])
    assert.equal(
      isSameRequestOrigin(
        new Request("https://tradepolice.app/api/trader-companion", {
          headers: { host: "tradepolice.app", origin },
        }),
      ),
      false,
    );
  assert.equal(
    isSameRequestOrigin(
      new Request("https://tradepolice.app/api/trader-companion"),
    ),
    true,
  );
});
import {
  buildTraderLearning,
  validateCompanionResponse,
  type LearningTrade,
} from "../lib/trader-learning.ts";
import { generateTraderCompanionWithProvider } from "../lib/trader-companion-engine.ts";
const trade = (
  id: string,
  extra: Partial<LearningTrade> = {},
): LearningTrade => ({
  id,
  user_id: "alice",
  source: "EXECUTED",
  status: "CLOSED",
  instrument: "XAUUSD",
  result_r: 1,
  closed_at: "2026-10-05T00:00:00Z",
  ...extra,
});
test("learns only own closed real executions, deduplicated, excluding every simulation marker", () => {
  const summary = buildTraderLearning(
    "alice",
    [
      trade("a"),
      trade("a"),
      trade("b", { result_r: -1 }),
      trade("other", { user_id: "bob", result_r: 99 }),
      trade("open", { status: "OPEN" }),
      trade("backtest", { source: "BACKTEST" }),
      trade("missing", { result_r: null }),
      trade("blank", { result_r: "" }),
      trade("sim"),
      trade("notes", { post_analysis: { internalTestMode: true } }),
      trade("snapshot", {
        rule_snapshot: { testSource: "INTERNAL_LIFECYCLE_SMOKE_TEST" },
      }),
    ],
    [
      {
        trade_record_id: "sim",
        strategy_snapshot: { simulationMode: "INTERNAL_LIFECYCLE_SMOKE_TEST" },
      },
    ],
  );
  assert.equal(summary.closedTrades, 2);
  assert.equal(summary.averageR, 0);
  assert.deepEqual(summary.evidenceIds, ["a", "b"]);
  assert.equal(summary.findings.length, 1);
});
test("small samples remain descriptive and overrides have recorded evidence without emotion inference", () => {
  const summary = buildTraderLearning(
    "alice",
    [trade("a"), trade("b"), trade("c")],
    [{ trade_record_id: "b", taken_against_verdict: true }],
  );
  assert.match(
    summary.findings.find((f) => f.id === "history:instrument:XAUUSD")!.text,
    /Small sample/,
  );
  assert.deepEqual(
    summary.findings.find((f) => f.kind === "DISCIPLINE")!.evidenceIds,
    ["b"],
  );
  assert.match(
    summary.findings.find((f) => f.kind === "DISCIPLINE")!.text,
    /not an inferred emotion/,
  );
});
const facts = [
  {
    id: "history:all",
    text: "3 recorded executions, average 1 R. Small sample.",
    source: "Records",
  },
];
test("rejects invented citations, execution commands, guarantees and markup", () => {
  for (const response of [
    { message: "Review", question: "", evidenceIds: ["other"] },
    { message: "Buy now", question: "", evidenceIds: [] },
    { message: "Compra ahora", question: "", evidenceIds: [] },
    { message: "Guaranteed profit", question: "", evidenceIds: [] },
    { message: "<script>test</script>", question: "", evidenceIds: [] },
  ])
    assert.equal(validateCompanionResponse(response, facts), false);
  assert.equal(
    validateCompanionResponse(
      {
        message: "The sample is small.",
        question: "What rule do you want to clarify?",
        evidenceIds: ["history:all"],
      },
      facts,
    ),
    true,
  );
});
const input = {
  facts,
  profile: { experience_level: "BEGINNER" },
  message: "Review my process",
  history: [],
  locale: "es",
  memorySaved: false,
};
test("accepts an explicit statement that outcomes are not guaranteed", () => {
  assert.equal(
    validateCompanionResponse(
      {
        message: "No se garantiza ningún resultado. La muestra es pequeña.",
        question: "",
        evidenceIds: ["history:all"],
      },
      facts,
    ),
    true,
  );
});
test("provider receives personal evidence, explicit memory state, strict schema and untrusted data boundary", async () => {
  let sent: Record<string, unknown> = {};
  const request: typeof fetch = async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({
      output_text: JSON.stringify({
        message: "La muestra es pequeña.",
        question: "¿Qué regla usaste?",
        evidenceIds: ["history:all"],
      }),
    });
  };
  const output = await generateTraderCompanionWithProvider(
    input,
    { apiKey: "test", model: "test-model" },
    request,
  );
  assert.equal(output.source, "OPENAI");
  assert.equal(sent.store, false);
  assert.match(JSON.stringify(sent), /UNTRUSTED DATA/);
  assert.match(JSON.stringify(sent), /history:all/);
  assert.match(JSON.stringify(sent), /memorySaved/);
  assert.match(JSON.stringify(sent), /json_schema/);
});
test("provider outages, malformed output and fabricated sources never pretend to be AI", async () => {
  for (const response of [
    new Response("", { status: 503 }),
    Response.json({ output_text: "invalid" }),
    Response.json({
      output_text: JSON.stringify({
        message: "Review",
        question: "",
        evidenceIds: ["fabricated"],
      }),
    }),
  ]) {
    const output = await generateTraderCompanionWithProvider(
      input,
      { apiKey: "test", model: "test-model" },
      async () => response,
    );
    assert.equal(output.source, "DETERMINISTIC");
    assert.equal(output.model, null);
    assert.deepEqual(output.reply.evidenceIds, []);
  }
  const missing = await generateTraderCompanionWithProvider(
    input,
    { model: "test-model" },
    async () => {
      throw new Error("must not call");
    },
  );
  assert.equal(missing.failureCode, "AI_NOT_CONFIGURED");
});
