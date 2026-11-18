import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getDb } from "@/lib/db";

const STATUS_MN: Record<string, string> = {
  pending: "хүлээгдэж буй",
  processing: "бэлтгэж буй",
  shipped: "хүргэлтэнд гарсан",
  delivered: "хүргэгдсэн",
  cancelled: "цуцлагдсан",
};

export const searchProducts = createTool({
  id: "search-products",
  description:
    "Дэлгүүрийн барааг нэр, ангилал, үнийн дээд хязгаараар хайна. Үнэ, үлдэгдэл (stock), тайлбар буцаана.",
  inputSchema: z.object({
    query: z.string().optional().describe("Барааны нэрэнд орсон түлхүүр үг, жишээ нь iPhone, чихэвч"),
    category: z
      .enum(["утас", "компьютер", "дагалдах хэрэгсэл", "ухаалаг цаг"])
      .optional()
      .describe("Барааны ангилал"),
    maxPrice: z.number().optional().describe("Үнийн дээд хязгаар, төгрөгөөр"),
  }),
  execute: async ({ query, category, maxPrice }) => {
    const db = await getDb();
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (query) {
      where.push("(name LIKE ? OR description LIKE ?)");
      args.push(`%${query}%`, `%${query}%`);
    }
    if (category) {
      where.push("category = ?");
      args.push(category);
    }
    if (maxPrice !== undefined) {
      where.push("price <= ?");
      args.push(maxPrice);
    }
    const sql = `SELECT id, name, category, price, stock, description FROM products ${
      where.length ? "WHERE " + where.join(" AND ") : ""
    } ORDER BY price`;
    const { rows } = await db.execute({ sql, args });
    return { count: rows.length, products: rows.map((r) => ({ ...r })) };
  },
});

export const getOrder = createTool({
  id: "get-order",
  description:
    "Захиалгын дугаараар (жишээ нь ORD-1002) захиалгын төлөв, бараа, нийт дүн, хүргэлтийн хаягийг авна.",
  inputSchema: z.object({
    orderId: z.string().describe("Захиалгын дугаар, ORD-XXXX хэлбэртэй"),
  }),
  execute: async ({ orderId }) => {
    const db = await getDb();
    const id = orderId.trim().toUpperCase();
    const { rows } = await db.execute({
      sql: `SELECT o.id, o.status, o.total, o.delivery_address, o.created_at, c.name AS customer_name, c.phone
            FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`,
      args: [id],
    });
    if (rows.length === 0) return { found: false, message: `${id} дугаартай захиалга олдсонгүй.` };
    const items = await db.execute({
      sql: `SELECT p.name, oi.quantity, oi.unit_price FROM order_items oi
            JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`,
      args: [id],
    });
    const o = rows[0];
    return {
      found: true,
      order: { ...o, status_mn: STATUS_MN[String(o.status)] ?? o.status },
      items: items.rows.map((r) => ({ ...r })),
    };
  },
});

export const listCustomerOrders = createTool({
  id: "list-customer-orders",
  description: "Хэрэглэгчийн утасны дугаараар түүний бүх захиалгын жагсаалтыг авна.",
  inputSchema: z.object({
    phone: z.string().describe("Хэрэглэгчийн 8 оронтой утасны дугаар"),
  }),
  execute: async ({ phone }) => {
    const db = await getDb();
    const p = phone.replace(/\D/g, "");
    const cust = await db.execute({ sql: "SELECT id, name FROM customers WHERE phone = ?", args: [p] });
    if (cust.rows.length === 0) return { found: false, message: `${p} дугаартай хэрэглэгч бүртгэлгүй байна.` };
    const { rows } = await db.execute({
      sql: "SELECT id, status, total, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC",
      args: [cust.rows[0].id as number],
    });
    return {
      found: true,
      customer: cust.rows[0].name,
      orders: rows.map((r) => ({ ...r, status_mn: STATUS_MN[String(r.status)] ?? r.status })),
    };
  },
});

