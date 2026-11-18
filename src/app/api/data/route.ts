import { getDb, resetDb } from "@/lib/db";
import { isAuthorized, unauthorized } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Хажуугийн самбарт DB-ийн одоогийн төлөвийг харуулна.
export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const db = await getDb();
  const [orders, tickets, products] = await Promise.all([
    db.execute(
      `SELECT o.id, o.status, o.total, c.name AS customer, c.phone
       FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id`,
    ),
    db.execute("SELECT id, subject, priority, status, order_id, customer_phone FROM tickets ORDER BY id DESC"),
    db.execute("SELECT id, name, price, stock FROM products ORDER BY id"),
  ]);
  return Response.json({
    orders: orders.rows.map((r) => ({ ...r })),
    tickets: tickets.rows.map((r) => ({ ...r })),
    products: products.rows.map((r) => ({ ...r })),
  });
}

// DB-г анхны жишээ өгөгдөл рүү буцаана.
export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  await resetDb();
  return Response.json({ ok: true });
}
