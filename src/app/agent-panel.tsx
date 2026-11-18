"use client";

import type { UIMessage } from "ai";

type Usage = { input: number; output: number; total: number };

type TraceEvent = {
  t: number;
  ev:
    | "start"
    | "step-start"
    | "tool-call"
    | "tool-result"
    | "approval-request"
    | "text-start"
    | "step-finish"
    | "finish"
    | "error";
  toolName?: string;
  toolCallId?: string;
  failed?: boolean;
  denied?: boolean;
  usage?: Usage | null;
  model?: string;
  text?: string;
};

type ToolSpan = {
  id: string;
  name: string;
  start: number;
  end?: number;
  failed?: boolean;
  /** Human-in-the-loop: хүний зөвшөөрөл хүлээсэн tool-ийн төлөв. */
  approval?: "pending" | "approved" | "denied";
};
type Step = { n: number; start: number; end?: number; usage?: Usage; tools: ToolSpan[]; textAt?: number };
type Run = {
  steps: Step[];
  end?: number;
  ttft?: number;
  total?: Usage;
  model?: string;
  error?: string;
  /** Одоогийн хэсгийн (segment) эхлэх цэг. Зөвшөөрлийн дараа үргэлжилсэн хүсэлтийн цагийг өмнөхөд залгана. */
  offset: number;
  /** Хамгийн сүүлийн үйл явдлын цаг. */
  lastT: number;
};

const TOOL_LABELS: Record<string, string> = {
  searchProducts: "Бараа хайх",
  getOrder: "Захиалга шалгах",
  listCustomerOrders: "Хэрэглэгчийн захиалгууд",
  cancelOrder: "Захиалга цуцлах",
  createTicket: "Тасалбар үүсгэх",
  searchKnowledge: "Мэдлэгийн сангаас хайх",
};

function traceOf(m: UIMessage): TraceEvent[] {
  return m.parts
    .filter((p) => p.type === "data-trace")
    .map((p) => (p as unknown as { data: TraceEvent }).data);
}

function buildRun(events: TraceEvent[]): Run {
  const run: Run = { steps: [], offset: 0, lastT: 0 };
  let cur: Step | undefined;
  for (const raw of events) {
    // Хүн зөвшөөрсний дараа агент шинэ хүсэлтээр үргэлжилдэг бөгөөд серверийн цаг 0-ээс дахин эхэлнэ.
    // Тиймээс хоёр дахь "start"-аас хойших цагийг өмнөх хэсгийн төгсгөлд залгана (хүний бодсон хугацаа орохгүй).
    if (raw.ev === "start" && run.lastT > 0) {
      run.offset = run.lastT;
      run.end = undefined;
    }
    const e = { ...raw, t: raw.t + run.offset };
    run.lastT = Math.max(run.lastT, e.t);
    switch (e.ev) {
      case "step-start": {
        // "step-start" нь загварын хариу ирж эхлэх үед гардаг. Загварын бодсон хугацааг оруулахын тулд
        // алхмыг өмнөх алхам дууссан мөчөөс (эхнийх бол 0-ээс) эхэлсэн гэж тооцно.
        const prev = run.steps[run.steps.length - 1];
        cur = { n: run.steps.length + 1, start: prev ? (prev.end ?? e.t) : 0, tools: [] };
        run.steps.push(cur);
        break;
      }
      case "tool-call":
        cur?.tools.push({ id: e.toolCallId ?? "", name: e.toolName ?? "tool", start: e.t });
        break;
      case "tool-result":
        for (const s of run.steps) {
          const tool = s.tools.find((x) => x.id === e.toolCallId);
          if (tool) {
            tool.end = e.t;
            tool.failed = e.failed;
            if (e.denied) tool.approval = "denied";
            else if (tool.approval === "pending") tool.approval = "approved";
          }
        }
        break;
      case "approval-request":
        for (const s of run.steps) {
          const tool = s.tools.find((x) => x.id === e.toolCallId);
          if (tool) tool.approval = "pending";
        }
        break;
      case "text-start":
        if (run.ttft === undefined) run.ttft = e.t;
        if (cur && cur.textAt === undefined) cur.textAt = e.t;
        break;
      case "step-finish":
        if (cur) {
          cur.end = e.t;
          if (e.usage) cur.usage = e.usage;
        }
        if (e.model) run.model = e.model;
        break;
      case "finish":
        run.end = e.t;
        if (e.usage) run.total = e.usage;
        if (e.model) run.model = e.model;
        break;
      case "error":
        run.error = e.text;
        break;
    }
  }
  if (!run.total) {
    const sum = { input: 0, output: 0, total: 0 };
    for (const s of run.steps) {
      if (!s.usage) continue;
      sum.input += s.usage.input;
      sum.output += s.usage.output;
      sum.total += s.usage.total;
    }
    if (sum.total > 0) run.total = sum;
  }
  return run;
}

