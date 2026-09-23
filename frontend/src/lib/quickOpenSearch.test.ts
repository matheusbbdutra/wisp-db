import {describe, it, expect} from 'vitest';
import {filterAndSortCatalog} from './quickOpenSearch';
import type {db} from '../../wailsjs/go/models';

function mockTable(schema: string, name: string, kind: string = 'table'): db.Table {
    return {
        Schema: schema,
        Name: name,
        Kind: kind,
        Columns: [],
    } as unknown as db.Table;
}

describe('filterAndSortCatalog', () => {
    const sampleTables: db.Table[] = [
        mockTable('public', 'users'),
        mockTable('public', 'user_roles'),
        mockTable('public', 'orders'),
        mockTable('public', 'order_items'),
        mockTable('reporting', 'daily_users'),
        mockTable('reporting', 'monthly_revenue', 'view'),
    ];

    it('returns first N tables when query is empty', () => {
        const result = filterAndSortCatalog(sampleTables, '', 3);
        expect(result).toHaveLength(3);
        expect(result[0].Name).toBe('users');
    });

    it('prioritizes prefix matches over substring matches', () => {
        // Query 'user' matches 'users' (prefix), 'user_roles' (prefix), and 'daily_users' (substring)
        const result = filterAndSortCatalog(sampleTables, 'user');
        expect(result).toHaveLength(3);
        expect(result[0].Name).toBe('user_roles');
        expect(result[1].Name).toBe('users');
        expect(result[2].Name).toBe('daily_users');
    });

    it('matches by schema name', () => {
        const result = filterAndSortCatalog(sampleTables, 'reporting');
        expect(result).toHaveLength(2);
        expect(result.map(t => t.Name).sort()).toEqual(['daily_users', 'monthly_revenue']);
    });

    it('matches by qualified name schema.table', () => {
        const result = filterAndSortCatalog(sampleTables, 'public.order');
        expect(result).toHaveLength(2);
        expect(result[0].Name).toBe('order_items');
        expect(result[1].Name).toBe('orders');
    });

    it('returns empty array when nothing matches', () => {
        const result = filterAndSortCatalog(sampleTables, 'non_existent_symbol');
        expect(result).toEqual([]);
    });

    it('respects the limit argument', () => {
        const result = filterAndSortCatalog(sampleTables, 'order', 1);
        expect(result).toHaveLength(1);
    });
});
