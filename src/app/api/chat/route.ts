import { handleChatStream } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse } from "ai";
import { mastra, hasGeminiKey } from "@/mastra";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!hasGeminiKey) {
    return Response.json(
      { error: "Gemini API түлхүүр алга. .env.local файлд GOOGLE_GENERATIVE_AI_API_KEY нэмээд серверээ дахин асаана уу." },
      { status: 500 },
    );
  }
  const params = await req.json();
  const stream = await handleChatStream({
    mastra,
    agentId: "supportAgent",
    version: "v7",
    params,
    onError: (error) => (error instanceof Error ? error.message : String(error)),
  });
  return createUIMessageStreamResponse({ stream });
}
