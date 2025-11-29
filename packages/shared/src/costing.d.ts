export const RAW_SC_TO_TORRADO_KG: number;
export const FARDO_KG: number;
export const RAW_SC_TO_FARDOS: number;

export function toScEquivalentFromFardos(fardos: number): number;
export function toScEquivalentFromKg(kg: number): number;
export function toFardosFromSc(sacas: number): number;
export function toKgFromSc(sacas: number): number;
export function toFardosFromKg(kg: number): number;
export function deriveCostPerFardo(rawAvgCostPerSc: number): number;
