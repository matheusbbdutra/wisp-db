import {describe, it, expect} from 'vitest';
import {
    formatPreviewValue,
    buildUpdatePreview,
    buildDeletePreview,
    buildInsertPreview,
    coerceEditedValue,
    coerceInsertValue,
} from './gridEditPreview';

describe('gridEditPreview', () => {
    describe('formatPreviewValue', () => {
        it('formats null and undefined as NULL', () => {
            expect(formatPreviewValue(null)).toBe('NULL');
            expect(formatPreviewValue(undefined)).toBe('NULL');
        });

        it('formats numbers and booleans verbatim', () => {
            expect(formatPreviewValue(123)).toBe('123');
            expect(formatPreviewValue(0)).toBe('0');
            expect(formatPreviewValue(true)).toBe('true');
            expect(formatPreviewValue(false)).toBe('false');
        });

        it('wraps strings in quotes and escapes embedded single quotes', () => {
            expect(formatPreviewValue('hello')).toBe("'hello'");
            expect(formatPreviewValue("O'Connor")).toBe("'O''Connor'");
        });
    });

    describe('buildUpdatePreview', () => {
        it('builds postgres UPDATE with double quotes', () => {
            const sql = buildUpdatePreview(
                'public',
                'users',
                ['id'],
                [1],
                'email',
                'old@example.com',
                'new@example.com',
                'postgres',
            );
            expect(sql).toBe(
                'UPDATE "public"."users" SET "email" = \'new@example.com\' WHERE "id" = 1 AND "email" = \'old@example.com\'',
            );
        });

        it('builds sqlite UPDATE with main schema omitted', () => {
            const sql = buildUpdatePreview(
                'main',
                'users',
                ['id'],
                [1],
                'name',
                'Old',
                'New',
                'sqlite',
            );
            expect(sql).toBe('UPDATE "users" SET "name" = \'New\' WHERE "id" = 1 AND "name" = \'Old\'');
        });

        it('builds mysql UPDATE with backticks and def omitted', () => {
            const sql = buildUpdatePreview(
                'def',
                'users',
                ['id'],
                [10],
                'name',
                'Old',
                'New',
                'mysql',
            );
            expect(sql).toBe('UPDATE `users` SET `name` = \'New\' WHERE `id` = 10 AND `name` = \'Old\'');
        });

        it('builds mysql UPDATE with custom database qualification', () => {
            const sql = buildUpdatePreview(
                'ecommerce',
                'orders',
                ['order_id', 'line_id'],
                [100, 1],
                'status',
                'pending',
                'shipped',
                'mysql',
            );
            expect(sql).toBe(
                'UPDATE `ecommerce`.`orders` SET `status` = \'shipped\' WHERE `order_id` = 100 AND `line_id` = 1 AND `status` = \'pending\'',
            );
        });

        it('handles null values in PK and column', () => {
            const sql = buildUpdatePreview(
                'public',
                'data',
                ['id'],
                [null],
                'val',
                null,
                'new',
                'postgres',
            );
            expect(sql).toBe('UPDATE "public"."data" SET "val" = \'new\' WHERE "id" IS NULL AND "val" IS NULL');
        });
    });

    describe('buildDeletePreview', () => {
        it('builds postgres DELETE with double quotes', () => {
            const sql = buildDeletePreview('public', 'users', ['id'], [42], 'postgres');
            expect(sql).toBe('DELETE FROM "public"."users" WHERE "id" = 42');
        });

        it('builds mysql DELETE with backticks', () => {
            const sql = buildDeletePreview('mydb', 'users', ['id'], [42], 'mysql');
            expect(sql).toBe('DELETE FROM `mydb`.`users` WHERE `id` = 42');
        });

        it('builds composite PK DELETE for sqlite', () => {
            const sql = buildDeletePreview('main', 'items', ['cat_id', 'item_id'], [1, 2], 'sqlite');
            expect(sql).toBe('DELETE FROM "items" WHERE "cat_id" = 1 AND "item_id" = 2');
        });
    });

    describe('buildInsertPreview', () => {
        it('builds postgres INSERT with double quotes', () => {
            const sql = buildInsertPreview('public', 'users', ['name', 'age'], ['Alice', 30], 'postgres');
            expect(sql).toBe('INSERT INTO "public"."users" ("name", "age") VALUES (\'Alice\', 30)');
        });

        it('builds mysql INSERT with backticks', () => {
            const sql = buildInsertPreview('mydb', 'users', ['name', 'age'], ['Bob', 25], 'mysql');
            expect(sql).toBe('INSERT INTO `mydb`.`users` (`name`, `age`) VALUES (\'Bob\', 25)');
        });

        it('builds sqlite INSERT omitting main schema', () => {
            const sql = buildInsertPreview('main', 'users', ['name'], ['Charlie'], 'sqlite');
            expect(sql).toBe('INSERT INTO "users" ("name") VALUES (\'Charlie\')');
        });
    });

    describe('coerceEditedValue and coerceInsertValue', () => {
        it('coerces edited values', () => {
            expect(coerceEditedValue(10, '20')).toBe(20);
            expect(coerceEditedValue(10, 'invalid')).toBe('invalid');
            expect(coerceEditedValue(true, 'false')).toBe(false);
            expect(coerceEditedValue('text', 'newtext')).toBe('newtext');
        });

        it('coerces insert values based on column type', () => {
            expect(coerceInsertValue('integer', '123')).toBe(123);
            expect(coerceInsertValue('bool', 'true')).toBe(true);
            expect(coerceInsertValue('varchar', 'test')).toBe('test');
        });
    });
});
