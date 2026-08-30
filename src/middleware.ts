import { NextRequest, NextResponse } from "next/server";

// Шлагбаум перед /api/*.
//
// У этих ручек два потребителя с разными правами:
//   • форма записи на сайте — ходит из браузера того же origin, ключа у неё быть не может
//     (любой ключ в клиентском коде виден всем, кто откроет исходники страницы);
//   • бот-администратор — внешний процесс, ему ключ и выдаём.
//
// Отсюда правило: запрос с самого сайта пропускаем, любой другой — только с ключом.
// Файлы самих ручек при этом не меняются.
//
// ⚠️ Это учебный шлагбаум, как и пароль админки. Заголовок Sec-Fetch-Site подделывается
// вручную, так что от целенаправленной атаки он не спасает — он закрывает ручки
// от случайного и автоматического доступа снаружи.

const PUBLIC_FETCH_SITES = new Set(["same-origin", "same-site"]);

export function middleware(req: NextRequest) {
  // Браузер сам проставляет этот заголовок и не даёт скриптам его подменить.
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && PUBLIC_FETCH_SITES.has(fetchSite)) {
    return NextResponse.next();
  }

  const expected = process.env.APP_API_KEY;
  if (!expected) {
    // Ключ не задан — снаружи не пускаем никого. Молча открыть доступ опаснее,
    // чем сломаться заметно: сайт продолжает работать, а внешний вызов получит 503.
    return NextResponse.json(
      { error: "APP_API_KEY не задан на сервере" },
      { status: 503 }
    );
  }

  if (req.headers.get("x-api-key") !== expected) {
    return NextResponse.json({ error: "Нужен заголовок x-api-key" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
