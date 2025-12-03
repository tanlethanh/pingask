interface SearchInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
  onSubmit: (e: React.FormEvent) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function SearchInput({ value, onChange, disabled, onSubmit, inputRef }: SearchInputProps) {
  return (
    <form onSubmit={onSubmit} style={{ margin: 0 }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={onChange}
        placeholder="Ask anything..."
        className="search-input"
        disabled={disabled}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck="false"
        data-gramm="false"
        data-gramm_editor="false"
        data-enable-grammarly="false"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
      />
    </form>
  );
}
