import { useEffect, useState } from "react";
import { login, register } from "../api";

export default function AuthPanel({ open, onClose, onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setError(""); setMessage(""); }
  }, [open]);

  if (!open) return null;

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const response = mode === "register"
        ? await register(displayName, email, password)
        : await login(email, password);
      if (response.data.confirmation_required) {
        setMessage("Check your email and confirm your Cerum account, then return here to sign in.");
        setPassword("");
        return;
      }
      onAuthenticated(response.data.user);
      setPassword("");
      onClose();
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Could not sign in. Check that the backend is running.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal auth-panel" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="modal-close" onClick={onClose} aria-label="Close sign in">×</button>
        <p className="kicker">Your Cerum account</p>
        <h2 id="auth-title">{mode === "login" ? "Welcome back" : "Save your listening trail"}</h2>
        <p className="modal-copy">Favourites and recommendation history are securely synced to your Cerum account.</p>

        <div className="auth-tabs" aria-label="Account action">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Sign in</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Create account</button>
        </div>

        <form onSubmit={submit}>
          {mode === "register" && (
            <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" maxLength="60" /></label>
          )}
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : 1} required /></label>
          {mode === "register" && <small>Use at least 8 characters.</small>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="form-message" role="status">{message}</p>}
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
      </section>
    </div>
  );
}
