# ТехМаркет туслах

Mastra + Gemini ашигласан agentic AI туршилтын төсөл. Зохиомол электроникийн дэлгүүрийн хэрэглэгчид үйлчлэх агент: бараа хайх, захиалга шалгах, цуцлах, тасалбар үүсгэх, журам тайлбарлах.

Сайт: https://mastra-support-agent.vercel.app

## Бүтэц

- `src/lib/db.ts` — дэлгүүрийн SQLite өгөгдлийн сан, жишээ өгөгдөл
- `src/mastra/tools/shop-tools.ts` — агентын 6 tool
- `src/mastra/agents/support-agent.ts` — агентын тодорхойлолт
- `src/app/api/chat/route.ts` — чатын API, агентын алхам бүрийн цаг болон токеныг урсгалд нэмдэг
- `src/app/page.tsx` — чатын хуудас
- `src/app/agent-panel.tsx` — агентын ажиллагааг бодит цагт харуулах самбар

## Ажиллуулах

```bash
npm install
cp .env.example .env.local   # GOOGLE_GENERATIVE_AI_API_KEY-г бөглөнө
npm run dev
```

Түлхүүрийг https://aistudio.google.com/apikey -аас авна. Загварыг `GEMINI_MODEL` хувьсагчаар сольж болно (жишээ нь `google/gemini-3.5-flash-lite`).

## Анхаарах зүйл

Vercel дээр SQLite файл `/tmp`-д байрладаг тул өгөгдөл түр зуурынх: сервер дахин асахад анхны төлөвтөө орно.
