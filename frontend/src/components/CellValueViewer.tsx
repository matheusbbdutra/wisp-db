import {useMemo, useState} from 'react';
import {detectFormat, formatValue, type ValueFormat} from '../lib/valueFormat';
import {copyToClipboard} from '../lib/gridCopyFormats';

interface Props {
    // null quando não há célula selecionada (grid vazio ou seleção limpa) —
    // o painel mostra um empty state em vez de sumir, pra não fazer o layout
    // "pular" a cada seleção (ver docs/analysis/ui-ux-2026-09-15-opencode.md).
    cell: {columnName: string; rawValue: string} | null;
    width: number;
    onResizeMouseDown: (e: React.MouseEvent) => void;
    onClose: () => void;
}

// Visor de valor de célula (estilo DBeaver): painel DOCKADO à direita do
// grid (não mais modal — ver docs/analysis/ui-ux-2026-09-15*.md, feedback do
// usuário de que o modal cobria a grade e exigia reabrir a cada célula).
// Segue a célula ativa sozinho enquanto estiver aberto (ResultGrid deriva
// `cell` de `gridSelection`); formato (Auto/Texto/JSON/XML), quebra de linha
// e copiar continuam os mesmos de antes.
export default function CellValueViewer({cell, width, onResizeMouseDown, onClose}: Props) {
    const [format, setFormat] = useState<ValueFormat>('auto');
    const [wrap, setWrap] = useState(true);
    const [copied, setCopied] = useState(false);

    const detected = useMemo(() => (cell ? detectFormat(cell.rawValue) : 'text'), [cell]);
    const formatted = useMemo(() => (cell ? formatValue(cell.rawValue, format) : ''), [cell, format]);

    async function handleCopy() {
        if (!cell) return;
        const ok = await copyToClipboard(formatted);
        setCopied(ok);
        if (ok) setTimeout(() => setCopied(false), 1500);
    }

    return (
        <>
            <div className="resize-handle resize-handle-v" onMouseDown={onResizeMouseDown} title="Arrastar para redimensionar" />
            <div className="value-viewer-dock" style={{width}} role="complementary" aria-label="Visor de valor da célula">
                <div className="value-viewer-header">
                    <span className="grid-context-menu-group-label">{cell ? cell.columnName : 'Valor'}</span>
                    <div className="value-viewer-controls">
                        <select value={format} onChange={e => setFormat(e.target.value as ValueFormat)} title="Formato de exibição" disabled={!cell}>
                            <option value="auto">Auto ({detected})</option>
                            <option value="text">Texto</option>
                            <option value="json">JSON</option>
                            <option value="xml">XML</option>
                        </select>
                        <label className="value-viewer-wrap-toggle">
                            <input type="checkbox" checked={wrap} onChange={e => setWrap(e.target.checked)} />
                            Quebra de linha
                        </label>
                        <button className="btn btn-secondary" onClick={handleCopy} disabled={!cell}>{copied ? 'Copiado!' : 'Copiar'}</button>
                        <button className="btn btn-secondary" onClick={onClose} title="Fechar visor de valor">✕</button>
                    </div>
                </div>
                {cell ? (
                    <pre className={`value-viewer-content ${wrap ? 'wrap' : 'nowrap'}`}>{formatted}</pre>
                ) : (
                    <div className="value-viewer-empty">Selecione uma célula pra ver o valor completo aqui.</div>
                )}
            </div>
        </>
    );
}
