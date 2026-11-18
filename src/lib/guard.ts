import { createHash, timingSafeEqual } from "node:crypto";

// Сайтын хамгаалалт: (1) нэвтрэх код, (2) хүсэлтийн тооны хязгаар.
// Зорилго нь Gemini-ийн үнэгүй квотыг танихгүй хүн дуусгахаас сэргийлэх.

const COOKIE = "tm_access";
const sha = (s: string) => createHash("sha256").update(s).digest();

/** ACCESS_CODE тохируулаагүй бол сайт нээлттэй (локал хөгжүүлэлтэд тохиромжтой). */
const accessCode = () => process.env.ACCESS_CODE?.trim() ?? "";
export const accessRequired = () => accessCode() !== "";

// Cookie-д кодыг өөрийг нь биш, хэшийг нь хадгална.
const cookieToken = () => sha(`techmarket:${accessCode()}`).toString("hex");

export function isCodeValid(input: unknown): boolean {
  if (typeof input !== "string" || !accessRequired()) return false;
  // Тогтмол хугацаатай харьцуулалт: хариу өгөх хугацаанаас кодыг таах боломжгүй болгоно.
  return timingSafeEqual(sha(input.trim()), sha(accessCode()));
}

export function isAuthorized(req: Request): boolean {
  if (!accessRequired()) return true;
  const cookies = req.headers.get("cookie") ?? "";
  const value = cookies
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!value) return false;
  const expected = cookieToken();
  return value.length === expected.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

export function accessCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${cookieToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`;
}

export const unauthorized = () =>
  Response.json({ error: "Нэвтрэх код шаардлагатай. Хуудсаа дахин ачаална уу." }, { status: 401 });

// ---- Хүсэлтийн тооны хязгаар ----
// Тоолуур серверийн санах ойд байна. Vercel дээр instance бүр өөрийн тоолууртай тул хязгаар ойролцоо:
// туршилтын төсөлд хангалттай, бодит системд Redis зэрэг дундын сан ашиглана.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const hits = new Map<string, number[]>();

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

type Limit = { ok: true } | { ok: false; retryAfter: number };

/** Гулсах цонхтой тоолуур: `windowMs` хугацаанд `max`-аас олон хүсэлт ирвэл татгалзана. */
export function rateLimit(key: string, max: number, windowMs: number): Limit {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { ok: false, retryAfter: Math.ceil((recent[0] + windowMs - now) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  // Санах ой дүүрэхээс сэргийлж хуучирсан түлхүүрүүдийг үе үе цэвэрлэнэ.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= DAY)) hits.delete(k);
  }
  return { ok: true };
}

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** Чатын хүсэлт: нэг IP-ээс минутад N, бүх хэрэглэгчээс өдөрт M. */
export function chatRateLimit(req: Request): Response | null {
  const perMinute = rateLimit(`chat:${clientIp(req)}`, envInt("CHAT_LIMIT_PER_MINUTE", 8), MINUTE);
  if (!perMinute.ok) return tooMany(`Хэт олон хүсэлт илгээлээ. ${perMinute.retryAfter} секундын дараа дахин оролдоно уу.`, perMinute.retryAfter);
  const perDay = rateLimit("chat:all", envInt("CHAT_LIMIT_PER_DAY", 200), DAY);
  if (!perDay.ok) return tooMany("Өнөөдрийн хүсэлтийн хязгаар дууслаа. Маргааш дахин оролдоно уу.", perDay.retryAfter);
  return null;
}

/** Нэвтрэх кодыг таах оролдлогыг хязгаарлана: нэг IP-ээс минутад 5. */
export function loginRateLimit(req: Request): Response | null {
  const r = rateLimit(`login:${clientIp(req)}`, 5, MINUTE);
  return r.ok ? null : tooMany(`Хэт олон оролдлого. ${r.retryAfter} секундын дараа дахин оролдоно уу.`, r.retryAfter);
}

const tooMany = (error: string, retryAfter: number) =>
  Response.json({ error }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
