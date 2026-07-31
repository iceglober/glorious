/** Sum every number in the list. */
export const total = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 1);
