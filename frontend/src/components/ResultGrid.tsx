// Grid de resultado simples (tabela HTML). Ainda não é virtualizado —
// Glide Data Grid entra quando o volume de linhas justificar (ver
// docs/ROADMAP.md, Fase 1). Suficiente para os resultados pequenos do
// skeleton/dev atual.
interface Props {
    columns: string[];
    rows: any[][];
}

export default function ResultGrid({columns, rows}: Props) {
    if (columns.length === 0) return null;

    return (
        <div className="result-grid">
            <table>
                <thead>
                    <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={i}>{row.map((v, j) => <td key={j}>{v === null ? 'NULL' : String(v)}</td>)}</tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
