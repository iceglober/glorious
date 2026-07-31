import { format } from "./format";

export const heading = (value: string): string => format(value).toUpperCase();
export const note = (value: string): string => format(value);
