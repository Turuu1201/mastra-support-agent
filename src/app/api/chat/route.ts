import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";
import { mastra, hasGeminiKey } from "@/mastra";
import { chatRateLimit, isAuthorized, unauthorized } from "@/lib/guard";

export const maxDuration = 60;

type Usage = { input: number; output: number; total: number };

// AI SDK-ийн хувилбараас хамаарч токены тоо шууд тоо эсвэл { total } объект байж болно.
const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof (v as { total?: unknown }).total === "number") {
    return (v as { total: number }).total;
  }
  return 0;
};

const toUsage = (u: Record<string, unknown> | undefined): Usage => {
  const input = num(u?.inputTokens);
  const output = num(u?.outputTokens);
  return { input, output, total: num(u?.totalTokens) || input + output };
};

export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const limited = chatRateLimit(req);
  if (limited) return limited;
  if (!hasGeminiKey) {
    return Response.json(
      { error: "Gemini API түлхүүр алга. .env.local файлд GOOGLE_GENERATIVE_AI_API_KEY нэмээд серверээ дахин асаана уу." },
      { status: 500 },
    );
  }
  const params = await req.json();

  const t0 = Date.now();
  let stepUsage: Usage | null = null;
  let totalUsage: Usage | null = null;
  let modelId = "";

  const stream = await handleChatStream({
    mastra,
    agentId: "supportAgent",
    version: "v7",
    params,
    onError: (error) => (error instanceof Error ? error.message : String(error)),
    // Metadata буцаахгүй; зөвхөн алхам бүрийн токены хэрэглээг барьж авахад ашиглана.
    messageMetadata: ({ part }) => {
      const p = part as unknown as {
        type: string;
        usage?: Record<string, unknown>;
        totalUsage?: Record<string, unknown>;
        response?: { modelId?: string };
      };
      if (p.type === "finish-step") {
        stepUsage = toUsage(p.usage);
        modelId = p.response?.modelId || modelId;
      }
      if (p.type === "finish") totalUsage = toUsage(p.totalUsage);
      return undefined;
    },
  });

  // Урсгалын үйл явдал бүрд серверийн цагийг тэмдэглэж, "data-trace" хэсэг болгон нэмж илгээнэ.
  // Вэб тал эдгээрээс агентын ажиллагааны цагийн шугам, хэмжүүрийг бодит цагт зурна.
  type Chunk = { type: string; toolName?: string; toolCallId?: string; errorText?: string };
  const traced = (stream as unknown as ReadableStream<Chunk>).pipeThrough(
    new TransformStream<Chunk, unknown>({
      transform(chunk, controller) {
        const trace = (data: Record<string, unknown>) =>
          controller.enqueue({ type: "data-trace", data: { t: Date.now() - t0, ...data } });

        switch (chunk.type) {
          case "start":
            controller.enqueue(chunk);
            trace({ ev: "start" });
            return;
          case "start-step":
            controller.enqueue(chunk);
            trace({ ev: "step-start" });
            return;
          case "tool-input-available":
            controller.enqueue(chunk);
            trace({ ev: "tool-call", toolName: chunk.toolName, toolCallId: chunk.toolCallId });
            return;
          case "tool-output-available":
          case "tool-output-error":
            controller.enqueue(chunk);
            trace({ ev: "tool-result", toolCallId: chunk.toolCallId, failed: chunk.type === "tool-output-error" });
            return;
          // Human-in-the-loop: tool зөвшөөрөл хүлээж зогссон / хүн татгалзсан.
          case "tool-approval-request":
            controller.enqueue(chunk);
            trace({ ev: "approval-request", toolCallId: chunk.toolCallId });
            return;
          case "tool-output-denied":
            controller.enqueue(chunk);
            trace({ ev: "tool-result", toolCallId: chunk.toolCallId, denied: true });
            return;
          case "text-start":
            controller.enqueue(chunk);
            trace({ ev: "text-start" });
            return;
          case "error":
            trace({ ev: "error", text: chunk.errorText });
            controller.enqueue(chunk);
            return;
          case "finish-step":
            trace({ ev: "step-finish", usage: stepUsage, model: modelId });
            stepUsage = null;
            controller.enqueue(chunk);
            return;
          case "finish":
            trace({ ev: "finish", usage: totalUsage, model: modelId });
            controller.enqueue(chunk);
            return;
          default:
            controller.enqueue(chunk);
        }
      },
    }),
  );

  return createUIMessageStreamResponse({
    stream: traced as unknown as Parameters<typeof createUIMessageStreamResponse>[0]["stream"],
  });
}
