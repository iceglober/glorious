import z from "zod";

/** Terminal UI settings. The chat surface is the full-screen OpenTUI renderer
 *  (the only one); this namespace is kept for future TUI settings. A legacy
 *  `renderer` key from older configs is ignored. */
export const tuiConfigSchema = z.object({}).prefault({});
export type TuiConfig = z.infer<typeof tuiConfigSchema>;
