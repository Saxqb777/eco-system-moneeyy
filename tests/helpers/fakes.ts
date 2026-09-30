import type { Message, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import type { AnthropicLike } from "@/agents/client";
import type { TelegramApi } from "@/lib/telegram";

let batchSeq = 0;

// A fake Anthropic client: answers every request with the JSON the test provides, in sync and batch modes.
export function fakeAnthropic(answer: (params: MessageCreateParamsNonStreaming) => unknown): AnthropicLike & { calls: MessageCreateParamsNonStreaming[]; batches: Map<string, Array<{ custom_id: string; params: MessageCreateParamsNonStreaming }>> } {
  const calls: MessageCreateParamsNonStreaming[] = [];
  const batchStore = new Map<string, Array<{ custom_id: string; params: MessageCreateParamsNonStreaming }>>();
  const reply = (params: MessageCreateParamsNonStreaming): Message =>
    ({
      id: `msg_${calls.length}`,
      type: "message",
      role: "assistant",
      model: params.model,
      content: [{ type: "text", text: JSON.stringify(answer(params)), citations: null }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 5000, output_tokens: 700, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } },
    }) as unknown as Message;
  return {
    calls,
    batches: batchStore,
    messages: {
      async create(params) {
        calls.push(params);
        return reply(params);
      },
      batches: {
        async create({ requests }) {
          const id = `msgbatch_${++batchSeq}`;
          batchStore.set(id, requests);
          return { id, processing_status: "in_progress" };
        },
        async retrieve(id) {
          return { id, processing_status: "ended", ended_at: new Date().toISOString() };
        },
        async results(id) {
          const reqs = batchStore.get(id) ?? [];
          async function* gen() {
            for (const r of reqs) {
              calls.push(r.params);
              yield { custom_id: r.custom_id, result: { type: "succeeded", message: reply(r.params) } };
            }
          }
          return gen();
        },
      },
    },
  };
}

// A fake Telegram transport that records every call.
export function fakeTelegram(): { api: TelegramApi; calls: Array<{ method: string; body: Record<string, unknown> }> } {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  let n = 100;
  const api: TelegramApi = async (_token, method, body) => {
    calls.push({ method, body });
    if (method === "getChatMemberCount") return { ok: true, result: 1234 };
    return { ok: true, result: { message_id: ++n } };
  };
  return { api, calls };
}

export function testSecretsKey(): string {
  return Buffer.alloc(32, 7).toString("base64");
}
