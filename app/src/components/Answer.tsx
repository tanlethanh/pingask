interface AnswerProps {
  content: string;
  loading: boolean;
}

export function Answer({ content, loading }: AnswerProps) {
  if (loading) {
    return (
      <div className="result loading">
        <div className="loader"></div>
        <span>Thinking...</span>
      </div>
    );
  }

  if (!content) return null;

  return (
    <div
      className="result markdown-body"
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}
