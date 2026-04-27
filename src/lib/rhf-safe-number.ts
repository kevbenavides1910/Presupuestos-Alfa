/**
 * Equivalente a NaN sin el literal en ternarios como los de RHF `getFieldValueAs`
 * (`value === '' ? NaN`), que en builds Next/SWC pueden minificarse a `returnNaN`.
 */
export const RHF_EMPTY_NUMBER = 0 / 0;

/**
 * Sustituto de `{ valueAsNumber: true }` para inputs numéricos.
 * Misma idea que react-hook-form: vacío → no finito (NaN).
 */
export function rhfValueAsNumber(value: unknown): number {
  if (value === "" || value === null || value === undefined) {
    return RHF_EMPTY_NUMBER;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : RHF_EMPTY_NUMBER;
  }
  const n = +String(value);
  return Number.isFinite(n) ? n : RHF_EMPTY_NUMBER;
}
