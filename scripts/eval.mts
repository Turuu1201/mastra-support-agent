// Агентын автомат үнэлгээ (eval).
// Тест асуулт бүрд агентыг ажиллуулж, зөв tool дуудсан эсэх, хариу нь өгөгдөлтэй таарч байгаа эсэхийг шалгана.
// Шалгалтууд нь кодоор хийгддэг (LLM шүүгч ашиглахгүй) тул нэмэлт квот зарцуулахгүй.
//
// Ажиллуулах:  npm run eval                 бүх тест
//              npm run eval -- --only=rag   нэр нь "rag"-аар эхэлсэн тестүүд
//              npm run eval -- --limit=3    эхний 3 тест
import fs from "node:fs";
import path from "node:path";
import { runEvals, type MastraScorer } from "@mastra/core/evals";
import { checks } from "@mastra/evals/checks";

// Жинхэнэ өгөгдлийг хөндөхгүйн тулд тусдаа хавтас ашиглана. Mastra-г импортлохоос өмнө тохируулах ёстой.
process.env.DATA_DIR = "data/eval";
const { mastra, hasGeminiKey } = await import("../src/mastra");
const { resetDb } = await import("../src/lib/db");

if (!hasGeminiKey) {
  console.error("Gemini API түлхүүр алга (.env.local).");
  process.exit(1);
}

// Шалгалт бүр өөр төрөлтэй тул runEvals-ийн хүлээн авдаг ерөнхий scorer төрлийг ашиглана.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Scorer = MastraScorer<any, any, any, any>;
type Case = { name: string; input: string; expect: string; checks: Scorer[] };

const CASES: Case[] = [
  {
    name: "order-status",
    input: "ORD-1002 захиалга маань хаана явж байна?",
    expect: "getOrder дуудаж, хүргэлтэнд гарсныг хэлнэ",
    checks: [checks.calledTool("getOrder"), checks.matches(/хүргэлт/i), checks.noToolErrors()],
  },
  {
    name: "order-list",
    input: "99110001 дугаараар хийсэн захиалгуудаа харъя",
    expect: "listCustomerOrders дуудаж, хоёр захиалгыг жагсаана",
    checks: [checks.calledTool("listCustomerOrders"), checks.includes("ORD-1001"), checks.matches(/ORD-1002/)],
  },
  {
    name: "product-search",
    input: "1 саяас доош үнэтэй утас юу байна?",
    expect: "searchProducts дуудаж, Redmi-г санал болгоно, iPhone-ыг дурдахгүй",
    checks: [checks.calledTool("searchProducts"), checks.includes("Redmi"), checks.excludes("iPhone")],
  },
  {
    name: "cancel-allowed",
    input: "ORD-1004 захиалгаа цуцлмаар байна",
    expect: "getOrder-оор шалгаад cancelOrder дуудна (хүний зөвшөөрөл хүлээж зогсоно)",
    checks: [checks.toolOrder(["getOrder", "cancelOrder"])],
  },
  {
    name: "cancel-refused",
    input: "ORD-1002 захиалгаа цуцлаарай",
    expect: "Хүргэлтэнд гарсан тул cancelOrder дуудахгүй",
    checks: [checks.calledTool("getOrder"), checks.didNotCall("cancelOrder")],
  },
  {
    name: "ticket",
    input: "ORD-1001-ээр авсан чихэвч маань огт асахгүй байна, гомдол бүртгүүлье. Утас 99110001",
    expect: "createTicket-ээр тасалбар үүсгэнэ",
    checks: [checks.calledTool("createTicket"), checks.noToolErrors()],
  },
  {
    name: "rag-troubleshoot",
    input: "Buds Pro чихэвчний нэг тал дуугарахгүй байна, яаж засах вэ?",
    expect: "searchKnowledge дуудаж, товчийг 10 секунд дарах зааврыг хэлнэ",
    checks: [checks.calledTool("searchKnowledge"), checks.matches(/10\s*секунд/i)],
  },
  {
    name: "rag-installment",
    input: "Хуваан төлөлтөөр авахад урьдчилгаа хэдэн хувь вэ?",
    expect: "searchKnowledge дуудаж, 20 хувь гэж хариулна",
    checks: [checks.calledTool("searchKnowledge"), checks.matches(/20\s*(хув|%)/i)],
  },
  {
    name: "rag-delivery",
    input: "Ховд аймаг руу хүргэлт хэд хоног болох вэ?",
    expect: "searchKnowledge дуудаж, 5-7 хоног гэж хариулна",
    checks: [checks.calledTool("searchKnowledge"), checks.matches(/5\s*[-–]\s*7/)],
  },
  {
    name: "rag-loaner",
    input: "Утсаа баталгаат засварт өгвөл орлох утас өгдөг үү?",
    expect: "searchKnowledge дуудаж, 100,000₮-ийн барьцааг дурдана",
    checks: [checks.calledTool("searchKnowledge"), checks.matches(/100[,.\s]?000/)],
  },
  {
    name: "off-topic",
    input: "Маргааш Улаанбаатарт цаг агаар ямар байх вэ?",
    expect: "Дэлгүүртэй холбоогүй тул tool дуудалгүй татгалзана",
    checks: [checks.usedNoTools()],
  },
];

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const only = arg("only");
const limit = Number(arg("limit")) || undefined;
// Үнэгүй эрхийн минутын хязгаарт багтахын тулд тест хооронд түр хүлээнэ.
const delayMs = Number(process.env.EVAL_DELAY_MS ?? 4000);

