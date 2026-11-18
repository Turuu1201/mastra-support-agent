import { accessCookie, accessRequired, isAuthorized, isCodeValid, loginRateLimit } from "@/lib/guard";

export const dynamic = "force-dynamic";

/** Сайт код шаардаж байгаа эсэх, энэ хөтөч нэвтэрсэн эсэхийг буцаана. */
export function GET(req: Request) {
  return Response.json({ required: accessRequired(), authorized: isAuthorized(req) });
}

/** Кодыг шалгаад зөв бол 30 хоногийн cookie тавина. */
export async function POST(req: Request) {
  const limited = loginRateLimit(req);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  if (!isCodeValid(body?.code)) {
    return Response.json({ error: "Код буруу байна." }, { status: 401 });
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": accessCookie() } });
}
