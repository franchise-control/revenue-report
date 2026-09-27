/**
 * Публичный интерфейс пакета и границы, куда обычные сценарии не доходят.
 */

import { describe, expect, it } from 'vitest';

import * as api from '../src/index';
import { parseMoney } from '../src/money';
import { validateReport } from '../src/report';

describe('публичный интерфейс', () => {
  it('отдаёт всё, что обещает README', () => {
    for (const name of [
      'Period',
      'PeriodError',
      'plainDate',
      'nextDay',
      'daysInMonth',
      'parseMoney',
      'formatMoney',
      'MoneyParseError',
      'validateReport',
      'toVariables',
      'parseCsv',
      'parseCsvWithHeader',
      'detectDelimiter',
      'CsvError',
    ]) {
      expect(api, `нет экспорта ${name}`).toHaveProperty(name);
    }
  });

  it('пример из README проходит целиком', () => {
    const result = api.validateReport({
      outletId: 'MSK-014',
      period: 'сентябрь 2026',
      revenue: '1 480 000,00 ₽',
      metrics: { возвраты: '12 000,00' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(api.formatMoney(result.report.revenue)).toBe('1 480 000,00');
    expect(String(result.report.period)).toBe('сентябрь 2026');
    expect(api.toVariables(result.report)).toEqual({
      revenue: 148_000_000,
      units: 0,
      days: 30,
      возвраты: 1_200_000,
    });
  });
});

describe('границы разбора суммы', () => {
  it('целое без разделителей проходит напрямую', () => {
    expect(parseMoney('1234567')).toBe(123_456_700);
  });

  it('число за пределами точного диапазона отвергается', () => {
    expect(() => parseMoney(1e15)).toThrow(/слишком велика/);
  });

  it('у числа больше двух знаков после запятой — ошибка, а не округление', () => {
    expect(() => parseMoney(1234.567)).toThrow(/двух знаков/);
  });

  it('отрицательное число по умолчанию не проходит', () => {
    expect(() => parseMoney(-10)).toThrow(/отрицательная/);
    expect(parseMoney(-10, { allowNegative: true })).toBe(-1000);
  });
});

describe('границы проверки отчёта', () => {
  it('пара дат с плохой датой даёт ошибку поля, а не исключение', () => {
    const result = validateReport({
      outletId: '1',
      revenue: '100',
      period: { start: '2026-09-31', end: '2026-10-01' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]!.field).toBe('period');
    expect(result.issues[0]!.message).toContain('нет дня 31');
  });

  it('пустой период в паре дат — тоже ошибка поля', () => {
    const result = validateReport({
      outletId: '1',
      revenue: '100',
      period: { start: '2026-10-01', end: '2026-09-01' },
    });
    expect(result.ok).toBe(false);
  });

  it('числовой идентификатор точки принимается как строка', () => {
    const result = validateReport({ outletId: 14, period: '2026-09', revenue: '100' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.outletId).toBe('14');
  });

  it('идентификатор из одних пробелов — ошибка', () => {
    const result = validateReport({ outletId: '   ', period: '2026-09', revenue: '100' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]!.field).toBe('outletId');
  });

  it('null в периоде и выручке — ошибка, а не падение', () => {
    const result = validateReport({ outletId: '1', period: null, revenue: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(2);
  });

  it('null среди показателей — ошибка поля', () => {
    const result = validateReport({
      outletId: '1',
      period: '2026-09',
      revenue: '100',
      metrics: { возвраты: null },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]!.field).toBe('metrics.возвраты');
  });
});
