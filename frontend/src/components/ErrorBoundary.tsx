import {Component, type ErrorInfo, type ReactNode} from 'react';
import i18n from '../i18n';
import {reportBoundaryError} from '../lib/errorReporting';

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
}

// Catches render errors that would otherwise white-screen the whole app (React's own
// error handling doesn't route these through window.onerror). Reports to the local log
// (see lib/errorReporting.ts) and shows a minimal fallback instead of a blank window —
// there is no way to safely keep rendering the subtree that threw, so a reload is the
// only real recovery.
export default class ErrorBoundary extends Component<Props, State> {
    state: State = {error: null};

    static getDerivedStateFromError(error: Error): State {
        return {error};
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        reportBoundaryError(error.message, error.stack ?? info.componentStack ?? '');
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="error-boundary">
                <h1>{i18n.t('errorBoundary.title')}</h1>
                <p>{i18n.t('errorBoundary.description')}</p>
                <button onClick={() => window.location.reload()}>
                    {i18n.t('errorBoundary.reload')}
                </button>
            </div>
        );
    }
}
