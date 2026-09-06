// Случайность с фиксированным зерном.
//
// Math.random здесь не годится по одной практической причине: если два прогона
// дают разную историю, то и сверить их нельзя. С зерном «дорисовал → стёр →
// дорисовал заново» даёт ТУ ЖЕ историю, и любое расхождение на пульте означает
// ошибку в коде, а не другой бросок кубика.
//
// Алгоритм — mulberry32: тридцать строк, никаких зависимостей, распределение
// для наших целей ровное. Криптостойкость тут не нужна и не заявляется.

export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Дробное [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Целое от min до max ВКЛЮЧИТЕЛЬНО. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Случайный элемент списка. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** true с заданной вероятностью: chance(0.74) — примерно в трёх случаях из четырёх. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /**
   * Выбор с весами: [["Маникюр", 28], ["Педикюр", 16]] — первое встретится
   * почти вдвое чаще. Веса не обязаны давать в сумме сто.
   */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((sum, [, weight]) => sum + weight, 0);
    let point = this.next() * total;
    for (const [value, weight] of items) {
      point -= weight;
      if (point <= 0) return value;
    }
    return items[items.length - 1][0];
  }
}
