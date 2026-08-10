import type { Tone } from "./render";

// A mode is a capability preset: which tools the agent may reach for, and how
// hard it is asked to think. Model choice stays with /models — a mode layers on
// top of whatever model is active rather than pinning one.

export type Mode = {
  name: string;
  description: string;
  // when true, only tools that cannot change anything are offered
  readOnly: boolean;
  // how the mode is coloured everywhere it appears, so the picker and the
  // composer label cannot drift apart
  tone: Tone;
  // applied only when the active model advertises this reasoning variant
  effort?: string;
};

export const MODES: readonly Mode[] = [
  {
    name: "build",
    description: "Every tool. Reads, edits, runs commands.",
    readOnly: false,
    tone: "success",
  },
  {
    name: "plan",
    description: "Read-only. Explores and proposes; changes nothing.",
    readOnly: true,
    tone: "accent",
    effort: "high",
  },
];

export const DEFAULT_MODE: Mode = MODES[0];

export const modeByName = (name: string): Mode | undefined =>
  MODES.find((mode) => mode.name === name.toLowerCase());

export const nextMode = (currentName: string): Mode => {
  const current = modeByName(currentName);
  if (!current) return DEFAULT_MODE;
  return MODES[(MODES.indexOf(current) + 1) % MODES.length] ?? DEFAULT_MODE;
};
