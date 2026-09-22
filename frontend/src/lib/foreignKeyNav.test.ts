import {describe, it, expect} from 'vitest';
import {
    extractForeignKeyReferences,
    findForeignKeyReference,
    buildForeignKeyFilterQuery,
} from './foreignKeyNav';
import type {db} from '../../wailsjs/go/models';

describe('foreignKeyNav', () => {
    describe('extractForeignKeyReferences', () => {
        it('returns empty array when fks is null, undefined or empty', () => {
            expect(extractForeignKeyReferences(null, 'public')).toEqual([]);
            expect(extractForeignKeyReferences(undefined, 'public')).toEqual([]);
            expect(extractForeignKeyReferences([], 'public')).toEqual([]);
        });

        it('extracts single-column foreign keys with explicit schema', () => {
            const fks: db.ForeignKey[] = [
                {
                    Name: 'fk_orders_customer',
                    Columns: ['customer_id'],
                    RefSchema: 'crm',
                    RefTable: 'customers',
                    RefColumns: ['id'],
                    Definition: 'FOREIGN KEY (customer_id) REFERENCES crm.customers(id)',
                } as db.ForeignKey,
            ];

            const refs = extractForeignKeyReferences(fks, 'public');
            expect(refs).toEqual([
                {
                    column: 'customer_id',
                    targetSchema: 'crm',
                    targetTable: 'customers',
                    targetColumn: 'id',
                },
            ]);
        });

        it('falls back to defaultSchema when RefSchema is empty', () => {
            const fks: db.ForeignKey[] = [
                {
                    Name: 'fk_order_items_order',
                    Columns: ['order_id'],
                    RefSchema: '',
                    RefTable: 'orders',
                    RefColumns: ['id'],
                    Definition: '',
                } as db.ForeignKey,
            ];

            const refs = extractForeignKeyReferences(fks, 'public');
            expect(refs).toEqual([
                {
                    column: 'order_id',
                    targetSchema: 'public',
                    targetTable: 'orders',
                    targetColumn: 'id',
                },
            ]);
        });

        it('handles composite foreign keys correctly', () => {
            const fks: db.ForeignKey[] = [
                {
                    Name: 'fk_composite',
                    Columns: ['tenant_id', 'user_id'],
                    RefSchema: 'auth',
                    RefTable: 'users',
                    RefColumns: ['tenant_code', 'user_code'],
                    Definition: '',
                } as db.ForeignKey,
            ];

            const refs = extractForeignKeyReferences(fks, 'public');
            expect(refs).toEqual([
                {
                    column: 'tenant_id',
                    targetSchema: 'auth',
                    targetTable: 'users',
                    targetColumn: 'tenant_code',
                },
                {
                    column: 'user_id',
                    targetSchema: 'auth',
                    targetTable: 'users',
                    targetColumn: 'user_code',
                },
            ]);
        });
    });

    describe('findForeignKeyReference', () => {
        const refs = [
            {
                column: 'Customer_Id',
                targetSchema: 'public',
                targetTable: 'customers',
                targetColumn: 'id',
            },
        ];

        it('finds column case-insensitively', () => {
            expect(findForeignKeyReference(refs, 'customer_id')).toEqual(refs[0]);
            expect(findForeignKeyReference(refs, 'CUSTOMER_ID')).toEqual(refs[0]);
            expect(findForeignKeyReference(refs, 'other')).toBeUndefined();
        });
    });

    describe('buildForeignKeyFilterQuery', () => {
        it('builds qualified SELECT with numeric value', () => {
            const q = buildForeignKeyFilterQuery('public', 'customers', 'id', 42);
            expect(q).toBe('SELECT * FROM "public"."customers" WHERE "id" = 42 LIMIT 200');
        });

        it('handles sqlite main schema without schema prefix', () => {
            const q = buildForeignKeyFilterQuery('main', 'customers', 'id', 10);
            expect(q).toBe('SELECT * FROM "customers" WHERE "id" = 10 LIMIT 200');
        });

        it('escapes strings and handles quotes correctly', () => {
            const q = buildForeignKeyFilterQuery('public', 'users', 'email', "john's@example.com");
            expect(q).toBe('SELECT * FROM "public"."users" WHERE "email" = \'john\'\'s@example.com\' LIMIT 200');
        });

        it('handles null values with IS NULL', () => {
            const q = buildForeignKeyFilterQuery('public', 'users', 'id', null);
            expect(q).toBe('SELECT * FROM "public"."users" WHERE "id" IS NULL LIMIT 200');
        });
    });
});
