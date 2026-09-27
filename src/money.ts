/**
 * Разбор денежной суммы из того вида, в котором её присылают.
 *
 * Выручка в отчёте франчайзи приходит не числом. Она приходит так:
 *
 *   1 234 567,89 ₽      — из 1С, с неразрывными пробелами
 *   1 234 567.89        — из выгрузки, точкой
 *   1234567,89 руб.     — руками
 *   "1 234 567,89"      — из CSV, в кавычках
 *   1 234 567,89 RUB    — из банковской выписки
 *   (1 234,00)          — из бухгалтерской выгрузки: скобки значат минус
 *
 * Разбирать это регулярками по месту — значит в какой-то момент прочитать
 * «1.234,56» как тысячу с копейками или как одну целую двести тридцать четыре
 * тысячных. Здесь один разбор с явными правилами и явной ошибкой там, где
 * запись неоднозначна.
 *
 * Результат — целое число копеек: смысл тот же, что в royalty-calc, и суммы
 * между двумя библиотеками передаются без преобразований.
 */

export class MoneyParseError extends Error {
  /** Исходная строка — чтобы показать её пользователю рядом с ошибкой. */
  readonly source: string;

  constructor(message: string, source: string) {
    super(message);
    this.name = 'MoneyParseError';
    this.source = source;
  }
}

/** Сумма в копейках. Целое число, может быть отрицательным (возврат). */
export type Kopecks = number & { readonly __brand: 'Kopecks' };

/** Символы и слова, которые отбрасываем как обозначение валюты. */
const CURRENCY = /(₽|руб\.?|рублей|рубля|р\.|RUB|RUR)/giu;

/** Пробелы всех сортов, включая неразрывный и узкий неразрывный из 1С. */
const SPACES = /[\s   ]/gu;

export interface ParseMoneyOptions {
  /**
   * Разрешить отрицательную сумму.
   *
   * По умолчанию нет: выручка за период отрицательной не бывает, и минус в
   * этом поле почти всегда значит, что в колонку попали возвраты.
   */
  readonly allowNegative?: boolean;
}

/**
 * Строку или число — в копейки.
 *
 * @throws {MoneyParseError} если строку нельзя прочитать однозначно.
 */
export function parseMoney(input: string | number, options: ParseMoneyOptions = {}): Kopecks {
  const source = typeof input === 'number' ? String(input) : input;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new MoneyParseError(`Сумма не является числом: ${input}`, source);
    }
    return finish(Math.round(input * 100), input * 100, source, options);
  }

  let text = source.trim();
  if (text === '') {
    throw new MoneyParseError('Сумма не указана', source);
  }

  // Бухгалтерские скобки: (1 234,00) — это −1 234,00.
  let negative = false;
  const bracketed = /^\((.*)\)$/.exec(text);
  if (bracketed) {
    negative = true;
    text = bracketed[1]!.trim();
  }

  text = text.replace(CURRENCY, '').replace(SPACES, '');

  if (text.startsWith('-') || text.startsWith('−')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  if (text === '') {
    throw new MoneyParseError(`Сумма не указана: «${source}»`, source);
  }

  const digitsAndSeparators = /^[\d.,]+$/;
  if (!digitsAndSeparators.test(text)) {
    throw new MoneyParseError(
      `Сумма содержит посторонние символы: «${source}»`,
      source,
    );
  }

  const normalized = normalizeSeparators(text, source);
  const [whole, fraction = ''] = normalized.split('.') as [string, string?];

  if (fraction.length > 2) {
    throw new MoneyParseError(
      `В сумме «${source}» больше двух знаков после запятой — ` +
        'это не копейки, проверьте разделитель разрядов',
      source,
    );
  }

  const kopecks = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(kopecks)) {
    throw new MoneyParseError(`Сумма «${source}» слишком велика для точного расчёта`, source);
  }

  return finish(negative ? -kopecks : kopecks, negative ? -kopecks : kopecks, source, options);
}

function finish(
  value: number,
  exact: number,
  source: string,
  options: ParseMoneyOptions,
): Kopecks {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyParseError(`Сумма «${source}» слишком велика для точного расчёта`, source);
  }
  if (Math.abs(value - exact) > 1e-6) {
    throw new MoneyParseError(
      `В сумме «${source}» больше двух знаков после запятой`,
      source,
    );
  }
  if (value < 0 && options.allowNegative !== true) {
    throw new MoneyParseError(`Сумма «${source}» отрицательная`, source);
  }
  return value as Kopecks;
}

/**
 * Привести разделители к одной точке перед дробной частью.
 *
 * Правила, по порядку:
 *   1. Есть и точка, и запятая — разделитель дробной части тот, что правее.
 *   2. Один вид разделителя, и он встречается несколько раз — это разряды.
 *   3. Один разделитель, а после него ровно три цифры — неоднозначно
 *      («1.234» может быть и тысячей, и одной целой). Считаем разрядом
 *      только если группа полная и слева не больше трёх цифр; иначе это
 *      дробь. Отдельно ловим случай «1,234» с запятой: в российской записи
 *      запятая — дробная часть, и три знака после неё уже ошибка.
 */
function normalizeSeparators(text: string, source: string): string {
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalAt = Math.max(lastDot, lastComma);
    const groupChar = decimalAt === lastDot ? ',' : '.';
    const whole = text.slice(0, decimalAt).split(groupChar).join('');
    const fraction = text.slice(decimalAt + 1);
    if (whole.includes('.') || whole.includes(',') || fraction.includes('.') || fraction.includes(',')) {
      throw new MoneyParseError(`Сумму «${source}» нельзя прочитать однозначно`, source);
    }
    return `${whole}.${fraction}`;
  }

  const separator = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null;
  if (separator === null) {
    return text;
  }

  const parts = text.split(separator);
  if (parts.length > 2) {
    // «1.234.567» — только разряды.
    if (parts.slice(1).every((part) => part.length === 3) && parts[0]!.length <= 3) {
      return parts.join('');
    }
    throw new MoneyParseError(`Сумму «${source}» нельзя прочитать однозначно`, source);
  }

  const [whole, fraction] = parts as [string, string];
  if (fraction.length === 3 && separator === '.' && whole.length <= 3 && whole !== '0') {
    // «1.234» — тысяча двести тридцать четыре. С запятой так не делаем:
    // в российской записи запятая отделяет копейки.
    return whole + fraction;
  }
  return `${whole}.${fraction}`;
}

/** Копейки — в строку для показа: «1 234 567,89». */
export function formatMoney(value: Kopecks): string {
  const negative = value < 0;
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute - whole * 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negative ? '−' : ''}${grouped},${String(fraction).padStart(2, '0')}`;
}
