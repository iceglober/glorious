export const titleCase = (value: string): string =>
  value.replace(/\w\S*/g, (word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase());
