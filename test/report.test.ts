import { describe, expect, it } from 'vitest';

import { Period } from '../src/period';
import { toVariables, validateReport } from '../src/report';
import { CsvError, detectDelimiter, parseCsv, parseCsvWithHeader } from '../src/csv';

const valid = {
  outletId: 'MSK-014',
  period: 'сентябрь 2026',
  revenue: '1 480 000,00 ₽',
};

function expectOk(result: ReturnType<typeof validateReport>) {
  if (!result.ok) {
    throw new Error(`ожидался корректный отчёт, а пришли ошибки: ${JSON.stringify(result.issues)}`);
  }
  return result.report;
}

describe('проверка отчёта', () => {
  it('принимает заполненный отчёт', () => {
    const report = expectOk(validateReport(valid));
    expect(report.outletId).toBe('MSK-014');
    expect(report.revenue).toBe(148_000_000);
    expect(report.period.equals(Period.month(2026, 9))).toBe(true);
    expect(report.metrics).toEqual({});
  });

  it('принимает русские имена полей', () => {
    const report = expectOk(
      validateReport({ точка: '12', период: '2026-09', выручка: '100000' }),
    );
    expect(report.outletId).toBe('12');
    expect(report.revenue).toBe(10_000_000);
  });

  it('принимает готовый Period и пару дат', () => {
    expect(expectOk(validateReport({ ...valid, period: Period.month(2026, 9) })).period.start).toBe(
      '2026-09-01',
    );
    expect(
      expectOk(validateReport({ ...valid, period: { start: '2026-09-01', end: '2026-10-01' } }))
        .period.days,
    ).toBe(30);
  });

  it('собирает все ошибки сразу, а не падает на первой', () => {
    const result = validateReport({ outletId: '', period: 'квартал', revenue: 'много' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.field).sort()).toEqual(['outletId', 'period', 'revenue']);
  });

  it('указывает поле в каждой ошибке', () => {
    const result = validateReport({ ...valid, metrics: { возвраты: 'много' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]!.field).toBe('metrics.возвраты');
  });

  it('требует показатели из формы сети', () => {
    const result = validateReport(valid, { requiredMetrics: ['возвраты'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]!.message).toContain('обязателен по форме отчёта сети');
  });

  it('проходит, когда обязательный показатель заполнен', () => {
    const report = expectOk(
      validateReport({ ...valid, metrics: { возвраты: '12 000,00' } }, {
        requiredMetrics: ['возвраты'],
      }),
    );
    expect(report.metrics['возвраты']).toBe(1_200_000);
  });

  it('отрицательный показатель пропускает только по просьбе', () => {
    expect(validateReport({ ...valid, metrics: { корректировка: '-500' } }).ok).toBe(false);
    expect(
      validateReport({ ...valid, metrics: { корректировка: '-500' } }, {
        allowNegativeMetrics: true,
      }).ok,
    ).toBe(true);
  });

  it('проверяет объём', () => {
    expect(expectOk(validateReport({ ...valid, units: 400 })).units).toBe(400);
    expect(expectOk(validateReport({ ...valid, units: '400' })).units).toBe(400);
    expect(expectOk(validateReport({ ...valid, units: '' })).units).toBeUndefined();

    for (const bad of [1.5, -1, 'много']) {
      const result = validateReport({ ...valid, units: bad });
      expect(result.ok, `объём ${String(bad)} не должен проходить`).toBe(false);
    }
  });

  it('проверяет типы полей', () => {
    expect(validateReport({ ...valid, period: 42 }).ok).toBe(false);
    expect(validateReport({ ...valid, revenue: {} }).ok).toBe(false);
    expect(validateReport({ ...valid, outletId: {} }).ok).toBe(false);
    expect(validateReport({ ...valid, metrics: [] }).ok).toBe(false);
    expect(validateReport({ ...valid, metrics: { x: {} } }).ok).toBe(false);
    expect(validateReport({ ...valid, metrics: { x: '' } }).ok).toBe(false);
    expect(validateReport({ ...valid, comment: 42 }).ok).toBe(false);
  });

  it('пустой отчёт даёт три ошибки, а не исключение', () => {
    const result = validateReport({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(3);
  });

  it('оставляет комментарий, если он есть', () => {
    expect(expectOk(validateReport({ ...valid, comment: 'закрывались на ремонт' })).comment).toBe(
      'закрывались на ремонт',
    );
    expect(expectOk(validateReport({ ...valid, comment: '' })).comment).toBeUndefined();
  });
});

describe('переменные для формулы роялти', () => {
  it('отдаёт выручку, объём, длину периода и показатели', () => {
    const report = expectOk(
      validateReport({ ...valid, units: 12, metrics: { возвраты: '1 000,00' } }),
    );
    expect(toVariables(report)).toEqual({
      revenue: 148_000_000,
      units: 12,
      days: 30,
      возвраты: 100_000,
    });
  });

  it('без объёма подставляет ноль', () => {
    expect(toVariables(expectOk(validateReport(valid))).units).toBe(0);
  });
});

describe('CSV', () => {
  it('определяет разделитель', () => {
    expect(detectDelimiter('a;b;c')).toBe(';');
    expect(detectDelimiter('a,b,c')).toBe(',');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    // Русский Excel пишет точку с запятой, потому что запятая занята копейками.
    expect(detectDelimiter('точка;выручка\nMSK-1;"1 000,00"')).toBe(';');
    // Разделители внутри кавычек не считаются.
    expect(detectDelimiter('"a;b";c')).toBe(';');
  });

  it('снимает BOM, иначе первый заголовок не находится по имени', () => {
    const rows = parseCsvWithHeader('﻿точка;выручка\nMSK-1;1000');
    expect(Object.keys(rows[0]!)).toEqual(['точка', 'выручка']);
  });

  it('понимает перевод строки в любом виде', () => {
    expect(parseCsv('a;b\r\nc;d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCsv('a;b\rc;d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('разбирает кавычки, включая разделитель и перевод строки внутри', () => {
    expect(parseCsv('"1;2";3')).toEqual([['1;2', '3']]);
    expect(parseCsv('"строка\nвторая";3')).toEqual([['строка\nвторая', '3']]);
    expect(parseCsv('"он сказал ""да""";3')).toEqual([['он сказал "да"', '3']]);
  });

  it('пропускает пустые строки в конце выгрузки', () => {
    expect(parseCsv('a;b\n\n\nc;d\n\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCsv('   ')).toEqual([]);
  });

  it('сообщает о незакрытой кавычке с номером строки', () => {
    expect(() => parseCsv('a;"b\nc;d')).toThrow(CsvError);
    expect(() => parseCsv('a;b\nc;"d')).toThrow(/Строка 2/);
  });

  it('не принимает кавычку в середине поля', () => {
    expect(() => parseCsv('ab"c";d')).toThrow(/Кавычка в середине/);
  });

  it('сверяет число столбцов с заголовком', () => {
    expect(() => parseCsvWithHeader('a;b\n1;2;3')).toThrow(/Столбцов 3, а в заголовке 2/);
    expect(() => parseCsvWithHeader('a;b\n1;2;3')).toThrow(/Строка 2/);
  });

  it('не принимает пустой и повторяющийся заголовок', () => {
    expect(() => parseCsvWithHeader('a;;c\n1;2;3')).toThrow(/Пустой заголовок/);
    expect(() => parseCsvWithHeader('a;A\n1;2')).toThrow(/встречается дважды/);
  });

  it('приводит заголовки к нижнему регистру и обрезает пробелы', () => {
    const rows = parseCsvWithHeader(' Точка ; Выручка \nMSK-1;1000');
    expect(rows[0]).toEqual({ точка: 'MSK-1', выручка: '1000' });
  });

  it('пустой файл даёт пустой список', () => {
    expect(parseCsvWithHeader('')).toEqual([]);
  });

  it('выгрузка целиком превращается в отчёты', () => {
    const csv = [
      'точка;период;выручка;возвраты',
      'MSK-014;сентябрь 2026;"1 480 000,00";"12 000,00"',
      'MSK-021;сентябрь 2026;"980 500,50";"0,00"',
    ].join('\n');

    const reports = parseCsvWithHeader(csv).map((row) =>
      validateReport(
        {
          outletId: row['точка'],
          period: row['период'],
          revenue: row['выручка'],
          metrics: { возвраты: row['возвраты'] },
        },
        { requiredMetrics: ['возвраты'] },
      ),
    );

    expect(reports.every((r) => r.ok)).toBe(true);
    expect(expectOk(reports[0]!).revenue).toBe(148_000_000);
    expect(expectOk(reports[1]!).revenue).toBe(98_050_050);
    expect(expectOk(reports[1]!).metrics['возвраты']).toBe(0);
  });
});
