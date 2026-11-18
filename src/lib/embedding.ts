import { embed, embedMany } from "ai";
import { google } from "@ai-sdk/google";

// Gemini-ийн embedding загвар (үнэгүй эрхэд багтдаг). Текстийг 768 хэмжээст вектор болгоно.
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMS = 768;

const model = () => google.embedding(EMBEDDING_MODEL);

/** Баримтын хэсгүүдийг вектор болгоно (индекс үүсгэх үед). */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: model(),
    values: texts,
    providerOptions: { google: { outputDimensionality: EMBEDDING_DIMS, taskType: "RETRIEVAL_DOCUMENT" } },
  });
  return embeddings;
}

/** Хэрэглэгчийн асуултыг вектор болгоно (хайлтын үед). */
export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: model(),
    value: text,
    providerOptions: { google: { outputDimensionality: EMBEDDING_DIMS, taskType: "RETRIEVAL_QUERY" } },
  });
  return embedding;
}
