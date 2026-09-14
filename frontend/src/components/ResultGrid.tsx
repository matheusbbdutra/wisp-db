// Grid de resultado simples (tabela HTML). Ainda não é virtualizado —
// Glide Data Grid entra quando o volume de linhas justificar (ver
// docs/ROADMAP.md, Fase 1). Suficiente para os resultados pequenos do
// skeleton/dev atual.
interface Props {
    columns: string[];
    rows: any[][];
}

export default function ResultGrid({columns, rows}: Props) {
    if (columns.length === 0) {
        return (
            <div className="result-container">
                <div className="result-empty">
                    <svg className="result-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18" />
                    </svg>
                    <span>Nenhum resultado para exibir.</span>
                    <span style={{fontSize: '11px', opacity: 0.7}}>Execute uma consulta SQL para visualizar os dados aqui.</span>
                </div>
            </div>
        );
    }

    return (
        <div className="result-container">
            <div className="result-toolbar">
                <div className="result-stats">
                    <span>Resultados:</span>
                    <span className="result-stat-badge">{rows.length} {rows.length === 1 ? 'linha' : 'linhas'}</span>
                    <span className="result-stat-badge">{columns.length} {columns.length === 1 ? 'coluna' : 'colunas'}</span>
                </div>
            </div>

            <div className="result-grid-scroll">
                <table className="result-table">
                    <thead>
                        <tr>
                            <th className="col-index">#</th>
                            {columns.map(c => (
                                <th key={c} title={`Coluna: ${c}`}>
                                    {c}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr key={i}>
                                <td className="cell-index">{i + 1}</td>
                                {row.map((v, j) => (
                                    <td key={j} title={v === null ? 'NULL' : String(v)}>
                                        {v === null ? (
                                            <span className="cell-null">NULL</span>
                                        ) : (
                                            String(v)
                                        )}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
