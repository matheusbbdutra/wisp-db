import {describe, expect, it} from 'vitest';
import {splitStatements, resolveStatementAtOffset} from './sqlStatements';

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
