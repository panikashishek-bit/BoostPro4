/**
 * Дата-время в виде «ГГГГ-ММ-ДД ЧЧ:ММ:СС».
 *
 * Формат — договор между тремя местами, и поэтому он здесь один на всех:
 * Google Sheets понимает его как дату, человек читает без расшифровки, а пульт
 * сортирует колонку `ts` как обычный текст. Разъедься реализации — сломалось бы
 * молча и не там, где правили.
 */
export function moment(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
