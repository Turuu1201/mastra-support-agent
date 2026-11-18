// Мэдлэгийн санг индекслэх: knowledge/*.md → хэсэглэх → embedding → src/knowledge/index.json
// Ажиллуулах: npm run ingest   (knowledge/ доторх баримтыг өөрчлөх бүрт)
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MDocument } from "@mastra/rag";
import { EMBEDDING_DIMS, EMBEDDING_MODEL, embedDocuments } from "../src/lib/embedding";

const key =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
if (!key) {
  console.error("Gemini API түлхүүр алга (.env.local).");
  process.exit(1);
}
process.env.GOOGLE_GENERATIVE_AI_API_KEY ||= key;

const SRC = path.join(process.cwd(), "knowledge");
const OUT = path.join(process.cwd(), "src", "knowledge", "index.json");

type Chunk = { id: string; source: string; title: string; section: string; text: string; vector: number[] };
const chunks: Omit<Chunk, "vector">[] = [];

for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith(".md")).sort()) {
  const doc = MDocument.fromMarkdown(fs.readFileSync(path.join(SRC, file), "utf8"));
  // Гарчгаар нь хэсэглэнэ: "## ..." бүр нэг хэсэг болж, гарчгууд нь metadata-д орно.
  const parts = await doc.chunk({
    strategy: "markdown",
    headers: [
      ["#", "title"],
      ["##", "section"],
    ],
  });
  parts.forEach((p, i) => {
    const text = p.text.trim();
    if (!text) return;
    chunks.push({
      id: `${path.basename(file, ".md")}-${i + 1}`,
      source: file,
      title: String(p.metadata?.title ?? ""),
      section: String(p.metadata?.section ?? ""),
      text,
    });
  });
}

// Гарчгийг текстийн өмнө нэмж embedding хийвэл хайлт илүү оновчтой болдог.
const vectors = await embedDocuments(chunks.map((c) => `${c.title} — ${c.section}\n${c.text}`));

const version = createHash("sha256")
  .update(EMBEDDING_MODEL + JSON.stringify(chunks))
  .digest("hex")
  .slice(0, 10);

const index = {
  version,
  model: EMBEDDING_MODEL,
  dims: EMBEDDING_DIMS,
  chunks: chunks.map((c, i): Chunk => ({ ...c, vector: vectors[i].map((v) => Number(v.toFixed(5))) })),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(index));
console.log(`${chunks.length} хэсэг индекслэгдлээ → ${path.relative(process.cwd(), OUT)} (хувилбар ${version})`);
for (const c of chunks) console.log(`  ${c.id.padEnd(14)} ${c.section} (${c.text.length} тэмдэгт)`);