const fmtMs = (ms: number | undefined) => {
  if (ms === undefined) return "—";
  return ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(2)} с`;
};
const fmtNum = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("en-US"));

export function AgentPanel({
  messages,
  busy,
  liveMs,
}: {
  messages: UIMessage[];
  busy: boolean;
  /** Хүсэлт илгээснээс хойш өнгөрсөн хугацаа (ажиллаж байх үед). */
  liveMs: number;
}) {
  const assistantRuns = messages.filter((m) => m.role === "assistant").map((m) => buildRun(traceOf(m)));
  const last = messages[messages.length - 1];
  // Хүсэлт илгээгээд хариу эхлээгүй үед өмнөх хариуг биш, хоосон шинэ ажиллагааг харуулна.
  const waiting = busy && last?.role === "user";
  const run: Run | null = waiting
    ? { steps: [], offset: 0, lastT: 0 }
    : (assistantRuns[assistantRuns.length - 1] ?? null);
  const live = busy && run !== null && run.end === undefined;

  // Загвар хариу өгч эхлээгүй (бодож байгаа) үед хүлээгдэж буй алхмыг түр харуулна.
  if (run && live) {
    const prev = run.steps[run.steps.length - 1];
    if (!prev || prev.end !== undefined) {
      run.steps.push({ n: run.steps.length + 1, start: prev?.end ?? 0, tools: [] });
    }
  }
  // Ажиллаж байх үеийн "одоо": хэсгийн эхлэл + хүсэлт илгээснээс хойших хугацаа.
  const now = (run?.offset ?? 0) + liveMs;
  const awaitingApproval =
    !busy && run !== null && run.steps.some((s) => s.tools.some((t) => t.approval === "pending"));

  const session = assistantRuns.reduce(
    (acc, r) => {
      acc.requests += r.steps.length;
      acc.tools += r.steps.reduce((n, s) => n + s.tools.length, 0);
      acc.tokens += r.total?.total ?? 0;
      return acc;
    },
    { requests: 0, tools: 0, tokens: 0 },
  );

  if (!run) {
    return (
      <p className="p-4 text-sm text-zinc-400">
        Асуулт илгээхэд агентын алхам бүр, зарцуулсан хугацаа, токены тоо энд бодит цагт гарна.
      </p>
    );
  }

  const elapsed = run.end ?? (live ? Math.max(now, run.lastT) : run.lastT);
  const scale = Math.max(elapsed, 1);
  const toolCount = run.steps.reduce((n, s) => n + s.tools.length, 0);
  const toolMs = run.steps.reduce(
    (n, s) => n + s.tools.reduce((m, t) => m + ((t.end ?? (live && !t.approval ? now : t.start)) - t.start), 0),
    0,
  );

  return (
    <div className="flex flex-col gap-5 p-4 text-xs">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold text-zinc-500">Сүүлийн хүсэлт</h3>
          <span
            className={`rounded px-1.5 py-0.5 ${
              run.error
                ? "bg-red-100 text-red-700"
                : awaitingApproval
                  ? "bg-amber-100 text-amber-800"
                  : live
                  ? "bg-blue-100 text-blue-800"
                  : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {run.error ? "алдаа" : awaitingApproval ? "хүний зөвшөөрөл хүлээж байна" : live ? "ажиллаж байна…" : "дууссан"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Нийт хугацаа" value={fmtMs(elapsed)} />
          <Metric label="Эхний текст хүртэл" value={fmtMs(run.ttft)} />
          <Metric label="Tool-д зарцуулсан" value={toolCount ? fmtMs(toolMs) : "—"} />
          <Metric label="LLM хүсэлт" value={String(run.steps.length)} />
          <Metric label="Tool дуудлага" value={String(toolCount)} />
          <Metric label="Нийт токен" value={fmtNum(run.total?.total)} />
          <Metric label="Оролтын токен" value={fmtNum(run.total?.input)} />
          <Metric label="Гаралтын токен" value={fmtNum(run.total?.output)} />
          <Metric label="Загвар" value={run.model || "—"} small />
        </div>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-zinc-500">Цагийн шугам</h3>
        {
          <div className="flex flex-col gap-1">
            {run.steps.map((s) => {
              const sEnd = s.end ?? (live ? Math.max(now, s.start) : Math.max(run.lastT, s.start));
              return (
                <div key={s.n} className="rounded-lg border border-zinc-200 p-2">
                  <Row
                    label={`Алхам ${s.n}: LLM`}
                    sub={
                      s.usage
                        ? `${fmtNum(s.usage.input)} → ${fmtNum(s.usage.output)} токен`
                        : s.end === undefined && live
                          ? "бодож байна…"
                          : ""
                    }
                    start={s.start}
                    end={sEnd}
                    scale={scale}
                    color="bg-blue-500"
                    running={s.end === undefined && live}
                  />
                  {s.tools.map((t) => {
                    const tEnd = t.end ?? (live && !t.approval ? Math.max(now, t.start) : t.start);
                    return (
                      <Row
                        key={t.id}
                        indent
                        label={TOOL_LABELS[t.name] ?? t.name}
                        sub={
                          t.approval === "pending"
                            ? "зөвшөөрөл хүлээж байна"
                            : t.approval === "approved"
                              ? "хүн зөвшөөрсөн"
                              : t.approval === "denied"
                                ? "хүн татгалзсан"
                                : t.name
                        }
                        start={t.start}
                        end={tEnd}
                        scale={scale}
                        color={t.failed ? "bg-red-500" : t.approval ? "bg-amber-500" : "bg-emerald-500"}
                        running={t.end === undefined && live && !t.approval}
                      />
                    );
                  })}
                  {s.textAt !== undefined && (
                    <Row
                      indent
                      label="Хариу бичих"
                      sub={s.end === undefined && live ? "текст урсаж байна…" : ""}
                      start={s.textAt}
                      end={sEnd}
                      scale={scale}
                      color="bg-violet-500"
                      running={s.end === undefined && live}
                    />
                  )}
                </div>
              );
            })}
          </div>
        }
        {run.error && <p className="mt-2 text-red-600">{run.error}</p>}
        <div className="mt-2 flex gap-3 text-zinc-500">
          <Legend color="bg-blue-500" text="LLM алхам" />
          <Legend color="bg-emerald-500" text="Tool" />
          <Legend color="bg-amber-500" text="Зөвшөөрөл" />
          <Legend color="bg-violet-500" text="Хариу" />
        </div>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-zinc-500">Энэ чатын нийт дүн</h3>
        <div className="grid grid-cols-3 gap-2">
          <Metric label="LLM хүсэлт" value={String(session.requests)} />
          <Metric label="Tool дуудлага" value={String(session.tools)} />
          <Metric label="Токен" value={fmtNum(session.tokens)} />
        </div>
        <p className="mt-2 text-zinc-400">
          LLM хүсэлт бүр Gemini-ийн өдрийн үнэгүй хязгаараас нэгийг зарцуулна.
        </p>
      </section>
    </div>
  );
}

function Metric({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-2.5 py-2">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`font-semibold tabular-nums ${small ? "break-all text-[11px]" : "text-sm"}`}>{value}</div>
    </div>
  );
}

function Row({
  label,
  sub,
  start,
  end,
  scale,
  color,
  indent,
  running,
}: {
  label: string;
  sub?: string;
  start: number;
  end: number;
  scale: number;
  color: string;
  indent?: boolean;
  running?: boolean;
}) {
  const left = Math.min((start / scale) * 100, 100);
  const width = Math.max(((end - start) / scale) * 100, 0.8);
  return (
    <div className={`py-1 ${indent ? "pl-3" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate">
          <span className={indent ? "" : "font-medium"}>{label}</span>
          {sub && <span className="ml-1.5 text-zinc-400">{sub}</span>}
        </span>
        <span className="shrink-0 tabular-nums text-zinc-600">{fmtMs(end - start)}</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded bg-zinc-100">
        <div
          className={`absolute h-1.5 rounded ${color} ${running ? "animate-pulse" : ""}`}
          style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
        />
      </div>
    </div>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-sm ${color}`} />
      {text}
    </span>
  );
}
