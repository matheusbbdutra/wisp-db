import {describe, expect, it} from 'vitest';
import {splitStatements, resolveStatementAtOffset, resolveStatementTargetAtOffset} from './sqlStatements';

describe('splitStatements', () => {
    it('divide statements por ponto e vírgula', () => {
        const sql = 'SELECT 1;\nSELECT 2;';
        const stmts = splitStatements(sql);
        expect(stmts).toHaveLength(2);
        expect(stmts[0].text).toBe('SELECT 1');
        expect(stmts[1].text).toBe('SELECT 2');
    });

    it('divide statements por linhas em branco sem ponto e vírgula', () => {
        const sql = 'SELECT 1\n\nSELECT 2';
        const stmts = splitStatements(sql);
        expect(stmts).toHaveLength(2);
        expect(stmts[0].text).toBe('SELECT 1');
        expect(stmts[1].text).toBe('SELECT 2');
    });

    it('divide statements com ponto e vírgula seguido de linha em branco sem duplicar vazios', () => {
        const sql = 'SELECT 1;\n\nSELECT 2;';
        const stmts = splitStatements(sql);
        expect(stmts).toHaveLength(2);
        expect(stmts[0].text).toBe('SELECT 1');
        expect(stmts[1].text).toBe('SELECT 2');
    });

    it('ignora ponto e vírgula e quebras dentro de strings', () => {
        const sql = "SELECT 'hello;world\n\nfoo' AS str;\nSELECT 2;";
        const stmts = splitStatements(sql);
        expect(stmts).toHaveLength(2);
        expect(stmts[0].text).toBe("SELECT 'hello;world\n\nfoo' AS str");
        expect(stmts[1].text).toBe('SELECT 2');
    });

    it('lida com aspas simples escapadas em SQL', () => {
        const sql = "SELECT 'it''s a ; test' AS val;\nSELECT 2;";
        const stmts = splitStatements(sql);
        expect(stmts).toHaveLength(2);
        expect(stmts[0].text).toBe("SELECT 'it''s a ; test' AS val");
        expect(stmts[1].text).toBe('SELECT 2');
    });

    it('ignora ponto e vírgula dentro de comentários de linha e de bloco', () => {
        const sql = "-- comentario com ; e \nSELECT 1;\n/* bloco com ; e \n\n */\nSELECT 2;";
        const stmts = splitStatements(sql);
        expect(stmts).toHaveLength(2);
        expect(stmts[0].text).toContain('SELECT 1');
        expect(stmts[1].text).toContain('SELECT 2');
    });

    it('lida com texto vazio ou apenas espaços', () => {
        expect(splitStatements('')).toEqual([]);
        expect(splitStatements('   \n\n  \t \n ')).toEqual([]);
    });

    it('lida com múltiplos pontos e vírgulas consecutivos', () => {
        const sql = 'SELECT 1;;;\nSELECT 2;';
        const stmts = splitStatements(sql);
        expect(stmts).toHaveLength(2);
        expect(stmts[0].text).toBe('SELECT 1');
        expect(stmts[1].text).toBe('SELECT 2');
    });
});

