// Приведение телефона к единому виду.
//
// Клиенты диктуют и пишут номер как придётся: «911-70-201-20», «8 911 702 01 20»,
// «+7 (911) 702-01-20». В базу должен попадать один формат, по которому можно позвонить.

/** Номер в виде, пригодном для звонка и хранения: «+7 911 702-01-20». Null — распознать не удалось. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");

  // Десять цифр — код страны опущен, это самый частый случай: «911 702-01-20».
  // Одиннадцать — номер с 8 или 7 в начале. Российские мобильные начинаются с 9.
  let local: string | null = null;
  if (digits.length === 10) local = digits;
  else if (digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))) {
    local = digits.slice(1);
  }

  if (!local || !local.startsWith("9")) return null;

  return `+7 ${local.slice(0, 3)} ${local.slice(3, 6)}-${local.slice(6, 8)}-${local.slice(8, 10)}`;
}
