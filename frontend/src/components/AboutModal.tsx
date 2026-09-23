import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {GetAppVersion, OpenReleaseURL} from '../../wailsjs/go/main/App';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

const GITHUB_REPO_URL = 'https://github.com/matheusbbdutra/wisp-db';
const RELEASES_URL = 'https://github.com/matheusbbdutra/wisp-db/releases';
const ISSUES_URL = 'https://github.com/matheusbbdutra/wisp-db/issues';

export default function AboutModal({isOpen, onClose}: Props) {
    const {t} = useTranslation();
    const [version, setVersion] = useState<string>('v0.1.0-beta.15');

    useEffect(() => {
        if (!isOpen) return;
        let isMounted = true;
        GetAppVersion()
            .then(v => {
                if (isMounted && v) setVersion(v);
            })
            .catch(() => {});
        return () => {
            isMounted = false;
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                onClose();
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    function handleOpenLink(url: string) {
        OpenReleaseURL(url).catch(() => {
            window.open(url, '_blank');
        });
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-container about-modal-container" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <div className="modal-title-group">
                        <h2 className="modal-title">{t('aboutModal.title')}</h2>
                        <span className="modal-subtitle">{t('aboutModal.subtitle')}</span>
                    </div>
                    <button className="modal-close-btn" onClick={onClose} aria-label={t('aboutModal.close')}>
                        ✕
                    </button>
                </div>

                <div className="modal-body about-modal-body">
                    <div className="about-brand-section">
                        <div className="about-logo-wrapper">
                            <svg width="40" height="40" viewBox="0 0 1024 1024" className="about-logo-svg">
                                <defs>
                                    <linearGradient id="aboutRing1" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stopColor="#1e40af" stopOpacity="0.15"/>
                                        <stop offset="55%" stopColor="#3b82f6"/>
                                        <stop offset="100%" stopColor="#a5f3fc"/>
                                    </linearGradient>
                                    <linearGradient id="aboutRing2" x1="100%" y1="100%" x2="0%" y2="0%">
                                        <stop offset="0%" stopColor="#1e40af" stopOpacity="0.15"/>
                                        <stop offset="55%" stopColor="#2563eb"/>
                                        <stop offset="100%" stopColor="#7dd3fc"/>
                                    </linearGradient>
                                    <radialGradient id="aboutCore" cx="50%" cy="50%" r="50%">
                                        <stop offset="0%" stopColor="#ffffff"/>
                                        <stop offset="100%" stopColor="#7dd3fc"/>
                                    </radialGradient>
                                </defs>
                                <g transform="translate(512 512)">
                                    <ellipse cx="0" cy="0" rx="290" ry="150" transform="rotate(-24)"
                                             fill="none" stroke="url(#aboutRing1)" strokeWidth="34" strokeLinecap="round"/>
                                    <ellipse cx="0" cy="0" rx="290" ry="150" transform="rotate(24)"
                                             fill="none" stroke="url(#aboutRing2)" strokeWidth="34" strokeLinecap="round"/>
                                    <circle cx="0" cy="0" r="66" fill="#0c0f14"/>
                                    <circle cx="0" cy="0" r="50" fill="url(#aboutCore)"/>
                                    <circle cx="243" cy="-14" r="17" fill="#e0f7ff"/>
                                </g>
                            </svg>
                        </div>
                        <div className="about-brand-info">
                            <div className="about-app-name-row">
                                <span className="about-app-name">Wisp</span>
                                <span className="about-version-badge">{version}</span>
                            </div>
                            <p className="about-description">{t('aboutModal.subtitle')}</p>
                        </div>
                    </div>

                    <div className="about-section">
                        <h3 className="about-section-heading">{t('aboutModal.linksTitle')}</h3>
                        <div className="about-links-grid">
                            <button
                                type="button"
                                className="about-link-card"
                                onClick={() => handleOpenLink(GITHUB_REPO_URL)}
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                                </svg>
                                <span>{t('aboutModal.github')}</span>
                                <span className="about-link-external-icon">↗</span>
                            </button>

                            <button
                                type="button"
                                className="about-link-card"
                                onClick={() => handleOpenLink(RELEASES_URL)}
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                    <line x1="12" y1="22.08" x2="12" y2="12" />
                                </svg>
                                <span>{t('aboutModal.releases')}</span>
                                <span className="about-link-external-icon">↗</span>
                            </button>

                            <button
                                type="button"
                                className="about-link-card"
                                onClick={() => handleOpenLink(ISSUES_URL)}
                            >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8" x2="12" y2="12" />
                                    <line x1="12" y1="16" x2="12.01" y2="16" />
                                </svg>
                                <span>{t('aboutModal.issues')}</span>
                                <span className="about-link-external-icon">↗</span>
                            </button>
                        </div>
                    </div>

                    <div className="about-section">
                        <h3 className="about-section-heading">{t('aboutModal.stackTitle')}</h3>
                        <div className="about-tech-tags">
                            <span className="about-tag">Go</span>
                            <span className="about-tag">Wails v2</span>
                            <span className="about-tag">React 19</span>
                            <span className="about-tag">Monaco Editor</span>
                            <span className="about-tag">Glide Data Grid</span>
                            <span className="about-tag">SQLite</span>
                            <span className="about-tag">PostgreSQL</span>
                            <span className="about-tag">MySQL</span>
                        </div>
                    </div>

                    <div className="about-license-note">
                        <span>{t('aboutModal.license')}</span>
                    </div>
                </div>

                <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={onClose}>
                        {t('aboutModal.close')}
                    </button>
                </div>
            </div>
        </div>
    );
}
