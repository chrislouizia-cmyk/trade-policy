import "server-only";
import { generateTraderCompanionWithProvider } from "../trader-companion-engine.ts";
export async function generateTraderCompanion(
  input: Parameters<typeof generateTraderCompanionWithProvider>[0],
) {
  return generateTraderCompanionWithProvider(input, {
    apiKey: process.env.OPENAI_API_KEY,
    model:
      process.env.OPENAI_MODEL ||
      process.env.OPENAI_VISION_MODEL ||
      "gpt-5-mini",
  });
}
