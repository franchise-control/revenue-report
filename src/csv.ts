/**
 * Разбор CSV-выгрузки отчётов.
 *
 * Выручку по сети присылают выгрузкой из Excel, и на пути до неё стоят четыре
 * грабли, каждую из которых видно только на боевых данных:
 *
 *   1. BOM в начале файла. Без его снятия первый заголовок становится
 *      «﻿точка» и не находится по имени.
 *   2. Разделитель. Excel с русской локалью пишет точку с запятой, потому что
 *      запятая занята под копейки. Определяем по первой строке.
 *   3. Кавычки. Поле в кавычках может содержать разделитель и перевод строки;
 *      удвоенная кавычка внутри — это одна кавычка.
 *   4. Кодировка. Windows-1251 сюда попасть не должна — файл читается как
 *      текст выше по стеку, — но если попала, это видно по «?» в заголовках,
 *      и лучше сказать об этом прямо.
 *
 * Разбор сознательно не зависит от заголовков: их сопоставление с полями
 * отчёта — дело вызывающего кода, у каждой сети своя форма.
 */

export class CsvError extends Error {
  /** Номер строки в файле, с единицы. */
  readonly line: number;

  constructor(message: string, line: number) {
    super(`Строка ${line}: ${message}`);
    this.name = 'CsvError';
    this.line = line;
  }
}

export interface CsvOptions {
  /** Разделитель. По умолчанию определяется по первой строке. */
  readonly delimiter?: string;
}

/** Разбор в массив строк-массивов. Заголовок не выделяется. */
export function parseCsv(source: string, options: CsvOptions = {}): string[][] {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (text.trim() === '') return [];

  const delimiter = options.delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let fieldStartedAtLine = 1;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.trim() !== '') {
        throw new CsvError('Кавычка в середине поля', line);
      }
      field = '';
      quoted = true;
      fieldStartedAtLine = line;
      continue;
    }

    if (char === delimiter) {
      row.push(field.trim());
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field.trim());
      field = '';
      // Полностью пустые строки пропускаем: в конце выгрузки их обычно
      // несколько, и превращать их в отчёты с пустыми полями незачем.
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      line += 1;
      continue;
    }

    field += char;
  }

  if (quoted) {
    throw new CsvError('Не закрыта кавычка', fieldStartedAtLine);
  }
  row.push(field.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);

  return rows;
}

/**
 * Разбор с заголовком: массив объектов «заголовок → значение».
 *
 * Заголовки приводятся к нижнему регистру и обрезаются: «Точка », «точка» и
 * «ТОЧКА» — один и тот же столбец.
 */
export function parseCsvWithHeader(
  source: string,
  options: CsvOptions = {},
): Record<string, string>[] {
  const rows = parseCsv(source, options);
  if (rows.length === 0) return [];

  const header = rows[0]!.map((cell) => cell.trim().toLowerCase());

  const seen = new Set<string>();
  for (const name of header) {
    if (name === '') {
      throw new CsvError('Пустой заголовок столбца', 1);
    }
    if (seen.has(name)) {
      throw new CsvError(`Столбец «${name}» встречается дважды`, 1);
    }
    seen.add(name);
  }

  return rows.slice(1).map((row, index) => {
    if (row.length !== header.length) {
      throw new CsvError(
        `Столбцов ${row.length}, а в заголовке ${header.length}`,
        index + 2,
      );
    }
    const record: Record<string, string> = {};
    header.forEach((name, i) => {
      record[name] = row[i]!;
    });
    return record;
  });
}

/**
 * Определить разделитель по первой строке.
 *
 * Считаем кандидатов вне кавычек и берём самого частого. При равенстве —
 * точка с запятой: русский Excel пишет именно её, а запятая в строке чаще
 * всего разделяет копейки.
 */
export function detectDelimiter(text: string): string {
  const firstLine = takeFirstLineOutsideQuotes(text);
  const counts = new Map<string, number>([
    [';', 0],
    [',', 0],
    ['\t', 0],
  ]);

  let quoted = false;
  for (let i = 0; i < firstLine.length; i += 1) {
    const char = firstLine[i]!;
    if (char === '"') {
      if (quoted && firstLine[i + 1] === '"') {
        i += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (!quoted && counts.has(char)) {
      counts.set(char, counts.get(char)! + 1);
    }
  }

  let best = ';';
  let bestCount = 0;
  for (const candidate of [';', '\t', ',']) {
    const count = counts.get(candidate)!;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function takeFirstLineOutsideQuotes(text: string): string {
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        i += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (char === '\n' && !quoted) {
      return text.slice(0, i);
    }
  }
  return text;
}
