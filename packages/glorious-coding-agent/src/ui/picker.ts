import type { KeyEvent } from "@opentui/core";
import type { Session } from "../../../glorious-core/src/session";

export const pickSession = async (sessions: Session[]): Promise<Session> => {
  const tui = await import("@opentui/core");
  const renderer = await tui.createCliRenderer({
    stdin: process.stdin,
    stdout: process.stdout,
    screenMode: "alternate-screen",
    exitOnCtrlC: false,
    exitSignals: [],
    useMouse: true,
    consoleMode: "disabled",
    useKittyKeyboard: { disambiguate: true, alternateKeys: true },
  });
  const picker = new tui.SelectRenderable(renderer, {
    width: "100%",
    height: "100%",
    options: sessions.map((session) => ({
      name: session.title,
      description: `${session.id} · ${session.cwd}`,
      value: session,
    })),
  });
  renderer.root.add(picker);

  return new Promise<Session>((resolve, reject) => {
    let settled = false;
    const finish = (result: Session | Error): void => {
      if (settled) return;
      settled = true;
      picker.off("itemSelected", onSelected);
      renderer.keyInput.off("keypress", onKey);
      renderer.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const onSelected = (): void => {
      const selected = picker.getSelectedOption()?.value;
      if (selected) finish(selected as Session);
    };
    const onKey = (event: KeyEvent): void => {
      if (event.name !== "escape") return;
      event.stopPropagation();
      finish(new Error("Session selection cancelled."));
    };
    picker.on("itemSelected", onSelected);
    renderer.keyInput.on("keypress", onKey);
    renderer.start();
    picker.focus();
  });
};
