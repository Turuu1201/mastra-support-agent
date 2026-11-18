"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentPanel } from "./agent-panel";

type Row = Record<string, string | number | null>;
type ShopData = { orders: Row[]; tickets: Row[]; products: Row[] };

const TOOL_LABELS: Record<string, string> = {
  searchProducts: "Бараа хайх",
  getOrder: "Захиалга шалгах",
  listCustomerOrders: "Хэрэглэгчийн захиалгууд",
  cancelOrder: "Захиалга цуцлах",
  createTicket: "Тасалбар үүсгэх",
  searchKnowledge: "Мэдлэгийн сангаас хайх",
};

const EXAMPLES = [
  "ORD-1002 захиалга маань хаана явж байна?",
  "1 саяас доош үнэтэй утас юу байна?",
  "99110001 дугаараар хийсэн захиалгуудаа харъя",
  "ORD-1004 захиалгаа цуцлмаар байна",
  "ORD-1001-ээр авсан чихэвч маань ажиллахгүй байна",
  "Орон нутагт хүргэлт хэд хоног болох вэ?",
  "Buds Pro чихэвчний нэг тал дуугарахгүй байна, яах вэ?",
  "Хуваан төлөлтөөр авах нөхцөл юу вэ?",
];

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  processing: "bg-blue-100 text-blue-800",
  shipped: "bg-violet-100 text-violet-800",
  delivered: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-zinc-200 text-zinc-600",
};

const money = (n: unknown) => Number(n).toLocaleString("en-US") + "₮";

