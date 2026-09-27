import { describe, expect, it } from 'vitest';

import { Period, PeriodError, daysInMonth, nextDay, plainDate } from '../src/period';

describe('дата', () => {
  it('принимает ГГГГ-ММ-ДД', () => {
    expect(plainDate('2026-09-01')).toBe('2026-09-01');
    expect(plainDate('  2026-09-01  ')).toBe('2026-09-01');
  });

  it.each(['01.09.2026', '2026-9-1', '2026/09/01', 'вчера', ''])(
    'отвергает «%s»',
    (input) => {
      expect(() => plainDate(input)).toThrow(PeriodError);
    },
  );

  it('отвергает несуществующий день', () => {
    expect(() => plainDate('2026-02-30')).toThrow(/нет дня 30/);
    expect(() => plainDate('2026-04-31')).toThrow(/нет дня 31/);
    expect(() => plainDate('2026-13-01')).toThrow(/Месяц вне диапазона/);
  });

  it('знает про високосный год', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(plainDate('2024-02-29')).toBe('2024-02-29');
    expect(() => plainDate('2026-02-29')).toThrow(PeriodError);
  });

  it('отвергает месяц вне диапазона в daysInMonth', () => {
    expect(() => daysInMonth(2026, 0)).toThrow(PeriodError);
    expect(() => daysInMonth(2026, 13)).toThrow(PeriodError);
  });

  it('считает следующий день через границы месяца и года', () => {
    expect(nextDay(plainDate('2026-09-01'))).toBe('2026-09-02');
    expect(nextDay(plainDate('2026-09-30'))).toBe('2026-10-01');
    expect(nextDay(plainDate('2026-12-31'))).toBe('2027-01-01');
    expect(nextDay(plainDate('2024-02-28'))).toBe('2024-02-29');
    expect(nextDay(plainDate('2026-02-28'))).toBe('2026-03-01');
  });
});

describe('построение периода', () => {
  it('календарный месяц — полуинтервал до первого числа следующего', () => {
    const september = Period.month(2026, 9);
    expect(september.start).toBe('2026-09-01');
    expect(september.end).toBe('2026-10-01');
    expect(september.days).toBe(30);
    expect(september.lastDay).toBe('2026-09-30');
  });

  it('декабрь заканчивается январём следующего года', () => {
    const december = Period.month(2026, 12);
    expect(december.end).toBe('2027-01-01');
    expect(december.lastDay).toBe('2026-12-31');
  });

  it('февраль високосного года длиннее', () => {
    expect(Period.month(2024, 2).days).toBe(29);
    expect(Period.month(2026, 2).days).toBe(28);
  });

  it('«с ... по ...» включает последний день', () => {
    const period = Period.inclusive('2026-09-05', '2026-09-20');
    expect(period.end).toBe('2026-09-21');
    expect(period.days).toBe(16);
  });

  it('соседние месяцы стыкуются без зазора и нахлёста', () => {
    const september = Period.month(2026, 9);
    const october = Period.month(2026, 10);
    expect(september.end).toBe(october.start);
    expect(september.overlaps(october)).toBe(false);
  });

  it('пустой период — ошибка', () => {
    expect(() => Period.of('2026-09-10', '2026-09-10')).toThrow(/пуст/);
    expect(() => Period.of('2026-09-10', '2026-09-01')).toThrow(/пуст/);
  });

  it('год вне разумного диапазона — ошибка', () => {
    expect(() => Period.month(1800, 1)).toThrow(/Год вне/);
    expect(() => Period.month(2.5, 1)).toThrow(/Год вне/);
  });
});

describe('разбор строки периода', () => {
  it.each([
    ['2026-09', '2026-09-01', '2026-10-01'],
    ['2026-9', '2026-09-01', '2026-10-01'],
    ['09.2026', '2026-09-01', '2026-10-01'],
    ['9/2026', '2026-09-01', '2026-10-01'],
    ['сентябрь 2026', '2026-09-01', '2026-10-01'],
    ['Сентябрь 2026', '2026-09-01', '2026-10-01'],
    ['сентября 2026', '2026-09-01', '2026-10-01'],
    ['сентябрь 2026 г.', '2026-09-01', '2026-10-01'],
    ['январь 2026', '2026-01-01', '2026-02-01'],
    ['декабрь 2026', '2026-12-01', '2027-01-01'],
  ])('«%s» → [%s, %s)', (input, start, end) => {
    const period = Period.parse(input);
    expect(period.start).toBe(start);
    expect(period.end).toBe(end);
  });

  it.each([
    '2026-09-01 — 2026-09-30',
    '2026-09-01-2026-09-30',
    '01.09.2026 - 30.09.2026',
    '01.09.2026–30.09.2026',
    '1.9.2026 — 30.9.2026',
  ])('разбирает диапазон «%s» включительно', (input) => {
    const period = Period.parse(input);
    expect(period.start).toBe('2026-09-01');
    expect(period.end).toBe('2026-10-01');
    expect(period.days).toBe(30);
  });

  it.each([
    ['', 'не указан'],
    ['   ', 'не указан'],
    ['третий квартал', 'Не удалось разобрать'],
    ['2026-09-15', 'Не удалось разобрать'],
    ['сентябрик 2026', 'распознать месяц'],
  ])('отвергает «%s»', (input, expected) => {
    expect(() => Period.parse(input)).toThrow(PeriodError);
    expect(() => Period.parse(input)).toThrow(new RegExp(expected));
  });
});

describe('свойства периода', () => {
  const september = Period.month(2026, 9);

  it('знает, входит ли дата', () => {
    expect(september.contains('2026-09-01')).toBe(true);
    expect(september.contains('2026-09-30')).toBe(true);
    // Конец полуинтервала уже не входит — иначе 1 октября попало бы в оба месяца.
    expect(september.contains('2026-10-01')).toBe(false);
    expect(september.contains('2026-08-31')).toBe(false);
  });

  it('знает про пересечение', () => {
    expect(september.overlaps(Period.inclusive('2026-09-25', '2026-10-05'))).toBe(true);
    expect(september.overlaps(Period.month(2026, 10))).toBe(false);
    expect(september.overlaps(Period.month(2026, 8))).toBe(false);
    expect(september.overlaps(september)).toBe(true);
  });

  it('узнаёт календарный месяц', () => {
    expect(september.isCalendarMonth()).toBe(true);
    expect(Period.inclusive('2026-09-01', '2026-09-29').isCalendarMonth()).toBe(false);
    expect(Period.inclusive('2026-09-02', '2026-09-30').isCalendarMonth()).toBe(false);
  });

  it('сравнивается', () => {
    expect(september.equals(Period.parse('сентябрь 2026'))).toBe(true);
    expect(september.equals(Period.month(2026, 10))).toBe(false);
  });

  it('подписывается по-человечески', () => {
    expect(String(september)).toBe('сентябрь 2026');
    expect(String(Period.inclusive('2026-09-05', '2026-09-20'))).toBe(
      'с 5 по 20 сентября 2026',
    );
    expect(String(Period.inclusive('2026-09-25', '2026-10-05'))).toBe(
      'с 25 сентября 2026 по 5 октября 2026',
    );
  });

  it('сериализуется в пару дат', () => {
    expect(JSON.parse(JSON.stringify(september))).toEqual({
      start: '2026-09-01',
      end: '2026-10-01',
    });
  });
});
