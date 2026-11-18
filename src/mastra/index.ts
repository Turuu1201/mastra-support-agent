import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { dbUrl } from "@/lib/data-dir";
import { supportAgent } from "./agents/support-agent";

// Аль ч нэрээр өгсөн Gemini түлхүүрийг таниулна.
const key =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
if (key) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||= key;
  process.env.GOOGLE_API_KEY ||= key;
}

export const hasGeminiKey = Boolean(key);

export const mastra = new Mastra({
  agents: { supportAgent },
  // Чатын түүх (memory) энд хадгалагдана.
  storage: new LibSQLStore({ id: "mastra-storage", url: dbUrl("mastra.db") }),
});
