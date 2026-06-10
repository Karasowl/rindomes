import ExcelJS from "exceljs";
import type { Category, CurrencyCode, GroupKey, NetWorthItem, Transaction, TransactionType } from "./types";

const budgetColumnStarts = [1, 5, 9, 13, 17, 21];
const monthColumnStarts = [1, 6, 11, 16, 21, 26];

const monthNames = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const groupBySheetLabel: Record<string, GroupKey> = {
  ingresos: "income",
  "gastos esenciales": "essentials",
  "gastos discrecionales": "discretionary",
  "pago de deudas": "debt",
  ahorros: "savings",
  inversiones: "investments",
};

interface ImportedLine {
  group: GroupKey;
  name: string;
  plannedCents: number;
}

export interface ImportedWorkbook {
  activeMonth: string;
  sourceMonthSheet: string;
  categories: Category[];
  transactions: Transaction[];
  netWorth: NetWorthItem[];
  summary: {
    categories: number;
    transactions: number;
    incomeCents: number;
    outflowCents: number;
    plannedCents: number;
    warnings: string[];
  };
}

interface ImportOptions {
  activeMonth: string;
  currency: CurrencyCode;
  accountId: string;
}

export async function parseRindoMesWorkbook(file: File, options: ImportOptions): Promise<ImportedWorkbook> {
  return parseRindoMesWorkbookBuffer(await file.arrayBuffer(), options);
}

export async function parseRindoMesWorkbookBuffer(buffer: ArrayBuffer, options: ImportOptions): Promise<ImportedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const budgetSheet = workbook.getWorksheet("Presupuesto");
  if (!budgetSheet) {
    throw new Error("No encontre la hoja Presupuesto en este Excel.");
  }

  const warnings: string[] = [];
  const budgetLines = parseBudgetLines(budgetSheet);
  const categories = dedupeCategories(budgetLines);
  const monthSheetName = monthNameFromIso(options.activeMonth);
  const monthSheet = workbook.getWorksheet(monthSheetName);
  const transactions = monthSheet
    ? parseMonthlyTransactions(monthSheet, categories, options)
    : [];

  if (!monthSheet) {
    warnings.push(`No encontre la hoja ${monthSheetName}; importe solo el plan de Presupuesto.`);
  }

  const incomeCents = transactions
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amountCents, 0);
  const outflowCents = transactions
    .filter((transaction) => transaction.type !== "income")
    .reduce((sum, transaction) => sum + transaction.amountCents, 0);

  return {
    activeMonth: options.activeMonth,
    sourceMonthSheet: monthSheetName,
    categories,
    transactions,
    netWorth: [],
    summary: {
      categories: categories.length,
      transactions: transactions.length,
      incomeCents,
      outflowCents,
      plannedCents: categories.reduce((sum, category) => sum + category.plannedCents, 0),
      warnings,
    },
  };
}

function parseBudgetLines(sheet: ExcelJS.Worksheet) {
  const lines: ImportedLine[] = [];

  for (const start of budgetColumnStarts) {
    const group = groupFromLabel(readText(sheet.getCell(8, start)));
    if (!group) continue;

    for (let row = 10; row <= sheet.rowCount; row++) {
      const name = readText(sheet.getCell(row, start)).trim();
      if (!name || name.toLowerCase() === "total") continue;

      lines.push({
        group,
        name,
        plannedCents: toWorkbookCents(sheet.getCell(row, start + 2).value),
      });
    }
  }

  return lines;
}

function dedupeCategories(lines: ImportedLine[]) {
  const categories = new Map<string, Category>();

  for (const line of lines) {
    const id = `import-${line.group}-${slugify(line.name)}`;
    const existing = categories.get(id);

    if (existing) {
      categories.set(id, {
        ...existing,
        plannedCents: Math.max(existing.plannedCents, line.plannedCents),
      });
      continue;
    }

    categories.set(id, {
      id,
      group: line.group,
      name: line.name,
      subcategories: [line.name],
      plannedCents: line.plannedCents,
      source: "imported",
    });
  }

  return Array.from(categories.values());
}

function parseMonthlyTransactions(
  sheet: ExcelJS.Worksheet,
  categories: Category[],
  options: { activeMonth: string; currency: CurrencyCode; accountId: string },
) {
  const transactions: Transaction[] = [];
  const categoryByName = new Map(categories.map((category) => [normalize(category.name), category]));

  for (const start of monthColumnStarts) {
    const group = groupFromLabel(readText(sheet.getCell(57, start)));
    if (!group) continue;

    for (let row = 59; row <= sheet.rowCount; row++) {
      const name = readText(sheet.getCell(row, start)).trim();
      const amountCents = toWorkbookCents(sheet.getCell(row, start + 2).value);
      if (!name || name.toLowerCase() === "total" || amountCents === 0) continue;

      const category = categoryByName.get(normalize(name)) ?? makeImportedCategory(name, group);
      if (!categoryByName.has(normalize(name))) {
        categories.push(category);
        categoryByName.set(normalize(name), category);
      }

      const date = toIsoDate(sheet.getCell(row, start + 1).value) ?? `${options.activeMonth}-01`;

      transactions.push({
        id: `import-${options.activeMonth}-${start}-${row}-${slugify(name)}`,
        type: transactionTypeForGroup(group),
        date,
        description: name,
        categoryId: category.id,
        subcategory: name,
        accountId: options.accountId,
        tags: ["importado", sheet.name.toLowerCase()],
        originalAmountCents: amountCents,
        originalCurrency: options.currency,
        amountCents,
        baseCurrency: options.currency,
        exchangeRate: 1,
        exchangeRateDate: date,
        exchangeRateSource: "same_currency",
        status: "approved",
        createdBy: "Importacion Excel",
      });
    }
  }

  return transactions;
}

function makeImportedCategory(name: string, group: GroupKey): Category {
  return {
    id: `import-${group}-${slugify(name)}`,
    group,
    name,
    subcategories: [name],
    plannedCents: 0,
    source: "imported",
  };
}

function groupFromLabel(label: string): GroupKey | undefined {
  return groupBySheetLabel[normalize(label)];
}

function transactionTypeForGroup(group: GroupKey): TransactionType {
  if (group === "income") return "income";
  if (group === "debt") return "debt_payment";
  if (group === "savings") return "saving";
  if (group === "investments") return "investment";
  return "expense";
}

function monthNameFromIso(activeMonth: string) {
  const monthIndex = Number(activeMonth.slice(5, 7)) - 1;
  return monthNames[monthIndex] ?? "Enero";
}

function toIsoDate(value: ExcelJS.CellValue) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "object" && value && "result" in value) {
    return toIsoDate(value.result as ExcelJS.CellValue);
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }

  return undefined;
}

function toWorkbookCents(value: ExcelJS.CellValue) {
  const number = readNumber(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function readNumber(value: ExcelJS.CellValue): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/[^\d,.-]/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object" && value && "result" in value) {
    return readNumber(value.result as ExcelJS.CellValue);
  }
  return 0;
}

function readText(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) return value.richText.map((item) => item.text).join("");
  if (cell.text) return cell.text;
  return "";
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "item";
}
