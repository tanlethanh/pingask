import { SettingsIcon } from "../icons";

interface FooterProps {
  hasContent: boolean;
  apiKey: string;
  onSettingsClick: () => void;
}

export function Footer({ hasContent, apiKey, onSettingsClick }: FooterProps) {
  return (
    <div className="footer">
      <span className="shortcut">
        {hasContent ? "ESC to go back" : "ESC to close"}
      </span>
      {apiKey ? (
        <button
          className="settings-btn"
          onClick={onSettingsClick}
          type="button"
          aria-label="Settings"
        >
          <SettingsIcon />
        </button>
      ) : (
        <button
          className="settings-btn warning"
          onClick={onSettingsClick}
          type="button"
        >
          Set API Key
        </button>
      )}
    </div>
  );
}