const selected = CASES.filter((c) => !only || c.name.startsWith(only)).slice(0, limit);
const agent = mastra.getAgent("supportAgent");
const model = process.env.GEMINI_MODEL ?? "google/gemini-3.8-flash";

await resetDb();
console.log(`Загвар: ${model} · ${selected.length} тест\n`);

type Row = { name: string; passed: boolean; scores: Record<string, number>; ms: number; error?: string; expect: string };
const rows: Row[] = [];

for (const [i, c] of selected.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
  const started = Date.now();
  const row: Row = { name: c.name, passed: false, scores: {}, ms: 0, expect: c.expect };
  try {
    const result = await runEvals({
      target: agent,
      data: [{ input: c.input }],
      scorers: c.checks,
      targetOptions: { maxSteps: 6 },
    });
    for (const [id, score] of Object.entries(result.scores as Record<string, number>)) row.scores[id] = score;
    row.passed = Object.values(row.scores).every((s) => s === 1) && Object.keys(row.scores).length > 0;
  } catch (e) {
    row.error = e instanceof Error ? e.message.slice(0, 200) : String(e);
  }
  row.ms = Date.now() - started;
  rows.push(row);

  const detail = Object.entries(row.scores)
    .map(([id, s]) => `${s === 1 ? "✓" : "✗"} ${id.replace(/^check-/, "")}`)
    .join("  ");
  console.log(`${row.passed ? "PASS" : "FAIL"}  ${c.name.padEnd(18)} ${(row.ms / 1000).toFixed(1).padStart(5)}с  ${detail}`);
  if (row.error) console.log(`      алдаа: ${row.error}`);
  else if (!row.passed) console.log(`      хүлээсэн: ${c.expect}`);
}

const passed = rows.filter((r) => r.passed).length;
console.log(`\nДүн: ${passed}/${rows.length} тэнцлээ (${Math.round((passed / Math.max(rows.length, 1)) * 100)}%)`);

// Загвар эсвэл зааврыг сольсны дараах дүнтэй харьцуулахын тулд үр дүнг хадгална.
const out = path.join(process.cwd(), "data", "eval", "last-run.json");
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), model, passed, total: rows.length, rows }, null, 2));
console.log(`Дэлгэрэнгүй: ${path.relative(process.cwd(), out)}`);
process.exit(passed === rows.length ? 0 : 1);
