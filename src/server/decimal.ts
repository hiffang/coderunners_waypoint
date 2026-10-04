import "server-only";
import { Prisma } from "@/generated/prisma/client";

/**
 * Prisma returns Decimal for numeric columns (volume m3, weight kg, fuel L).
 * DTOs carry plain numbers; convert at the API boundary only.
 */
export function toNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : value.toNumber();
}

export function toDecimal(value: number | string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Sum decimals without float drift. */
export function sumDecimal(values: Array<Prisma.Decimal | number>): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(v), new Prisma.Decimal(0));
}