export default function Home() {
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  // Сайт нэвтрэх код шаарддаг эсэхийг серверээс асууна (ACCESS_CODE тохируулсан үед).
  const [access, setAccess] = useState<"loading" | "locked" | "ok">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth", { cache: "no-store" })
      .then((r) => r.json())
      .then((a: { required: boolean; authorized: boolean }) => {
        if (!cancelled) setAccess(a.required && !a.authorized ? "locked" : "ok");
      })
      .catch(() => {
        if (!cancelled) setAccess("ok");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (access === "loading") return <div className="h-dvh bg-zinc-50" />;
  if (access === "locked") return <AccessGate onUnlock={() => setAccess("ok")} />;
  return <Chat key={threadId} threadId={threadId} onNewChat={() => setThreadId(crypto.randomUUID())} />;
}

function AccessGate({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    if (!code.trim() || checking) return;
    setChecking(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) return onUnlock();
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Нэвтэрч чадсангүй.");
    } catch {
      setError("Сервертэй холбогдож чадсангүй.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex h-dvh items-center justify-center bg-zinc-50 px-4 text-zinc-900">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6"
      >
        <h1 className="text-base font-semibold">ТехМаркет туслах</h1>
        <p className="mt-1 text-sm text-zinc-500">Энэ туршилтын сайт нэвтрэх кодоор хамгаалагдсан.</p>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Нэвтрэх код"
          autoFocus
          className="mt-4 w-full rounded-xl border border-zinc-300 px-4 py-2.5 text-sm outline-none focus:border-zinc-900"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={!code.trim() || checking}
          className="mt-4 w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm text-white disabled:opacity-40"
        >
          {checking ? "Шалгаж байна…" : "Нэвтрэх"}
        </button>
      </form>
    </div>
  );
}

function Chat({ threadId, onNewChat }: { threadId: string; onNewChat: () => void }) {
  const [input, setInput] = useState("");
  const [data, setData] = useState<ShopData | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"trace" | "db">("trace");
  const [liveMs, setLiveMs] = useState(0);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        // Memory ашиглаж байгаа тул зөвхөн шинэ мессежийг илгээнэ; түүхийг Mastra DB-ээс ачаална.
        prepareSendMessagesRequest({ messages }) {
          return {
            body: {
              messages: [messages[messages.length - 1]],
              memory: { thread: threadId, resource: "demo-user" },
            },
          };
        },
      }),
    [threadId],
  );

  const refreshData = useCallback(async () => {
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      /* самбар заавал биш */
    }
  }, []);

  const { messages, sendMessage, status, error, stop, addToolApprovalResponse } = useChat({
    id: threadId,
    transport,
    // Хүн зөвшөөрөх/татгалзах товч дарсны дараа хариуг сервер рүү автоматаар илгээж, агентыг үргэлжлүүлнэ.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: () => void refreshData(),
  });

  useEffect(() => {
    const id = setTimeout(() => void refreshData(), 0);
    return () => clearTimeout(id);
  }, [refreshData]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";
  // Сүүлийн хариунд зөвшөөрөл хүлээж буй tool байвал шинэ мессеж илгээхийг түр хаана.
  const awaitingApproval =
    !busy &&
    (messages[messages.length - 1]?.parts ?? []).some(
      (p) => (p as unknown as ToolPart).state === "approval-requested",
    );

  // Ажиллаж байх үед цагийн шугамыг 100 мс тутамд шинэчилнэ.
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const id = setInterval(() => setLiveMs(Date.now() - start), 100);
    return () => clearInterval(id);
  }, [busy]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy || awaitingApproval) return;
    void sendMessage({ text: t });
    setInput("");
  };

  const resetDb = async () => {
    await fetch("/api/data", { method: "POST" });
    await refreshData();
  };

  return (
    <div className="flex h-dvh bg-zinc-50 text-zinc-900">
      {/* Чат */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-3">
          <div>
            <h1 className="text-base font-semibold">ТехМаркет туслах</h1>
            <p className="text-xs text-zinc-500">Mastra + Gemini агентын туршилт</p>
          </div>
          <button
            onClick={onNewChat}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100"
          >
            Шинэ чат
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {messages.length === 0 && (
              <div className="mt-8">
                <p className="mb-3 text-sm text-zinc-500">Жишээ асуултууд:</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {EXAMPLES.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm hover:border-zinc-400"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={m.role === "user" ? "max-w-[85%]" : "w-full max-w-[85%]"}>
                  {m.parts.map((part, i) => {
                    if (part.type === "text") {
                      if (!part.text) return null;
                      return (
                        <div
                          key={i}
                          className={
                            m.role === "user"
                              ? "whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-900 px-4 py-2.5 text-sm text-white"
                              : "mb-2 whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-4 py-2.5 text-sm leading-relaxed"
                          }
                        >
                          {part.text}
                        </div>
                      );
                    }
                    if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
                      return (
                        <ToolCall
                          key={i}
                          part={part as unknown as ToolPart}
                          onApproval={(id, approved) =>
                            void addToolApprovalResponse({
                              id,
                              approved,
                              reason: approved ? undefined : "Хэрэглэгч цуцлахаас татгалзсан",
                            })
                          }
                        />
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            ))}

            {status === "submitted" && <p className="text-sm text-zinc-400">Бодож байна…</p>}
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                Алдаа: {errorText(error)}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="border-t border-zinc-200 bg-white px-5 py-4"
        >
          <div className="mx-auto flex max-w-2xl gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={awaitingApproval ? "Эхлээд дээрх үйлдлийг зөвшөөрөх эсэхээ сонгоно уу" : "Асуултаа бичнэ үү…"}
              disabled={awaitingApproval}
              className="flex-1 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm outline-none focus:border-zinc-900 disabled:bg-zinc-100"
            />
            {busy ? (
              <button
                type="button"
                onClick={() => void stop()}
                className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm hover:bg-zinc-100"
              >
                Зогсоох
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm text-white disabled:opacity-40"
              >
                Илгээх
              </button>
            )}
          </div>
        </form>
      </main>

      {/* Баруун тал: агентын ажиллагаа / өгөгдлийн сан */}
      <aside className="hidden w-[28rem] shrink-0 flex-col overflow-y-auto border-l border-zinc-200 bg-white md:flex">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2.5">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm">
            <button
              onClick={() => setTab("trace")}
              className={`rounded-md px-3 py-1 ${tab === "trace" ? "bg-white font-medium shadow-sm" : "text-zinc-500"}`}
            >
              Агентын ажиллагаа
            </button>
            <button
              onClick={() => setTab("db")}
              className={`rounded-md px-3 py-1 ${tab === "db" ? "bg-white font-medium shadow-sm" : "text-zinc-500"}`}
            >
              Өгөгдлийн сан
            </button>
          </div>
          {tab === "db" && (
            <button onClick={resetDb} className="text-xs text-zinc-500 underline hover:text-zinc-900">
              Анхны төлөвт буцаах
            </button>
          )}
        </div>
        {tab === "trace" ? (
          <AgentPanel messages={messages} busy={busy} liveMs={liveMs} />
        ) : !data ? (
          <p className="p-4 text-sm text-zinc-400">Ачаалж байна…</p>
        ) : (
          <div className="flex flex-col gap-5 p-4 text-xs">
            <section>
              <h3 className="mb-2 font-semibold text-zinc-500">Захиалгууд</h3>
              <ul className="flex flex-col gap-1.5">
                {data.orders.map((o) => (
                  <li key={String(o.id)} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-mono font-medium">{o.id}</span>{" "}
                      <span className="text-zinc-500">
                        {o.customer} · {o.phone}
                      </span>
                    </span>
                    <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[String(o.status)] ?? ""}`}>
                      {o.status}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-2 font-semibold text-zinc-500">Тасалбарууд ({data.tickets.length})</h3>
              {data.tickets.length === 0 ? (
                <p className="text-zinc-400">Одоогоор тасалбар алга. Агент үүсгэхэд энд гарна.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {data.tickets.map((t) => (
                    <li key={String(t.id)} className="rounded-lg border border-zinc-200 p-2">
                      <div className="font-medium">
                        #{t.id} {t.subject}
                      </div>
                      <div className="text-zinc-500">
                        {t.priority} · {t.status}
                        {t.order_id ? ` · ${t.order_id}` : ""}
                        {t.customer_phone ? ` · ${t.customer_phone}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-2 font-semibold text-zinc-500">Бараа</h3>
              <ul className="flex flex-col gap-1">
                {data.products.map((p) => (
                  <li key={String(p.id)} className="flex justify-between gap-2">
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-zinc-500">
                      {money(p.price)} · {Number(p.stock) > 0 ? `${p.stock} ш` : "дууссан"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

type ToolPart = {
  type: string;
  toolName?: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  /** Human-in-the-loop: зөвшөөрлийн хүсэлт ба түүний хариу. */
  approval?: { id: string; approved?: boolean };
};

function ToolCall({ part, onApproval }: { part: ToolPart; onApproval: (id: string, approved: boolean) => void }) {
  const name = part.type === "dynamic-tool" ? (part.toolName ?? "tool") : part.type.slice(5);
  const done = part.state === "output-available";
  const failed = part.state === "output-error";
  const denied = part.state === "output-denied";

  // Агент зөвшөөрөл шаарддаг tool дуудсан: хүн шийдэх хүртэл tool ажиллахгүй.
  if (part.state === "approval-requested" && part.approval) {
    const approvalId = part.approval.id;
    const input = (part.input ?? {}) as { orderId?: string; reason?: string };
    return (
      <div className="mb-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
        <div className="font-medium text-amber-900">Зөвшөөрөл шаардлагатай: {TOOL_LABELS[name] ?? name}</div>
        <p className="mt-1 text-amber-900/80">
          {name === "cancelOrder" && input.orderId
            ? `Агент ${input.orderId} захиалгыг цуцлах гэж байна. Цуцалсны дараа сэргээх боломжгүй.`
            : "Агент энэ үйлдлийг хийхийн өмнө таны зөвшөөрлийг хүсэж байна."}
        </p>
        {input.reason && <p className="mt-1 text-xs text-amber-900/70">Шалтгаан: {input.reason}</p>}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onApproval(approvalId, true)}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700"
          >
            Зөвшөөрөх
          </button>
          <button
            onClick={() => onApproval(approvalId, false)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-100"
          >
            Татгалзах
          </button>
        </div>
      </div>
    );
  }

  return (
    <details className="mb-2 rounded-xl border border-zinc-200 bg-zinc-100/70 text-xs">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2">
        <span>{failed ? "⚠️" : denied ? "🚫" : done ? "✅" : "⏳"}</span>
        <span className="font-medium">{TOOL_LABELS[name] ?? name}</span>
        <span className="font-mono text-zinc-500">{name}</span>
        {denied && <span className="text-zinc-500">хэрэглэгч татгалзсан</span>}
        {done && part.approval?.approved && <span className="text-zinc-500">хэрэглэгч зөвшөөрсөн</span>}
        {!done && !failed && !denied && <span className="text-zinc-400">ажиллаж байна…</span>}
      </summary>
      <div className="border-t border-zinc-200 px-3 py-2">
        <div className="mb-1 text-zinc-500">Оролт</div>
        <pre className="mb-2 overflow-x-auto whitespace-pre-wrap font-mono">{JSON.stringify(part.input, null, 2)}</pre>
        {done && (
          <>
            <div className="mb-1 text-zinc-500">Гаралт</div>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap font-mono">
              {JSON.stringify(part.output, null, 2)}
            </pre>
          </>
        )}
        {failed && <div className="text-red-600">{part.errorText}</div>}
      </div>
    </details>
  );
}

function errorText(error: Error) {
  try {
    const parsed = JSON.parse(error.message);
    if (parsed?.error) return String(parsed.error);
  } catch {
    /* JSON биш */
  }
  return error.message;
}
