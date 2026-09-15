// Detecção/formatação de valor de célula pro CellValueViewer (estilo
// DBeaver: "Ver valor" no menu de contexto do grid). Sem lib nova — JSON via
// JSON.parse/stringify nativo, XML via DOMParser/DOM nativo do browser
// (Webview do Wails já tem os dois).
export type ValueFormat = 'auto' | 'text' | 'json' | 'xml';

// Auto-detecção: tenta JSON primeiro (mais comum em colunas jsonb), depois
// XML (checa parsererror do DOMParser), senão texto puro.
export function detectFormat(raw: string): 'text' | 'json' | 'xml' {
    const trimmed = raw.trim();
    if (trimmed === '') return 'text';
    try {
        JSON.parse(trimmed);
        return 'json';
    } catch {
        // não é JSON válido, tenta XML abaixo
    }
    if (trimmed.startsWith('<')) {
        const doc = new DOMParser().parseFromString(trimmed, 'application/xml');
        if (!doc.querySelector('parsererror')) {
            return 'xml';
        }
    }
    return 'text';
}

function prettyJSON(raw: string): string {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return raw;
    }
}

// Serializa o DOM parseado com indentação de 2 espaços por nível — o
// DOMParser nativo não tem um "pretty serializer" embutido (diferente de
// libs XML de outras linguagens), então a indentação é reconstruída à mão
// a partir da árvore, ignorando nós de texto vazios (só whitespace).
function prettyXML(raw: string): string {
    try {
        const doc = new DOMParser().parseFromString(raw, 'application/xml');
        if (doc.querySelector('parsererror') || !doc.documentElement) {
            return raw;
        }
        const serialize = (node: Node, depth: number): string => {
            const indent = '  '.repeat(depth);
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent?.trim();
                return text ? `${indent}${text}\n` : '';
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return '';
            }
            const el = node as Element;
            const attrs = Array.from(el.attributes).map(a => ` ${a.name}="${a.value}"`).join('');
            const children = Array.from(el.childNodes).filter(c => !(c.nodeType === Node.TEXT_NODE && !c.textContent?.trim()));
            if (children.length === 0) {
                return `${indent}<${el.tagName}${attrs} />\n`;
            }
            const hasElementChildren = children.some(c => c.nodeType === Node.ELEMENT_NODE);
            if (!hasElementChildren) {
                const text = el.textContent?.trim() ?? '';
                return `${indent}<${el.tagName}${attrs}>${text}</${el.tagName}>\n`;
            }
            let out = `${indent}<${el.tagName}${attrs}>\n`;
            children.forEach(c => { out += serialize(c, depth + 1); });
            out += `${indent}</${el.tagName}>\n`;
            return out;
        };
        return serialize(doc.documentElement, 0).trimEnd();
    } catch {
        return raw;
    }
}

// Aplica o formato escolhido (ou detectado, se 'auto') ao texto bruto.
// Formato inválido pro conteúdo real (ex. JSON escolhido manualmente num
// texto que não é JSON) retorna o bruto sem quebrar a exibição.
export function formatValue(raw: string, format: ValueFormat): string {
    const effective = format === 'auto' ? detectFormat(raw) : format;
    if (effective === 'json') return prettyJSON(raw);
    if (effective === 'xml') return prettyXML(raw);
    return raw;
}
