// Nome da aba de resultado: prefere a tabela detectada (mesma detecção que
// já embasa a edição inline, ver detectSingleTable) — "s_solicitacao" em vez
// de "SELECT * FROM sigfacil.s_solicitacao_..." truncado, que ficava sempre
// igual pra queries diferentes na mesma tabela e nunca cabia na pill (ver
// bug real do "×" escondido, corrigido separadamente com truncamento CSS).
// Sem tabela única detectável (JOIN, DDL, etc.), cai pro texto truncado.
// Extraído do ConsoleTab sem mudança de comportamento.
import i18n from '../i18n';
import {detectSingleTable} from './detectSingleTable';

export function makeResultLabel(text: string, seq: number): string {
    const trimmed = text.trim();
    if (!trimmed) return i18n.t('consoleTab.resultLabel', {seq});
    const ref = detectSingleTable(trimmed);
    if (ref) return ref.schema ? `${ref.schema}.${ref.table}` : ref.table;
    const firstLine = trimmed.split('\n')[0]?.trim();
    if (!firstLine) return i18n.t('consoleTab.resultLabel', {seq});
    return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
}
