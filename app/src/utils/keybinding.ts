export function formatKeybindingDisplay(kb: string): string[] {
  return kb.split("+").map((key) => {
    if (key === "CmdOrCtrl") return navigator.platform.includes("Mac") ? "⌘" : "Ctrl";
    if (key === "Cmd") return "⌘";
    if (key === "Ctrl") return "Ctrl";
    if (key === "Alt") return "⌥";
    if (key === "Shift") return "⇧";
    if (key === "Space") return "Space";
    return key;
  });
}

export function parseKeybindingFromEvent(e: React.KeyboardEvent): string | null {
  if (e.key === "Escape") return null;

  const keys: string[] = [];

  if (e.metaKey || e.ctrlKey) keys.push("CmdOrCtrl");
  if (e.altKey) keys.push("Alt");
  if (e.shiftKey) keys.push("Shift");

  if (e.key && !["Meta", "Control", "Alt", "Shift"].includes(e.key)) {
    let mainKey = e.key;
    if (mainKey === " ") {
      mainKey = "Space";
    } else if (mainKey.length === 1) {
      mainKey = mainKey.toUpperCase();
    }
    keys.push(mainKey);
  }

  return keys.length > 1 ? keys.join("+") : null;
}
