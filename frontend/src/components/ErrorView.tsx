interface ErrorViewProps {
  message: string;
  onRecover: () => void;
}

export function ErrorView({ message, onRecover }: ErrorViewProps) {
  return (
    <main className="error-screen">
      <div className="error-mark" aria-hidden="true">!</div>
      <h1>这次没有处理成功</h1>
      <p>{message}</p>
      <button className="primary-button" type="button" onClick={onRecover}>
        返回重试
      </button>
    </main>
  );
}
