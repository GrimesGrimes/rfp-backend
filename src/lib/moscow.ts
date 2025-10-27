export const MOSCOW = ["wont","would","could","should"] as const;
export type Moscow = typeof MOSCOW[number];
export function isMoscow(v: string): v is Moscow {
  return MOSCOW.includes(v as any);
}
