import type { Metadata } from "next";
import { Manrope, Unbounded } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-manrope",
  display: "swap",
});

const unbounded = Unbounded({
  subsets: ["latin", "cyrillic"],
  variable: "--font-unbounded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ПроСервис — запись на услуги",
  description: "Учебный проект Boost Pro: онлайн-запись на услуги",
};

const navLink =
  "inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-muted transition hover:bg-brand-soft hover:text-brand";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className={`${manrope.variable} ${unbounded.variable}`}>
      <body className="min-h-screen">
        <header className="sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-2.5 sm:px-6">
            <a
              href="/"
              className="inline-flex min-h-11 items-center font-display text-lg font-bold tracking-tight text-ink"
            >
              Про<span className="text-brand">Сервис</span>
            </a>
            <nav className="flex items-center gap-1 text-sm">
              <a href="/book" className={navLink}>
                Записаться
              </a>
              <a href="/admin" className={navLink}>
                Админка
              </a>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>

        <footer className="mx-auto max-w-4xl px-4 pb-10 pt-6 text-xs text-muted sm:px-6">
          Учебный проект Boost Pro · ПроСервис
        </footer>
      </body>
    </html>
  );
}
