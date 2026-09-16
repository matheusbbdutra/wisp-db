import {ReportFrontendError} from '../../wailsjs/go/main/App';

// Sends an uncaught frontend error to the same local, append-only log the Go side uses
// for panics (internal/errlog) — nothing is sent over the network here, this is purely
// local persistence for a future "report problem" flow (see STATE.md). Scrubbing of
// credentials/query literals happens on the Go side (errlog.Scrub) so there is one place
// that owns the redaction rules, not two.
//
// Swallows its own failure on purpose: if the IPC call itself throws (e.g. app closing),
// there is nothing more useful to do than drop it — retrying or surfacing it would just
// risk a reporting loop.
function report(source: string, message: string, stack: string): void {
    ReportFrontendError(source, message, stack).catch(() => {});
}

// Registers window.onerror / unhandledrejection listeners once for the whole app.
// Call this a single time at startup (main.tsx) — it is a global listener, not something
// that makes sense per-component.
export function installGlobalErrorReporting(): void {
    window.addEventListener('error', event => {
        report('error', event.message, event.error?.stack ?? '');
    });
    window.addEventListener('unhandledrejection', event => {
        const reason = event.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        const stack = reason instanceof Error ? reason.stack ?? '' : '';
        report('rejection', message, stack);
    });
}

// Used by the React ErrorBoundary (see ErrorBoundary.tsx) — a render error doesn't go
// through window.onerror in React 18's own error handling path.
export function reportBoundaryError(message: string, stack: string): void {
    report('render', message, stack);
}
