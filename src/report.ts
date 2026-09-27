/**
 * Отчёт франчайзи о выручке и его проверка.
 *
 * Проверка возвращает список всех ошибок сразу, а не падает на первой.
 * Франчайзи заполняет отчёт раз в месяц, и переписка «а теперь исправьте
 * следующее поле» растягивает закрытие периода на неделю.
 */

import { MoneyParseError, parseMoney, type Kopecks } from './money';
import { Period, PeriodError } from './period';

/** Проверенный отчёт. */
export interface RevenueReport {
  /** Идентификатор точки в учёте сети. */
  readonly outletId: string;
  readonly period: Period;
  /** Выручка за период, в копейках. */
  readonly revenue: Kopecks;
  /** Объём для схем «ставка за единицу»: заказы, тонны, метры. */
  readonly units?: number;
  /**
   * Дополнительные числовые показатели отчёта: возвраты, скидки, себестоимость.
   * Ключ — как его назвала сеть, значение — в копейках или в штуках.
   */
  readonly metrics: Readonly<Record<string, number>>;
  /** Комментарий франчайзи к отчёту. */
  readonly comment?: string;
}

/** Одна ошибка проверки. */
export interface ValidationIssue {
  /** Путь к полю: `revenue`, `metrics.возвраты`. */
  readonly field: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly report: RevenueReport }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface ValidateOptions {
  /**
   * Имена показателей, которые обязаны быть в отчёте.
   *
   * Сеть задаёт их по своей форме: если роялти считается по формуле
   * `(revenue - returns) * 0.05`, то без `returns` отчёт бесполезен, и узнать
   * об этом надо при сдаче, а не при закрытии периода.
   */
  readonly requiredMetrics?: readonly string[];
  /** Разрешить отрицательные значения показателей. Выручки не касается. */
  readonly allowNegativeMetrics?: boolean;
}

type RawValue = unknown;

/**
 * Проверить и привести сырой отчёт — из формы, JSON или строки CSV.
 *
 * Суммы принимаются в любом виде, который понимает `parseMoney`: «1 234,56»,
 * «1234.56 ₽», число.
 */
export function validateReport(
  raw: Readonly<Record<string, RawValue>>,
  options: ValidateOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];

  const outletId = readString(raw['outletId'] ?? raw['outlet'] ?? raw['точка'], 'outletId', issues);

  let period: Period | undefined;
  const rawPeriod = raw['period'] ?? raw['период'];
  if (rawPeriod === undefined || rawPeriod === null || rawPeriod === '') {
    issues.push({ field: 'period', message: 'Период не указан' });
  } else if (rawPeriod instanceof Period) {
    period = rawPeriod;
  } else if (typeof rawPeriod === 'string') {
    try {
      period = Period.parse(rawPeriod);
    } catch (error) {
      issues.push({
        field: 'period',
        message: error instanceof PeriodError ? error.message : String(error),
      });
    }
  } else if (isPeriodObject(rawPeriod)) {
    try {
      period = Period.of(rawPeriod.start, rawPeriod.end);
    } catch (error) {
      issues.push({
        field: 'period',
        message: error instanceof PeriodError ? error.message : String(error),
      });
    }
  } else {
    issues.push({ field: 'period', message: 'Период должен быть строкой или парой дат' });
  }

  let revenue: Kopecks | undefined;
  const rawRevenue = raw['revenue'] ?? raw['выручка'];
  if (rawRevenue === undefined || rawRevenue === null || rawRevenue === '') {
    issues.push({ field: 'revenue', message: 'Выручка не указана' });
  } else if (typeof rawRevenue === 'string' || typeof rawRevenue === 'number') {
    try {
      revenue = parseMoney(rawRevenue);
    } catch (error) {
      issues.push({
        field: 'revenue',
        message: error instanceof MoneyParseError ? error.message : String(error),
      });
    }
  } else {
    issues.push({ field: 'revenue', message: 'Выручка должна быть числом или строкой' });
  }

  let units: number | undefined;
  const rawUnits = raw['units'] ?? raw['объём'] ?? raw['объем'];
  if (rawUnits !== undefined && rawUnits !== null && rawUnits !== '') {
    const parsed = typeof rawUnits === 'number' ? rawUnits : Number(String(rawUnits).trim());
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
      issues.push({
        field: 'units',
        message: `Объём должен быть целым неотрицательным числом, получено «${String(rawUnits)}»`,
      });
    } else {
      units = parsed;
    }
  }

  const metrics: Record<string, number> = {};
  const rawMetrics = raw['metrics'] ?? raw['показатели'];
  if (rawMetrics !== undefined && rawMetrics !== null) {
    if (typeof rawMetrics !== 'object' || Array.isArray(rawMetrics)) {
      issues.push({ field: 'metrics', message: 'Показатели должны быть объектом «имя: значение»' });
    } else {
      for (const [name, value] of Object.entries(rawMetrics as Record<string, RawValue>)) {
        const field = `metrics.${name}`;
        if (value === undefined || value === null || value === '') {
          issues.push({ field, message: 'Показатель не заполнен' });
          continue;
        }
        if (typeof value !== 'string' && typeof value !== 'number') {
          issues.push({ field, message: 'Показатель должен быть числом или строкой' });
          continue;
        }
        try {
          metrics[name] = parseMoney(value, { allowNegative: options.allowNegativeMetrics === true });
        } catch (error) {
          issues.push({
            field,
            message: error instanceof MoneyParseError ? error.message : String(error),
          });
        }
      }
    }
  }

  for (const required of options.requiredMetrics ?? []) {
    if (!Object.prototype.hasOwnProperty.call(metrics, required)) {
      issues.push({
        field: `metrics.${required}`,
        message: `Показатель «${required}» обязателен по форме отчёта сети`,
      });
    }
  }

  const comment = raw['comment'] ?? raw['комментарий'];
  if (comment !== undefined && comment !== null && typeof comment !== 'string') {
    issues.push({ field: 'comment', message: 'Комментарий должен быть строкой' });
  }

  if (issues.length > 0 || outletId === undefined || period === undefined || revenue === undefined) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    report: {
      outletId,
      period,
      revenue,
      ...(units === undefined ? {} : { units }),
      metrics,
      ...(typeof comment === 'string' && comment !== '' ? { comment } : {}),
    },
  };
}

function readString(
  value: RawValue,
  field: string,
  issues: ValidationIssue[],
): string | undefined {
  if (value === undefined || value === null || value === '') {
    issues.push({ field, message: 'Не указана точка, по которой сдан отчёт' });
    return undefined;
  }
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') {
    issues.push({ field, message: 'Идентификатор точки должен быть строкой' });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    issues.push({ field, message: 'Не указана точка, по которой сдан отчёт' });
    return undefined;
  }
  return trimmed;
}

function isPeriodObject(value: unknown): value is { start: string; end: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { start?: unknown }).start === 'string' &&
    typeof (value as { end?: unknown }).end === 'string'
  );
}

/**
 * Переменные для схемы «формула» из royalty-calc.
 *
 * Отдельная функция, а не поле отчёта: так две библиотеки стыкуются одной
 * строкой и не знают друг о друге ничего лишнего.
 *
 * ```ts
 * calculateRoyalty(scheme, { revenue: report.revenue, variables: toVariables(report) });
 * ```
 */
export function toVariables(report: RevenueReport): Record<string, number> {
  return {
    revenue: report.revenue,
    units: report.units ?? 0,
    days: report.period.days,
    ...report.metrics,
  };
}
