import { LibSQLVector } from "@mastra/libsql";
import { dbUrl } from "./data-dir";
import { embedQuery } from "./embedding";
// `npm run ingest`-ээр үүсгэсэн индекс: баримтын хэсгүүд ба тэдгээрийн вектор.
import indexFile from "../knowledge/index.json";

type IndexedChunk = { id: string; source: string; title: string; section: string; text: string; vector: number[] };
const index = indexFile as { version: string; model: string; dims: number; chunks: IndexedChunk[] };

// Индексийн нэрэнд хувилбарыг оруулснаар баримт өөрчлөгдөхөд шинэ индекс автоматаар үүснэ.
const INDEX_NAME = `knowledge_${index.version}`;

let store: LibSQLVector | undefined;
let ready: Promise<void> | undefined;

/**
 * Вектор санг бэлдэнэ. Векторуудыг урьдчилан тооцоолсон тул энд embedding API дуудахгүй:
 * index.json-оос уншаад libSQL-ийн вектор индекст хуулна (сервер анх асах үед нэг удаа).
 */
async function getStore(): Promise<LibSQLVector> {
  store ??= new LibSQLVector({ id: "knowledge-vector", url: dbUrl("knowledge.db") });
  const s = store;
  ready ??= (async () => {
    const existing = await s.listIndexes();
    if (existing.includes(INDEX_NAME)) {
      const stats = await s.describeIndex({ indexName: INDEX_NAME });
      if (stats.count === index.chunks.length) return;
      await s.deleteIndex({ indexName: INDEX_NAME });
    }
    for (const old of existing) {
      if (old.startsWith("knowledge_") && old !== INDEX_NAME) await s.deleteIndex({ indexName: old });
    }
    await s.createIndex({ indexName: INDEX_NAME, dimension: index.dims });
    await s.upsert({
      indexName: INDEX_NAME,
      ids: index.chunks.map((c) => c.id),
      vectors: index.chunks.map((c) => c.vector),
      metadata: index.chunks.map(({ source, title, section, text }) => ({ source, title, section, text })),
    });
  })().catch((e) => {
    ready = undefined;
    throw e;
  });
  await ready;
  return s;
}

export type KnowledgeHit = { title: string; section: string; text: string; source: string; score: number };

/** Асуулттай утгаараа хамгийн ойр хэсгүүдийг буцаана. */
export async function searchKnowledgeBase(query: string, topK = 4): Promise<KnowledgeHit[]> {
  const s = await getStore();
  const queryVector = await embedQuery(query);
  const results = await s.query({ indexName: INDEX_NAME, queryVector, topK });
  return results.map((r) => ({
    title: String(r.metadata?.title ?? ""),
    section: String(r.metadata?.section ?? ""),
    text: String(r.metadata?.text ?? ""),
    source: String(r.metadata?.source ?? ""),
    score: Number(r.score.toFixed(3)),
  }));
}

export const knowledgeStats = { chunks: index.chunks.length, model: index.model, version: index.version };
