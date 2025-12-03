import { useState, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";

export function useSettings() {
  const [keybinding, setKeybinding] = useState("CmdOrCtrl+Shift+Space");

  useEffect(() => {
    loadKeybinding();
  }, []);

  const loadKeybinding = async () => {
    try {
      const store = await load("settings.json");
      const savedKeybinding = await store.get<string>("keybinding");
      if (savedKeybinding) setKeybinding(savedKeybinding);
    } catch (error) {
      console.error("Failed to load keybinding:", error);
    }
  };

  const saveKeybinding = async (newKeybinding: string) => {
    try {
      await invoke("update_shortcut", { newShortcut: newKeybinding });
      const store = await load("settings.json");
      await store.set("keybinding", newKeybinding);
      await store.save();
      setKeybinding(newKeybinding);
    } catch (error) {
      console.error("Failed to save keybinding:", error);
      throw error;
    }
  };

  return { keybinding, saveKeybinding };
}
