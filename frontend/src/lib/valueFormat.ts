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

// Conteúdo misto e espaços explicitamente preservados ficam intactos:
// inserir indentação nesses casos pode alterar o valor XML.
function prettyXML(raw: string): string {
    try {
        const doc = new DOMParser().parseFromString(raw, 'application/xml');
        if (doc.querySelector('parsererror') || !doc.documentElement) return raw;
        if (raw.includes('<?') || doc.doctype) return raw;
        const elements = Array.from(doc.getElementsByTagName('*'));
        if (elements.some(el => {
            const children = Array.from(el.childNodes);
            return el.getAttribute('xml:space') === 'preserve' ||
                (children.some(c => c.nodeType === Node.ELEMENT_NODE) &&
                    children.some(c => c.nodeType === Node.CDATA_SECTION_NODE ||
                        (c.nodeType === Node.TEXT_NODE && !!c.textContent?.trim())));
        })) return raw;

        const escapeText = (text: string): string => text.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
        const escapeAttribute = (text: string): string => escapeText(text)
            .replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
        const serialize = (node: Node, depth: number): string => {
            const indent = '  '.repeat(depth);
            if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? '');
            if (node.nodeType === Node.CDATA_SECTION_NODE) return `<![CDATA[${node.textContent ?? ''}]]>`;
            if (node.nodeType === Node.COMMENT_NODE) return `<!--${node.textContent ?? ''}-->`;
            if (node.nodeType !== Node.ELEMENT_NODE) return '';
            const el = node as Element;
            const attrs = Array.from(el.attributes).map(a => ` ${a.name}="${escapeAttribute(a.value)}"`).join('');
            const children = Array.from(el.childNodes);
            if (children.length === 0) return `${indent}<${el.tagName}${attrs} />`;
            if (!children.some(c => c.nodeType === Node.ELEMENT_NODE)) {
                return `${indent}<${el.tagName}${attrs}>${children.map(c => serialize(c, 0)).join('')}</${el.tagName}>`;
            }
            const content = children.filter(c => c.nodeType !== Node.TEXT_NODE)
                .map(c => c.nodeType === Node.ELEMENT_NODE ? serialize(c, depth + 1) : `${indent}  ${serialize(c, 0)}`)
                .join('\n');
            return `${indent}<${el.tagName}${attrs}>\n${content}\n${indent}</${el.tagName}>`;
        };
        return Array.from(doc.childNodes).map(node => serialize(node, 0)).join('\n');
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
