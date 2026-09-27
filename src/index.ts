/**
 * revenue-report — отчёт франчайзи о выручке: разбор, проверка, CSV.
 *
 * Парная библиотека к royalty-calc: та считает роялти, эта приводит к
 * пригодному виду то, из чего его считают.
 *
 * https://franchise-control.pro/upravlenie-franshizoy
 */

export {
  Period,
  PeriodError,
  plainDate,
  nextDay,
  daysInMonth,
  type PlainDate,
} from './period';

export {
  parseMoney,
  formatMoney,
  MoneyParseError,
  type Kopecks,
  type ParseMoneyOptions,
} from './money';

export {
  validateReport,
  toVariables,
  type RevenueReport,
  type ValidationIssue,
  type ValidationResult,
  type ValidateOptions,
} from './report';

export { parseCsv, parseCsvWithHeader, detectDelimiter, CsvError, type CsvOptions } from './csv';
