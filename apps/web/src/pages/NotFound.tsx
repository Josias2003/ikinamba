import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-ink-400">
      <h1 className="text-3xl font-bold">404</h1>
      <p>Page not found.</p>
      <Link to="/" className="text-brand-400 hover:underline">Back to dashboard</Link>
    </div>
  );
}
