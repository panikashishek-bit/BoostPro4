/**
 * Русское склонение после числа: «1 обращение», «2 обращения», «5 обращений».
 *
 * Мелочь, но без неё пульт читается как машинный отчёт, а не как строка,
 * написанная человеком.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return many;
  switch (n % 10) {
    case 1:
      return one;
    case 2:
    case 3:
    case 4:
      return few;
    default:
      return many;
  }
}
