import { createClient, type Client } from "@libsql/client";
import { dbUrl } from "./data-dir";

// Дэлгүүрийн (бизнесийн) өгөгдлийн сан — SQLite файл: data/shop.db
// Mastra-ийн санах ой (чатын түүх) тусдаа data/mastra.db файлд хадгалагдана.

let client: Client | null = null;
let ready: Promise<void> | null = null;

function getClient(): Client {
  if (!client) {
    client = createClient({ url: dbUrl("shop.db") });
  }
  return client;
}

/** Схем + жишээ өгөгдөл бэлэн болсон client буцаана. */
export async function getDb(): Promise<Client> {
  const db = getClient();
  if (!ready) ready = init(db);
  await ready;
  return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL,
  description TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL,
  total INTEGER NOT NULL,
  delivery_address TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_phone TEXT,
  order_id TEXT,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policies (
  topic TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL
);
`;

async function init(db: Client) {
  await db.executeMultiple(SCHEMA);
  const { rows } = await db.execute("SELECT COUNT(*) AS n FROM products");
  if (Number(rows[0].n) === 0) await seed(db);
}

/** Бүх хүснэгтийг цэвэрлээд жишээ өгөгдлөөр дахин дүүргэнэ. */
export async function resetDb() {
  const db = getClient();
  await db.executeMultiple(`
    DROP TABLE IF EXISTS order_items; DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS tickets; DROP TABLE IF EXISTS products;
    DROP TABLE IF EXISTS customers; DROP TABLE IF EXISTS policies;
  `);
  await db.executeMultiple(SCHEMA);
  await seed(db);
  ready = Promise.resolve();
}

async function seed(db: Client) {
  const customers: [number, string, string, string][] = [
    [1, "Бат-Эрдэнэ", "99110001", "bat@example.mn"],
    [2, "Сарангэрэл", "88110002", "saraa@example.mn"],
    [3, "Тэмүүлэн", "95110003", "temuulen@example.mn"],
  ];
  const products: [number, string, string, number, number, string][] = [
    [1, "Galaxy A56 гар утас", "утас", 1450000, 12, "6.7 инч AMOLED дэлгэц, 256GB, 5000mAh батарей"],
    [2, "iPhone 16 гар утас", "утас", 3890000, 4, "6.1 инч дэлгэц, 128GB, A18 чип"],
    [3, "Redmi Note 14 гар утас", "утас", 890000, 20, "6.67 инч дэлгэц, 128GB, төсөвт ээлтэй"],
    [4, "ThinkPad E14 зөөврийн компьютер", "компьютер", 3250000, 6, "14 инч, Ryzen 5, 16GB RAM, 512GB SSD"],
    [5, "MacBook Air 13 зөөврийн компьютер", "компьютер", 4990000, 3, "13 инч, M4 чип, 16GB RAM, 256GB SSD"],
    [6, "IdeaPad Slim 3 зөөврийн компьютер", "компьютер", 1990000, 0, "15.6 инч, Core i3, 8GB RAM, 256GB SSD"],
    [7, "Утасгүй чихэвч Buds Pro", "дагалдах хэрэгсэл", 320000, 35, "Дуу чимээ тусгаарлагчтай, 30 цагийн батарей"],
    [8, "Цэнэглэгч 65W GaN", "дагалдах хэрэгсэл", 95000, 50, "USB-C, утас болон зөөврийн компьютерт тохирно"],
    [9, "Ухаалаг цаг Watch Fit 4", "ухаалаг цаг", 450000, 9, "Зүрхний цохилт, унтлага хянах, 10 хоногийн батарей"],
    [10, "Тоглоомын хулгана G305", "дагалдах хэрэгсэл", 145000, 15, "Утасгүй, 12000 DPI"],
  ];
  const orders: [string, number, string, number, string, string][] = [
    ["ORD-1001", 1, "delivered", 1770000, "УБ, СБД, 1-р хороо, 12-р байр 45 тоот", "2026-11-02"],
    ["ORD-1002", 1, "shipped", 3250000, "УБ, СБД, 1-р хороо, 12-р байр 45 тоот", "2026-11-14"],
    ["ORD-1003", 2, "processing", 985000, "УБ, ХУД, 15-р хороо, Зайсан 7-3", "2026-11-16"],
    ["ORD-1004", 2, "pending", 450000, "УБ, ХУД, 15-р хороо, Зайсан 7-3", "2026-11-17"],
    ["ORD-1005", 3, "cancelled", 3890000, "Дархан-Уул, Дархан сум, 5-р баг", "2026-11-05"],
    ["ORD-1006", 3, "delivered", 240000, "Дархан-Уул, Дархан сум, 5-р баг", "2026-10-21"],
  ];
  const items: [string, number, number, number][] = [
    ["ORD-1001", 1, 1, 1450000], ["ORD-1001", 7, 1, 320000],
    ["ORD-1002", 4, 1, 3250000],
    ["ORD-1003", 3, 1, 890000], ["ORD-1003", 8, 1, 95000],
    ["ORD-1004", 9, 1, 450000],
    ["ORD-1005", 2, 1, 3890000],
    ["ORD-1006", 10, 1, 145000], ["ORD-1006", 8, 1, 95000],
  ];
  const policies: [string, string, string][] = [
    ["delivery", "Хүргэлт", "Улаанбаатар хотод 24-48 цагт хүргэнэ, 100,000₮-өөс дээш захиалгад үнэгүй, бусад тохиолдолд 5,000₮. Орон нутагт унааны шуудангаар 3-5 хоногт хүргэнэ, төлбөр 15,000₮."],
    ["return", "Буцаалт, солилт", "Бараа хүлээн авснаас хойш 7 хоногийн дотор, сав баглаа боодол бүрэн, ашиглаагүй тохиолдолд буцааж болно. Мөнгийг 3-5 ажлын өдөрт буцаан шилжүүлнэ. Үйлдвэрийн гэмтэлтэй барааг 14 хоногийн дотор шинээр сольж өгнө."],
    ["warranty", "Баталгаат хугацаа", "Гар утас, зөөврийн компьютер 12 сар, ухаалаг цаг 6 сар, дагалдах хэрэгсэл 3 сарын баталгаатай. Унагасан, ус орсон гэмтэл баталгаанд хамаарахгүй."],
    ["payment", "Төлбөр", "QPay, банкны карт, дансаар шилжүүлэг, бэлэн мөнгө хүлээн авна. 1,000,000₮-өөс дээш худалдан авалтад 6 хүртэл сар хүүгүй хувааж төлөх боломжтой."],
    ["cancellation", "Захиалга цуцлах", "Зөвхөн 'pending' (хүлээгдэж буй) болон 'processing' (бэлтгэж буй) төлөвтэй захиалгыг цуцлах боломжтой. Хүргэлтэнд гарсан (shipped) захиалгыг цуцлахгүй, хүлээн авсны дараа буцаалтын журмаар шийднэ."],
    ["hours", "Цагийн хуваарь, холбоо барих", "Даваа-Баасан 09:00-20:00, Бямба-Ням 10:00-18:00. Утас: 7700-0000. Хаяг: УБ, СБД, Энхтайваны өргөн чөлөө 15."],
  ];

  const stmts = [
    ...customers.map((a) => ({ sql: "INSERT INTO customers (id,name,phone,email) VALUES (?,?,?,?)", args: a })),
    ...products.map((a) => ({ sql: "INSERT INTO products (id,name,category,price,stock,description) VALUES (?,?,?,?,?,?)", args: a })),
    ...orders.map((a) => ({ sql: "INSERT INTO orders (id,customer_id,status,total,delivery_address,created_at) VALUES (?,?,?,?,?,?)", args: a })),
    ...items.map((a) => ({ sql: "INSERT INTO order_items (order_id,product_id,quantity,unit_price) VALUES (?,?,?,?)", args: a })),
    ...policies.map((a) => ({ sql: "INSERT INTO policies (topic,title,content) VALUES (?,?,?)", args: a })),
  ];
  await db.batch(stmts, "write");
}
