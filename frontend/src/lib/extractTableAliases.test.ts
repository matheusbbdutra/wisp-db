import {describe, expect, it} from 'vitest';
import {extractTableAliases} from './extractTableAliases';

describe('extractTableAliases', () => {
    it('resolve alias simples sem AS', () => {
        const m = extractTableAliases('SELECT c.name FROM customers c');
        expect(m.get('c')).toEqual({schema: null, table: 'customers'});
    });

    it('resolve alias com AS', () => {
        const m = extractTableAliases('SELECT c.name FROM customers AS c');
        expect(m.get('c')).toEqual({schema: null, table: 'customers'});
    });

    it('resolve múltiplos aliases com JOIN', () => {
        const m = extractTableAliases(
            'SELECT c.name, o.total FROM customers c JOIN orders o ON o.customer_id = c.id'
        );
        expect(m.get('c')).toEqual({schema: null, table: 'customers'});
        expect(m.get('o')).toEqual({schema: null, table: 'orders'});
    });

    it('resolve alias com schema qualificado', () => {
        const m = extractTableAliases('SELECT c.name FROM public.customers c');
        expect(m.get('c')).toEqual({schema: 'public', table: 'customers'});
    });

    it('resolve alias com identificadores quotados', () => {
        const m = extractTableAliases('SELECT c.name FROM "Customers" AS "c"');
        expect(m.get('c')).toEqual({schema: null, table: 'Customers'});
    });

    it('registra a própria tabela quando não há alias', () => {
        const m = extractTableAliases('SELECT * FROM customers WHERE id = 1');
        expect(m.get('customers')).toEqual({schema: null, table: 'customers'});
    });

    it('não confunde LEFT/INNER/OUTER com alias', () => {
        const m = extractTableAliases(
            'SELECT * FROM customers c LEFT JOIN orders o ON o.customer_id = c.id'
        );
        expect(m.get('c')).toEqual({schema: null, table: 'customers'});
        expect(m.get('o')).toEqual({schema: null, table: 'orders'});
    });

    it('ignora subquery como fonte (FROM (SELECT ...) alias)', () => {
        const m = extractTableAliases('SELECT * FROM (SELECT 1) x');
        expect(m.size).toBe(0);
    });

    it('não confunde alias dentro de string literal', () => {
        const m = extractTableAliases("SELECT * FROM customers WHERE name = 'FROM fake x'");
        expect(m.has('x')).toBe(false);
    });
});
