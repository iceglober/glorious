declare const __WTM_VERSION__: string;

export const VERSION: string =
  typeof __WTM_VERSION__ !== "undefined" ? __WTM_VERSION__ : "0.0.0-dev";
