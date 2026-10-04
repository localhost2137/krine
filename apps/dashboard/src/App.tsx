import { Fragment, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { api, errorMessage, mutation } from "./api";
import { Loading, Notice } from "./shared";
import { InstallationContext } from "./Overview";

export function App() {
  const [initialized, setInitialized] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [reauthenticate, setReauthenticate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const [navigationOpen, setNavigationOpen] = useState(false);
  useEffect(() => setNavigationOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!navigationOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavigationOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [navigationOpen]);
  useEffect(() => {
    api.onUnauthorized = () => setReauthenticate(true);
    void api
      .session()
      .then(() => setAuthenticated(true))
      .catch(() => {
        /* Login form is the recovery path. */
      })
      .finally(() => setInitialized(true));
    return () => {
      api.onUnauthorized = undefined;
    };
  }, []);
  useEffect(() => {
    if (reauthenticate) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [reauthenticate]);
  const section =
    location.pathname === "/inspect/check"
      ? "checks"
      : location.pathname.startsWith("/inspect/") || location.pathname.startsWith("/entities/")
        ? "activity"
        : location.pathname.split("/")[1] || "overview";
  useEffect(() => {
    document.title = `${section.replace(/^./, (value) => value.toUpperCase())} · Krine`;
  }, [section]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    try {
      await api.session(String(new FormData(form).get("password") ?? ""));
      setAuthenticated(true);
      setReauthenticate(false);
      form.reset();
    } catch (cause) {
      setError(errorMessage(cause));
      password.current?.focus();
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await api.run(mutation("/session", {}, "DELETE"));
      api.csrf = "";
      setAuthenticated(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const loginForm = (
    <form className="login-form" onSubmit={(event) => void login(event)}>
      <h1>{reauthenticate ? "Sign in again." : "Sign in to Krine."}</h1>
      <p className="muted">
        Use the administrator password configured for this installation.
        {reauthenticate && " Your unsaved work remains open."}
      </p>
      <label>
        Administrator password
        <input
          ref={password}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {error && <Notice>{error}</Notice>}
      <button className="primary" disabled={busy} type="submit">
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {navigationOpen && (
        <button
          className="navigation-backdrop"
          aria-label="Close navigation"
          onClick={() => setNavigationOpen(false)}
        />
      )}
      <header
        id="workspace-navigation"
        className={`site-header ${navigationOpen ? "navigation-open" : ""} ${!authenticated ? "login-brand" : ""}`}
      >
        <Link className="brand" to="/" aria-label="Krine overview">
          <span className="brand-mark" aria-hidden="true">
            κ
          </span>
          <span>Krine</span>
        </Link>
        {authenticated && (
          <>
            <nav aria-label="Main navigation">
              <span className="nav-section nav-primary-label">Workspace</span>
              {(
                [
                  [
                    "/",
                    "overview",
                    "Overview",
                    "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
                  ],
                  ["/activity", "activity", "Activity", "M2 12h4l3-8 6 16 3-8h4"],
                  ["/checks", "checks", "Checks", "M4 4h6v6H4z M14 14h6v6h-6z M7 10v7h7 M10 7h7v7"],
                  ["/metrics", "metrics", "Metrics", "M4 20V10 M10 20V4 M16 20v-8 M22 20V7"],
                ] as const
              ).map(([to, key, label, path]) => (
                <Fragment key={key}>
                  {key === "checks" && <span className="nav-section">Policy</span>}
                  <Link
                    to={to}
                    aria-current={section === key ? "page" : undefined}
                    className={section === key ? "active" : undefined}
                  >
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      aria-hidden="true"
                    >
                      <path d={path} />
                    </svg>
                    {label}
                  </Link>
                </Fragment>
              ))}
              <span className="nav-section">System</span>
              <NavLink to="/settings">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="8" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Settings
              </NavLink>
            </nav>
            <div className="header-utilities">
              <span className="account-avatar" aria-hidden="true">
                KR
              </span>
              <span className="account-details">
                <strong>Administrator</strong>
                <span className="deployment" title={window.location.host}>
                  {window.location.host}
                </span>
              </span>
              <button
                aria-label="Sign out"
                title="Sign out"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Sign out? Save open changes and copy any newly revealed secrets before continuing.",
                    )
                  )
                    void logout();
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M9 4H4v16h5M14 8l4 4-4 4M8 12h10" />
                </svg>
              </button>
            </div>
          </>
        )}
      </header>
      <main
        id="main"
        className={`workspace-main ${!authenticated ? "auth-main" : ""}`}
        tabIndex={-1}
      >
        {authenticated && (
          <div className="workspace-toolbar">
            <button
              className="navigation-toggle"
              aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={navigationOpen}
              aria-controls="workspace-navigation"
              onClick={() => setNavigationOpen(!navigationOpen)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M9 4v16" />
              </svg>
            </button>
            <span>
              {section === "settings"
                ? "System"
                : section === "checks" || section === "metrics"
                  ? "Policy"
                  : "Workspace"}
            </span>
            <span aria-hidden="true">›</span>
            <strong>{section.charAt(0).toUpperCase() + section.slice(1)}</strong>
          </div>
        )}
        <div className="workspace-content">
          {!initialized ? (
            <Loading />
          ) : authenticated ? (
            <>
              <InstallationContext />
              {error && !reauthenticate && <Notice>{error}</Notice>}
              <Outlet />
            </>
          ) : (
            loginForm
          )}
        </div>
      </main>
      <dialog ref={dialog} onCancel={(event) => event.preventDefault()}>
        {authenticated ? loginForm : null}
      </dialog>
      <footer className="site-footer">Krine · Self-hosted trust decisions</footer>
    </>
  );
}
