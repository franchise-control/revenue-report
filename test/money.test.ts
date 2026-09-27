import { describe, expect, it } from 'vitest';

import { MoneyParseError, formatMoney, parseMoney } from '../src/money';

describe('разбор суммы', () => {
  it.each([
    ['1234.56', 123_456],
    ['1234,56', 123_456],
    ['1 234 567,89', 123_456_789],
    ['1 234 567.89', 123_456_789],
    ['1234567,89 ₽', 123_456_789],
    ['1 234 567,89 руб.', 123_456_789],
    ['1 234 567,89 RUB', 123_456_789],
    ['1234567,89руб', 123_456_789],
    ['0', 0],
    ['0,00', 0],
    ['0,5', 50],
    ['0,05', 5],
    ['100', 10_000],
    ['100,', 10_000],
  ])('«%s» → %i копеек', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it('снимает неразрывные пробелы из 1С', () => {
    expect(parseMoney('1 234 567,89')).toBe(123_456_789);
    expect(parseMoney('1 234,50')).toBe(123_450);
  });

  it('принимает число', () => {
    expect(parseMoney(1234.56)).toBe(123_456);
    expect(parseMoney(0)).toBe(0);
    // 19.99 * 100 в double даёт 1998.9999999999998.
    expect(parseMoney(19.99)).toBe(1999);
  });

  it('читает бухгалтерские скобки как минус', () => {
    expect(parseMoney('(1 234,00)', { allowNegative: true })).toBe(-123_400);
    expect(() => parseMoney('(1 234,00)')).toThrow(/отрицательная/);
  });

  it('читает минус, в том числе типографский', () => {
    expect(parseMoney('-500,00', { allowNegative: true })).toBe(-50_000);
    expect(parseMoney('−500,00', { allowNegative: true })).toBe(-50_000);
    expect(parseMoney('+500,00')).toBe(50_000);
  });

  it('по умолчанию не пропускает отрицательную выручку', () => {
    expect(() => parseMoney('-1')).toThrow(MoneyParseError);
  });
});

describe('разделители', () => {
  it('при двух разных видах дробной частью считает тот, что правее', () => {
    expect(parseMoney('1.234,56')).toBe(123_456);
    expect(parseMoney('1,234.56')).toBe(123_456);
  });

  it('несколько одинаковых разделителей — это разряды', () => {
    expect(parseMoney('1.234.567')).toBe(123_456_700);
    expect(parseMoney('1,234,567')).toBe(123_456_700);
  });

  it('точка и три цифры после неё — разряды, запятая и три цифры — ошибка', () => {
    // «1.234» в выгрузках почти всегда тысяча двести тридцать четыре.
    expect(parseMoney('1.234')).toBe(123_400);
    // А «1,234» в российской записи — это 1 рубль 23,4 копейки, чего не бывает.
    expect(() => parseMoney('1,234')).toThrow(/двух знаков/);
  });

  it('точка и две цифры — копейки', () => {
    expect(parseMoney('1.23')).toBe(123);
  });

  it('ноль целых с тремя знаками — ошибка, а не разряды', () => {
    expect(() => parseMoney('0.123')).toThrow(/двух знаков/);
  });

  it('неоднозначную группировку отвергает', () => {
    expect(() => parseMoney('12.34.56')).toThrow(/однозначно/);
    expect(() => parseMoney('1234.5678')).toThrow(/двух знаков/);
  });
});

describe('плохие данные', () => {
  it.each([
    ['', 'не указана'],
    ['   ', 'не указана'],
    ['₽', 'не указана'],
    ['много', 'посторонние символы'],
    ['1 234 pуб', 'посторонние символы'],
    ['12e5', 'посторонние символы'],
  ])('«%s» — ошибка про %s', (input, expected) => {
    expect(() => parseMoney(input)).toThrow(MoneyParseError);
    expect(() => parseMoney(input)).toThrow(new RegExp(expected));
  });

  it('не принимает NaN и бесконечность', () => {
    expect(() => parseMoney(Number.NaN)).toThrow(MoneyParseError);
    expect(() => parseMoney(Number.POSITIVE_INFINITY)).toThrow(MoneyParseError);
  });

  it('не принимает сумму вне точного диапазона', () => {
    expect(() => parseMoney('999999999999999999')).toThrow(/слишком велика/);
  });

  it('кладёт исходную строку в ошибку — её показывают пользователю', () => {
    try {
      parseMoney('много');
      expect.unreachable('должно было упасть');
    } catch (error) {
      expect((error as MoneyParseError).source).toBe('много');
    }
  });
});

describe('вывод суммы', () => {
  it.each([
    [0, '0,00'],
    [5, '0,05'],
    [123_456, '1 234,56'],
    [123_456_789, '1 234 567,89'],
    [100_000, '1 000,00'],
  ])('%i копеек → «%s»', (value, expected) => {
    expect(formatMoney(value as never)).toBe(expected);
  });

  it('отрицательную печатает типографским минусом', () => {
    expect(formatMoney(-123_456 as never)).toBe('−1 234,56');
  });

  it('пережимает круг: разобрать напечатанное даёт то же число', () => {
    for (const value of [0, 1, 99, 100, 123_456, 999_999_999]) {
      expect(parseMoney(formatMoney(value as never))).toBe(value);
    }
  });
});
