import {useState, useEffect, useRef, useId} from 'react';
import {useTranslation} from 'react-i18next';
import {GetCachedCatalog} from '../lib/tabApi';
import type {db} from '../../wailsjs/go/models';

import {filterAndSortCatalog} from '../lib/quickOpenSearch';

export interface QuickOpenModalProps {
    isOpen: boolean;
    onClose: () => void;
    tabId?: string;
    connectionId?: string;
    onOpenTable: (connectionId: string, schema: string, table: string) => void;
}

export default function QuickOpenModal({
    isOpen,
    onClose,
    tabId,
    connectionId,
    onOpenTable,
}: QuickOpenModalProps) {
    const {t} = useTranslation();
    const [query, setQuery] = useState('');
    const [tables, setTables] = useState<db.Table[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const quickOpenInputId = useId();

    useEffect(() => {
        if (!isOpen) return;
        setQuery('');
        setSelectedIndex(0);

        if (tabId) {
            GetCachedCatalog(tabId)
                .then(items => {
                    setTables(items ?? []);
                })
                .catch(() => {
                    setTables([]);
                });
        }

        setTimeout(() => {
            inputRef.current?.focus();
        }, 30);
    }, [isOpen, tabId]);

    const filtered = filterAndSortCatalog(tables, query, 50);

    // Ensure selectedIndex is within bounds when list changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
        if (!listRef.current) return;
        const activeEl = listRef.current.querySelector('.quick-open-item.selected') as HTMLElement;
        if (activeEl) {
            activeEl.scrollIntoView({block: 'nearest'});
        }
    }, [selectedIndex]);

    function handleSelect(table: db.Table) {
        if (!connectionId) return;
        onOpenTable(connectionId, table.Schema, table.Name);
        onClose();
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev < filtered.length - 1 ? prev + 1 : 0));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev > 0 ? prev - 1 : Math.max(0, filtered.length - 1)));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered[selectedIndex]) {
                handleSelect(filtered[selectedIndex]);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    }

    if (!isOpen) return null;

    return (
        <div className="modal-backdrop quick-open-backdrop" onClick={onClose}>
            <div
                className="quick-open-container"
                onClick={e => e.stopPropagation()}
                onKeyDown={handleKeyDown}
            >
                <div className="quick-open-search-bar">
                    <svg
                        className="quick-open-icon"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        id={quickOpenInputId}
                        ref={inputRef}
                        type="text"
                        className="quick-open-input"
                        placeholder={t('quickOpen.placeholder')}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                    <kbd className="quick-open-esc">Esc</kbd>
                </div>

                <div ref={listRef} className="quick-open-list">
                    {filtered.length === 0 ? (
                        <div className="quick-open-empty">
                            <span>{query ? t('quickOpen.noMatches') : t('quickOpen.noTables')}</span>
                        </div>
                    ) : (
                        filtered.map((item, idx) => {
                            const isView = (item.Kind || '').toLowerCase() === 'view';
                            const isSelected = idx === selectedIndex;
                            return (
                                <div
                                    key={`${item.Schema}.${item.Name}`}
                                    className={`quick-open-item ${isSelected ? 'selected' : ''}`}
                                    onClick={() => handleSelect(item)}
                                    onMouseEnter={() => setSelectedIndex(idx)}
                                >
                                    <span className={`quick-open-badge ${isView ? 'view' : 'table'}`}>
                                        {isView ? t('quickOpen.viewBadge') : t('quickOpen.tableBadge')}
                                    </span>
                                    <span className="quick-open-table-name">{item.Name}</span>
                                    {item.Schema && (
                                        <span className="quick-open-schema-name">{item.Schema}</span>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="quick-open-footer">
                    <span>{t('quickOpen.footerHint')}</span>
                </div>
            </div>
        </div>
    );
}
