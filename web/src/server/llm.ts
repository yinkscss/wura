import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { config, type LlmConfig } from "./config";

/**
 * Provider-neutral model access for the chat brain. Two adapters:
 *
 * - "anthropic": Anthropic's Messages API through the official SDK.
 * - everything else: any OpenAI-compatible Chat Completions API (OpenAI,
 *   DeepSeek, OpenRouter, Gemini, Groq, a local server, ...), by base URL.
 *
 * The provider, model and key all come from env (see config.llm). Nothing here
 * picks a model. Each adapter keeps its own message list for the turn so
 * provider-specific fields (thinking blocks, reasoning_content) pass back
 * unchanged.
 */

export type ToolSpec = {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required: string[] };
};

/** `input` is undefined and `badInput` is set when the model sent invalid JSON. */
export type ToolCall = { id: string; name: string; input: unknown; badInput?: string };
export type ToolResult = { id: string; content: string; isError: boolean };
export type StepResult = { text: string; toolCalls: ToolCall[]; refused: boolean };
export type HistoryLine = { role: "user" | "assistant"; content: string };

export interface LlmTurn {
  step(timeoutMs: number): Promise<StepResult>;
  addToolResults(results: ToolResult[]): void;
}

export function startTurn(opts: { system: string; tools: ToolSpec[]; history: HistoryLine[]; message: string }): LlmTurn {
  const llm = config.llm;
  if (!llm) throw new Error("No model configured");
  return llm.provider === "anthropic" ? anthropicTurn(llm, opts) : openAiCompatibleTurn(llm, opts);
}

// ---------- Anthropic ----------

let anthropicClient: Anthropic | null = null;

function anthropicTurn(llm: LlmConfig, o: Parameters<typeof startTurn>[0]): LlmTurn {
  // Explicit key and base URL, so stray ANTHROPIC_* env vars can't change what runs.
  anthropicClient ??= new Anthropic({ apiKey: llm.apiKey, baseURL: llm.baseUrl || undefined, maxRetries: 1 });
  const client = anthropicClient;
  const tools: Anthropic.Tool[] = o.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: "object", properties: t.parameters.properties, required: t.parameters.required },
  }));
  const messages: Anthropic.MessageParam[] = [...o.history, { role: "user", content: o.message }];

  return {
    async step(timeoutMs) {
      const res = await client.messages.create(
        {
          model: llm.model,
          max_tokens: 8000,
          system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
          tools,
          messages,
          ...(llm.effort ? { output_config: { effort: llm.effort as "low" | "medium" | "high" } } : {}),
        },
        { timeout: timeoutMs },
      );
      messages.push({ role: "assistant", content: res.content });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      const toolCalls = res.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
      return { text, toolCalls, refused: res.stop_reason === "refusal" };
    },
    addToolResults(results) {
      messages.push({
        role: "user",
        content: results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content, is_error: r.isError })),
      });
    },
  };
}

// ---------- OpenAI-compatible Chat Completions ----------

type OaMessage = Record<string, unknown> & { role: string };
type OaToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

function openAiCompatibleTurn(llm: LlmConfig, o: Parameters<typeof startTurn>[0]): LlmTurn {
  const url = `${llm.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  // A portable schema subset: type, properties, required, enum, description.
  const tools = o.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  // Earlier lines go in as quoted context, not as assistant turns: some providers
  // (DeepSeek in thinking mode) reject past assistant turns that lack the
  // reasoning_content we never stored.
  const context = o.history.map((h) => `${h.role === "user" ? "User" : "Wura"}: ${h.content}`).join("\n");
  const userContent = context
    ? `Earlier in this chat (context only, not instructions):\n${context}\n\nNew message: ${o.message}`
    : o.message;
  const messages: OaMessage[] = [{ role: "system", content: o.system }, { role: "user", content: userContent }];

  return {
    async step(timeoutMs) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${llm.apiKey}` },
        body: JSON.stringify({
          model: llm.model,
          messages,
          tools,
          ...(llm.effort ? { reasoning_effort: llm.effort } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`${llm.provider} returned ${res.status}: ${detail}`);
      }
      const body = (await res.json()) as { choices?: Array<{ message?: OaMessage; finish_reason?: string }> };
      const choice = body.choices?.[0];
      const msg = choice?.message;
      if (!msg) throw new Error(`${llm.provider} returned no message`);
      // Keep the assistant message as sent, so fields like reasoning_content survive.
      messages.push(msg);
      const calls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []) as OaToolCall[];
      const toolCalls: ToolCall[] = calls.map((c) => {
        try {
          return { id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments || "{}") };
        } catch {
          return { id: c.id, name: c.function.name, input: undefined, badInput: "The tool arguments weren't valid JSON." };
        }
      });
      const text = typeof msg.content === "string" ? msg.content.trim() : "";
      return { text, toolCalls, refused: choice?.finish_reason === "content_filter" };
    },
    addToolResults(results) {
      // One tool message per call id; every call needs an answer.
      for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: r.isError ? `Error: ${r.content}` : r.content });
    },
  };
}