export const cancelOrder = createTool({
  id: "cancel-order",
  description:
    "Захиалгыг цуцална. Зөвхөн pending эсвэл processing төлөвтэй захиалга цуцлагдана. Хэрэглэгч тодорхой зөвшөөрсний дараа л дуудна.",
  inputSchema: z.object({
    orderId: z.string().describe("Цуцлах захиалгын дугаар"),
    reason: z.string().describe("Цуцлах шалтгаан"),
  }),
  execute: async ({ orderId, reason }) => {
    const db = await getDb();
    const id = orderId.trim().toUpperCase();
    const { rows } = await db.execute({ sql: "SELECT status FROM orders WHERE id = ?", args: [id] });
    if (rows.length === 0) return { success: false, message: `${id} дугаартай захиалга олдсонгүй.` };
    const status = String(rows[0].status);
    if (status !== "pending" && status !== "processing") {
      return {
        success: false,
        message: `Захиалга "${STATUS_MN[status] ?? status}" төлөвтэй тул цуцлах боломжгүй.`,
      };
    }
    await db.batch(
      [
        { sql: "UPDATE orders SET status = 'cancelled' WHERE id = ?", args: [id] },
        {
          sql: `UPDATE products SET stock = stock + (
                  SELECT quantity FROM order_items WHERE order_id = ? AND product_id = products.id)
                WHERE id IN (SELECT product_id FROM order_items WHERE order_id = ?)`,
          args: [id, id],
        },
      ],
      "write",
    );
    return { success: true, message: `${id} захиалга цуцлагдлаа.`, reason };
  },
});

export const createTicket = createTool({
  id: "create-ticket",
  description:
    "Агент өөрөө шийдэж чадахгүй асуудал (гэмтэл, буцаалт, гомдол гэх мэт)-д дэмжлэгийн тасалбар (ticket) үүсгэж, ажилтанд шилжүүлнэ.",
  inputSchema: z.object({
    subject: z.string().describe("Асуудлын товч гарчиг"),
    description: z.string().describe("Асуудлын дэлгэрэнгүй тайлбар"),
    priority: z.enum(["low", "medium", "high"]).describe("Чухлын зэрэг"),
    customerPhone: z.string().optional().describe("Хэрэглэгчийн утасны дугаар"),
    orderId: z.string().optional().describe("Холбогдох захиалгын дугаар"),
  }),
  execute: async ({ subject, description, priority, customerPhone, orderId }) => {
    const db = await getDb();
    const res = await db.execute({
      sql: `INSERT INTO tickets (customer_phone, order_id, subject, description, priority, created_at)
            VALUES (?,?,?,?,?,?)`,
      args: [
        customerPhone ?? null,
        orderId ? orderId.trim().toUpperCase() : null,
        subject,
        description,
        priority,
        new Date().toISOString(),
      ],
    });
    return { success: true, ticketId: Number(res.lastInsertRowid), status: "open" };
  },
});

export const getStorePolicy = createTool({
  id: "get-store-policy",
  description:
    "Дэлгүүрийн журам, мэдээллийг авна: хүргэлт, буцаалт, баталгаа, төлбөр, захиалга цуцлах, цагийн хуваарь. Журмын талаарх асуултад таамаглалгүйгээр заавал энэ tool-ийг ашигла.",
  inputSchema: z.object({
    topic: z
      .enum(["delivery", "return", "warranty", "payment", "cancellation", "hours", "all"])
      .describe("Журмын сэдэв. Тодорхойгүй бол all"),
  }),
  execute: async ({ topic }) => {
    const db = await getDb();
    const { rows } =
      topic === "all"
        ? await db.execute("SELECT topic, title, content FROM policies")
        : await db.execute({ sql: "SELECT topic, title, content FROM policies WHERE topic = ?", args: [topic] });
    return { policies: rows.map((r) => ({ ...r })) };
  },
});
