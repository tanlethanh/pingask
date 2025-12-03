import { SettingsIcon } from "../icons";

interface FooterProps {
  hasContent: boolean;
  onSettingsClick: () => void;
}

export function Footer({ hasContent, onSettingsClick }: FooterProps) {
  return (
    <div className="footer">
      <span className="shortcut">
        {hasContent ? "ESC to go back" : "ESC to close"}
      </span>
      <button
        className="settings-btn"
        onClick={onSettingsClick}
        type="button"
        aria-label="Settings"
      >
        <SettingsIcon />
      </button>
    </div>
  );
}
