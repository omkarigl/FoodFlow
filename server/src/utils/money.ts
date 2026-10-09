/** All monetary values are stored in rupees with 2 decimal places. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toPaise(rupees: number): number {
  return Math.round(round2(rupees) * 100);
}

export function fromPaise(paise: number): number {
  return round2(paise / 100);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}