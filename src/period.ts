/**
 * Отчётный период.
 *
 * Период в отчёте франчайзи приходит строкой — «2026-09», «сентябрь 2026»,
 * «01.09.2026-30.09.2026» — и от того, как её разобрали, зависит, к какому
 * начислению отнесётся выручка. Здесь период всегда полуинтервал [начало,
 * конец): так соседние месяцы стыкуются без зазора и без нахлёста, и не надо
 * каждый раз решать, входит ли последний день.
 *
 * Дни — строки «ГГГГ-ММ-ДД», а не Date. Date несёт время и часовой пояс, а у
 * отчётного месяца ни того ни другого нет: «сентябрь» в Москве и в
 * Калининграде — один и тот же сентябрь.
 */

export class PeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PeriodError';
  }
}

/** Дата без времени: «2026-09-01». */
export type PlainDate = string & { readonly __brand: 'PlainDate' };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_NAMES = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
] as const;

/** Родительный падеж — для подписи «отчёт за сентябрь 2026». */
const MONTH_NAMES_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

/** День в диапазоне: «2026-09-01» или «01.09.2026». */
const DAY_PATTERN = String.raw`\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\.\d{1,2}\.\d{4}`;

const RANGE_PATTERN = new RegExp(
  String.raw`^(?:с\s+)?(${DAY_PATTERN})\s*(?:[—–]|--|-|по)\s*(${DAY_PATTERN})$`,
  'iu',
);

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) {
    throw new PeriodError(`Месяц вне диапазона 1–12: ${month}`);
  }
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function plainDate(text: string): PlainDate {
  const match = DATE_PATTERN.exec(text.trim());
  if (!match) {
    throw new PeriodError(`Дата должна быть в виде ГГГГ-ММ-ДД, получено «${text}»`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) {
    throw new PeriodError(`Месяц вне диапазона 1–12 в дате «${text}»`);
  }
  const limit = daysInMonth(year, month);
  if (day < 1 || day > limit) {
    // Именно так ловится «2026-02-30»: формат верный, дня не существует.
    throw new PeriodError(`В месяце ${month}.${year} нет дня ${day} (дата «${text}»)`);
  }
  return `${match[1]}-${match[2]}-${match[3]}` as PlainDate;
}

/** Следующий день. Нужен, чтобы из «по 30 сентября» получить границу периода. */
export function nextDay(date: PlainDate): PlainDate {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  if (day < daysInMonth(year, month)) {
    return `${year}-${pad(month)}-${pad(day + 1)}` as PlainDate;
  }
  if (month < 12) {
    return `${year}-${pad(month + 1)}-01` as PlainDate;
  }
  return `${year + 1}-01-01` as PlainDate;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Число дней от 1970-01-01. Только для сравнения и подсчёта длины. */
function toDayNumber(date: PlainDate): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * Отчётный период — полуинтервал [start, end).
 *
 * `end` — первый день, который в период уже не входит. Для сентября это
 * 1 октября.
 */
export class Period {
  readonly start: PlainDate;
  readonly end: PlainDate;

  private constructor(start: PlainDate, end: PlainDate) {
    this.start = start;
    this.end = end;
  }

  /** Из границ полуинтервала. */
  static of(start: string, end: string): Period {
    const from = plainDate(start);
    const to = plainDate(end);
    if (toDayNumber(to) <= toDayNumber(from)) {
      throw new PeriodError(
        `Период «${from} — ${to}» пуст: конец должен быть строго позже начала. ` +
          'Границы задаются полуинтервалом: конец в период не входит.',
      );
    }
    return new Period(from, to);
  }

  /** Из дат «с» и «по» включительно — как их пишут в отчёте. */
  static inclusive(first: string, last: string): Period {
    return Period.of(plainDate(first), nextDay(plainDate(last)));
  }

  /** Календарный месяц целиком. */
  static month(year: number, month: number): Period {
    if (!Number.isInteger(year) || year < 1970 || year > 2200) {
      throw new PeriodError(`Год вне разумного диапазона: ${year}`);
    }
    const last = daysInMonth(year, month);
    return Period.inclusive(`${year}-${pad(month)}-01`, `${year}-${pad(month)}-${pad(last)}`);
  }

  /**
   * Разбор строки периода.
   *
   * Принимает то, что реально приходит из отчётов:
   *   «2026-09», «09.2026», «сентябрь 2026», «Сентябрь 2026 г.»
   *   «2026-09-01 — 2026-09-30», «01.09.2026-30.09.2026»
   *
   * Диапазон трактуется как «с … по … включительно»: именно так его пишет
   * человек, и именно так его понимает бухгалтерия.
   */
  static parse(text: string): Period {
    const source = text.trim().replace(/\s+/g, ' ');
    if (source === '') {
      throw new PeriodError('Период не указан');
    }

    // Диапазон. Обе даты заданы явным образцом, а не «что угодно до тире»:
    // в «2026-09-01-2026-09-30» тире стоит и внутри самих дат, и от жадности
    // разбора зависит, где пройдёт граница.
    //
    // String.raw обязателен: в обычном шаблонном литерале `\s` JavaScript
    // превратит в букву «s» ещё до того, как строку увидит RegExp.
    const range = RANGE_PATTERN.exec(source);
    if (range) {
      return Period.inclusive(normalizeDay(range[1]!), normalizeDay(range[2]!));
    }

    // «2026-09»
    const isoMonth = /^(\d{4})-(\d{1,2})$/.exec(source);
    if (isoMonth) {
      return Period.month(Number(isoMonth[1]), Number(isoMonth[2]));
    }

    // «09.2026» и «09/2026»
    const dottedMonth = /^(\d{1,2})[./](\d{4})$/.exec(source);
    if (dottedMonth) {
      return Period.month(Number(dottedMonth[2]), Number(dottedMonth[1]));
    }

    // «сентябрь 2026», «Сентябрь 2026 г.»
    const named = /^([А-Яа-яЁё]+)\s+(\d{4})(?:\s*г\.?)?$/.exec(source);
    if (named) {
      const name = named[1]!.toLowerCase();
      const index = MONTH_NAMES.findIndex(
        (month, i) => month === name || MONTH_NAMES_GENITIVE[i] === name,
      );
      if (index === -1) {
        throw new PeriodError(`Не удалось распознать месяц «${named[1]}»`);
      }
      return Period.month(Number(named[2]), index + 1);
    }

    // Одиночная дата периодом не считается: за один день отчёт о выручке не
    // сдают, и почти всегда это обрезанный диапазон.
    throw new PeriodError(
      `Не удалось разобрать период «${text}». Ожидается «2026-09», «09.2026», ` +
        '«сентябрь 2026» или диапазон «01.09.2026 — 30.09.2026»',
    );
  }

  /** Длина периода в днях. */
  get days(): number {
    return toDayNumber(this.end) - toDayNumber(this.start);
  }

  /** Последний день, входящий в период, — для подписи «по 30 сентября». */
  get lastDay(): PlainDate {
    const [year, month, day] = this.end.split('-').map(Number) as [number, number, number];
    if (day > 1) return `${year}-${pad(month)}-${pad(day - 1)}` as PlainDate;
    if (month > 1) {
      const previous = month - 1;
      return `${year}-${pad(previous)}-${pad(daysInMonth(year, previous))}` as PlainDate;
    }
    return `${year - 1}-12-31` as PlainDate;
  }

  contains(date: string): boolean {
    const day = toDayNumber(plainDate(date));
    return day >= toDayNumber(this.start) && day < toDayNumber(this.end);
  }

  overlaps(other: Period): boolean {
    return (
      toDayNumber(this.start) < toDayNumber(other.end) &&
      toDayNumber(other.start) < toDayNumber(this.end)
    );
  }

  equals(other: Period): boolean {
    return this.start === other.start && this.end === other.end;
  }

  /** Совпадает ли период ровно с календарным месяцем. */
  isCalendarMonth(): boolean {
    const [year, month] = this.start.split('-').map(Number) as [number, number];
    return this.equals(Period.month(year, month));
  }

  /** Подпись для акта: «сентябрь 2026» или «с 5 по 20 сентября 2026». */
  toString(): string {
    const [year, month] = this.start.split('-').map(Number) as [number, number];
    if (this.isCalendarMonth()) {
      return `${MONTH_NAMES[month - 1]} ${year}`;
    }
    const [, , startDay] = this.start.split('-').map(Number) as [number, number, number];
    const [lastYear, lastMonth, lastDay] = this.lastDay.split('-').map(Number) as [
      number,
      number,
      number,
    ];
    if (year === lastYear && month === lastMonth) {
      return `с ${startDay} по ${lastDay} ${MONTH_NAMES_GENITIVE[month - 1]} ${year}`;
    }
    return (
      `с ${startDay} ${MONTH_NAMES_GENITIVE[month - 1]} ${year} ` +
      `по ${lastDay} ${MONTH_NAMES_GENITIVE[lastMonth - 1]} ${lastYear}`
    );
  }

  toJSON(): { start: string; end: string } {
    return { start: this.start, end: this.end };
  }
}

function normalizeDay(text: string): string {
  const trimmed = text.trim();
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (dotted) {
    return `${dotted[3]}-${pad(Number(dotted[2]))}-${pad(Number(dotted[1]))}`;
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) {
    return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
  }
  return trimmed;
}