describe('resolveStatementAtOffset', () => {
    const sql = 'SELECT 1;\n\nSELECT 2;';

    it('resolve SELECT 1 no início, meio e fim do primeiro statement', () => {
        // "SELECT 1;" tem 9 caracteres (índices 0..8)
        expect(resolveStatementAtOffset(sql, 0)).toBe('SELECT 1');
        expect(resolveStatementAtOffset(sql, 4)).toBe('SELECT 1');
        expect(resolveStatementAtOffset(sql, 8)).toBe('SELECT 1');
        // Logo após o ';' (offset 9) e na linha em branco (offset 10)
        expect(resolveStatementAtOffset(sql, 9)).toBe('SELECT 1');
        expect(resolveStatementAtOffset(sql, 10)).toBe('SELECT 1');
    });

    it('resolve SELECT 2 quando cursor está sobre o segundo statement', () => {
        // "SELECT 2;" começa no índice 11
        expect(resolveStatementAtOffset(sql, 11)).toBe('SELECT 2');
        expect(resolveStatementAtOffset(sql, 15)).toBe('SELECT 2');
        expect(resolveStatementAtOffset(sql, 19)).toBe('SELECT 2');
        expect(resolveStatementAtOffset(sql, 20)).toBe('SELECT 2');
    });

    it('resolve statement único sem ponto e vírgula', () => {
        const single = 'SELECT * FROM users';
        expect(resolveStatementAtOffset(single, 0)).toBe('SELECT * FROM users');
        expect(resolveStatementAtOffset(single, 10)).toBe('SELECT * FROM users');
        expect(resolveStatementAtOffset(single, single.length)).toBe('SELECT * FROM users');
    });

    it('nunca junta múltiplos statements quando cursor está posicionado em um deles', () => {
        const multi = 'SELECT id FROM a;\nSELECT id FROM b;';
        const resA = resolveStatementAtOffset(multi, 5);
        expect(resA).toBe('SELECT id FROM a');
        expect(resA).not.toContain('FROM b');

        const resB = resolveStatementAtOffset(multi, 25);
        expect(resB).toBe('SELECT id FROM b');
        expect(resB).not.toContain('FROM a');
    });

    it('retorna ranges precisos para cada statement em scripts batch (ADR 0014)', () => {
        const script = `
CREATE TABLE users (id int, name text);
INSERT INTO users VALUES (1, 'Alice');
UPDATE users SET name = 'Bob' WHERE id = 1;
SELECT * FROM users;
        `.trim();

        const stmts = splitStatements(script);
        expect(stmts).toHaveLength(4);
        expect(stmts[0].text).toBe('CREATE TABLE users (id int, name text)');
        expect(stmts[1].text).toBe("INSERT INTO users VALUES (1, 'Alice')");
        expect(stmts[2].text).toBe("UPDATE users SET name = 'Bob' WHERE id = 1");
        expect(stmts[3].text).toBe('SELECT * FROM users');

        // Cada range [start, end] deve englobar o texto delimitado no script original
        for (const s of stmts) {
            const rawSlice = script.slice(s.start, s.end);
            expect(rawSlice).toContain(s.text);
        }
    });
});

describe('resolveStatementTargetAtOffset', () => {
    it('retorna null para buffer vazio ou somente espaços', () => {
        expect(resolveStatementTargetAtOffset('', 0)).toBeNull();
        expect(resolveStatementTargetAtOffset('   \n\t  ', 2)).toBeNull();
    });

    it('isola perfeitamente o segundo statement com limites e pontuação intactos', () => {
        const sql = 'SELECT 1;\n\nSELECT 2 FROM users WHERE id = 1;\n\nSELECT 3;';
        // Encontra o offset do início de SELECT 2
        const offset2 = sql.indexOf('SELECT 2');
        const target = resolveStatementTargetAtOffset(sql, offset2 + 5);

        expect(target).not.toBeNull();
        expect(target!.text).toBe('SELECT 2 FROM users WHERE id = 1;');
        expect(sql.slice(target!.start, target!.end)).toBe('SELECT 2 FROM users WHERE id = 1;');
        // Garante que não invadiu o SELECT 1 nem o SELECT 3
        expect(target!.start).toBe(offset2);
        expect(sql.slice(0, target!.start)).toContain('SELECT 1;');
        expect(sql.slice(target!.end)).toContain('SELECT 3;');
    });

    it('suporta múltiplos statements sem linha em branco entre eles (somente newline)', () => {
        const sql = 'SELECT 1;\nSELECT 2;';
        const offset2 = sql.indexOf('SELECT 2');
        const target = resolveStatementTargetAtOffset(sql, offset2);

        expect(target).not.toBeNull();
        expect(target!.text).toBe('SELECT 2;');
        expect(target!.start).toBe(offset2);
        expect(sql.slice(target!.start, target!.end)).toBe('SELECT 2;');
    });

    it('mantém integridade de statement único sem ponto e vírgula', () => {
        const sql = '   SELECT * FROM table   ';
        const target = resolveStatementTargetAtOffset(sql, 8);

        expect(target).not.toBeNull();
        expect(target!.text).toBe('SELECT * FROM table');
        expect(sql.slice(target!.start, target!.end)).toBe('SELECT * FROM table');
    });

    it('permite substituir apenas o alvo formatado sem alterar o restante do documento', () => {
        const sql = 'SELECT 1;\n\nSELECT a,b FROM tbl WHERE x=1;\n\nSELECT 3;';
        const offset = sql.indexOf('SELECT a');
        const target = resolveStatementTargetAtOffset(sql, offset)!;
        expect(target).not.toBeNull();

        // Simula a formatação
        const formatted = 'SELECT\n  a,\n  b\nFROM\n  tbl\nWHERE\n  x = 1;';
        const result = sql.slice(0, target.start) + formatted + sql.slice(target.end);

        expect(result).toBe('SELECT 1;\n\nSELECT\n  a,\n  b\nFROM\n  tbl\nWHERE\n  x = 1;\n\nSELECT 3;');
        expect(result.startsWith('SELECT 1;\n\n')).toBe(true);
        expect(result.endsWith('\n\nSELECT 3;')).toBe(true);
    });
});
