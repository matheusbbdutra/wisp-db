import {describe, expect, it} from 'vitest';
import {toCSV, toInsertSQL, toMarkdownTable} from './gridCopyFormats';

describe('formatos de cópia', () => {
    it('CSV escapa vírgulas, quebras de linha e aspas em cabeçalhos e células', () => {
        expect(toCSV(['id', 'nome, completo', 'nota'], [
            [1, 'Silva, Ana', 'linha 1\nlinha 2'],
            [2, 'Ana "A"', 'linha 1\rlinha 2'],
            [3, null, 'simples'],
        ])).toBe('id,"nome, completo",nota\n1,"Silva, Ana","linha 1\nlinha 2"\n2,"Ana ""A""","linha 1\rlinha 2"\n3,NULL,simples');
    });

    it('INSERT preserva NULL literal, tipos e escapa apóstrofos', () => {
        expect(toInsertSQL(['id', 'nome', 'ativo', 'nota'], [
            [1, "D'Ávila", true, null],
            [2, 'NULL', false, undefined],
        ])).toBe("INSERT INTO table_name (id, nome, ativo, nota) VALUES (1, 'D''Ávila', TRUE, NULL), (2, 'NULL', FALSE, NULL);");
        expect(toInsertSQL(['id'], [[1]], 'customers')).toBe('INSERT INTO customers (id) VALUES (1);');
    });

    it('Markdown escapa barras verticais e normaliza quebras de linha', () => {
        expect(toMarkdownTable(['id', 'nome|nota'], [[1, 'a|b\nc'], [2, null]]))
            .toBe('| id | nome\\|nota |\n| --- | --- |\n| 1 | a\\|b c |\n| 2 | NULL |');
    });
});
