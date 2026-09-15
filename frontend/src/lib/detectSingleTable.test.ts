import {describe, expect, it} from 'vitest';
import {detectSingleTable} from './detectSingleTable';

describe('detectSingleTable', () => {
    it.each([
        'SELECT * FROM customers',
        'SELECT * FROM customers WHERE id = 1',
    ])('detecta tabela simples: %s', query => {
        expect(detectSingleTable(query)).toEqual({schema: null, table: 'customers'});
    });

    // Bug real corrigido: schema sem aspas (caso comum) agora é detectado
    // igual ao caso com aspas.
    it.each([
        'SELECT * FROM public.customers',
        'SELECT * FROM "public".customers',
        'SELECT * FROM "public"."customers"',
    ])('detecta schema qualificado: %s', query => {
        expect(detectSingleTable(query)).toEqual({schema: 'public', table: 'customers'});
    });

    it.each([
        'SELECT * FROM a JOIN b ON a.id = b.id',
        'SELECT * FROM (SELECT * FROM customers) AS nested',
        'SELECT * FROM customers WHERE id IN (SELECT id FROM orders)',
        '',
        'isto não é SQL',
        'SELECT',
        'SELECT * FROM',
    ])('rejeita consulta não suportada: %s', query => {
        expect(detectSingleTable(query)).toBeNull();
    });
});
