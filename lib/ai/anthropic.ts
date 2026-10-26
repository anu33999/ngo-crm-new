import Anthropic from "@anthropic-ai/sdk";

/**
 * Thin wrapper around the Anthropic SDK. The rest of the app depends only on `AiClient`, so tests inject a
 * fake and the app runs fully (deterministically) when ANTHROPIC_API_KEY is not set.
 */
export interface AiClient {
  readonly name: string;
  complete(args: { system: string; user: string; maxTokens?: number; signal?: AbortSignal }): Promise<string>;
}

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export function createAnthropicClient(env: NodeJS.ProcessEnv = process.env): AiClient | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  return {
    name: `anthropic:${model}`,
    async complete({ system, user, maxTokens = 4000, signal }) {
      const res = await client.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }, { signal });
      return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    },
  };
}

/** Extract the first JSON object from a model reply (tolerates code fences and prose around it). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model reply");
  return JSON.parse(candidate.slice(start, end + 1));
}
