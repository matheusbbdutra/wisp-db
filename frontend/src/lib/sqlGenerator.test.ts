import {describe, it, expect} from 'vitest';
import {
    generateSelect,
    generateInsert,
    generateUpdate,
    generateDelete,
    generateCreateTable,
    defaultValueForType,
} from './sqlGenerator';
import type {db} from '../../wailsjs/go/models';

describe('sqlGenerator', () => {
    describe('defaultValueForType', () => {
        it('returns appropriate placeholders for different SQL data types', () => {
            expect(defaultValueForType('integer')).toBe('0');
            expect(defaultValueForType('BIGINT')).toBe('0');
            expect(defaultValueForType('serial')).toBe('0');
            expect(defaultValueForType('numeric(10,2)')).toBe('0');
            expect(defaultValueForType('double precision')).toBe('0');
            expect(defaultValueForType('boolean')).toBe('false');
            expect(defaultValueForType('bool')).toBe('false');
            expect(defaultValueForType('timestamp with time zone')).toBe('CURRENT_TIMESTAMP');
            expect(defaultValueForType('DATE')).toBe('CURRENT_TIMESTAMP');
            expect(defaultValueForType('jsonb')).toBe("'{}'");
            expect(defaultValueForType('text')).toBe("''");
            expect(defaultValueForType('varchar(255)')).toBe("''");
            expect(defaultValueForType('')).toBe("''");
            expect(defaultValueForType(undefined)).toBe("''");
        });
    });

    describe('generateSelect', () => {
        it('generates standard SELECT for PostgreSQL', () => {
            const sql = generateSelect('public', 'users', 'postgres');
            expect(sql).toBe('SELECT * FROM "public"."users" LIMIT 50;');
        });

        it('generates SELECT with backticks for MySQL', () => {
            const sql = generateSelect('mydb', 'users', 'mysql');
            expect(sql).toBe('SELECT * FROM `mydb`.`users` LIMIT 50;');
        });

        it('omits def schema for MySQL', () => {
            const sql = generateSelect('def', 'users', 'mysql');
            expect(sql).toBe('SELECT * FROM `users` LIMIT 50;');
        });

        it('omits main schema for SQLite', () => {
            const sql = generateSelect('main', 'users', 'sqlite');
            expect(sql).toBe('SELECT * FROM "users" LIMIT 50;');
        });

        it('handles empty schema correctly', () => {
            const sql = generateSelect('', 'users', 'sqlite');
            expect(sql).toBe('SELECT * FROM "users" LIMIT 50;');
        });

        it('escapes embedded quotes in schema and table identifiers', () => {
            const pgSql = generateSelect('pub"lic', 'usr"tbl', 'postgres');
            expect(pgSql).toBe('SELECT * FROM "pub""lic"."usr""tbl" LIMIT 50;');

            const mySql = generateSelect('my`db', 'usr`tbl', 'mysql');
            expect(mySql).toBe('SELECT * FROM `my``db`.`usr``tbl` LIMIT 50;');
        });
    });

    describe('generateInsert', () => {
        const sampleColumns: db.Column[] = [
            {
                Name: 'id',
                Type: 'serial',
                IsPrimaryKey: true,
                IsGenerated: false,
                Nullable: false,
            } as db.Column,
            {
                Name: 'name',
                Type: 'text',
                IsPrimaryKey: false,
                IsGenerated: false,
                Nullable: false,
            } as db.Column,
            {
                Name: 'age',
                Type: 'integer',
                IsPrimaryKey: false,
                IsGenerated: false,
                Nullable: true,
            } as db.Column,
            {
                Name: 'computed_full_name',
                Type: 'text',
                IsPrimaryKey: false,
                IsGenerated: true,
                Nullable: true,
            } as db.Column,
            {
                Name: 'legacy_generated',
                Type: 'text',
                IsPrimaryKey: false,
                IsGenerated: false,
                Nullable: true,
                ...({Generated: true} as any),
            } as db.Column,
        ];

        it('excludes generated columns and generates values for PostgreSQL', () => {
            const sql = generateInsert('public', 'users', sampleColumns, 'postgres');
            expect(sql).toBe('INSERT INTO "public"."users" ("id", "name", "age") VALUES (0, \'\', 0);');
        });

        it('uses backticks for MySQL identifiers', () => {
            const sql = generateInsert('store', 'products', [
                {Name: 'sku', Type: 'varchar(64)', IsPrimaryKey: true, IsGenerated: false, Nullable: false} as db.Column,
                {Name: 'price', Type: 'decimal(10,2)', IsPrimaryKey: false, IsGenerated: false, Nullable: false} as db.Column,
            ], 'mysql');
            expect(sql).toBe('INSERT INTO `store`.`products` (`sku`, `price`) VALUES (\'\', 0);');
        });

        it('handles SQLite without schema prefix for main', () => {
            const sql = generateInsert('main', 'tasks', [
                {Name: 'title', Type: 'text', IsPrimaryKey: false, IsGenerated: false, Nullable: false} as db.Column,
                {Name: 'done', Type: 'boolean', IsPrimaryKey: false, IsGenerated: false, Nullable: false} as db.Column,
            ], 'sqlite');
            expect(sql).toBe('INSERT INTO "tasks" ("title", "done") VALUES (\'\', false);');
        });

        it('returns DEFAULT VALUES if all columns are generated or list is empty', () => {
            const sql = generateInsert('public', 'audit', [], 'postgres');
            expect(sql).toBe('INSERT INTO "public"."audit" DEFAULT VALUES;');

            const onlyGen = [
                {Name: 'gen', Type: 'text', IsPrimaryKey: false, IsGenerated: true, Nullable: true} as db.Column,
            ];
            expect(generateInsert('public', 'audit', onlyGen, 'postgres')).toBe('INSERT INTO "public"."audit" DEFAULT VALUES;');
        });
    });

    describe('generateUpdate', () => {
        const columnsWithPk: db.Column[] = [
            {Name: 'id', Type: 'integer', IsPrimaryKey: true, IsGenerated: false, Nullable: false} as db.Column,
            {Name: 'username', Type: 'varchar(50)', IsPrimaryKey: false, IsGenerated: false, Nullable: false} as db.Column,
            {Name: 'is_active', Type: 'boolean', IsPrimaryKey: false, IsGenerated: false, Nullable: false} as db.Column,
            {Name: 'calc_score', Type: 'integer', IsPrimaryKey: false, IsGenerated: true, Nullable: true} as db.Column,
        ];

        it('updates non-PK, non-generated columns using PK in WHERE for PostgreSQL', () => {
            const sql = generateUpdate('public', 'accounts', columnsWithPk, 'postgres');
            expect(sql).toBe('UPDATE "public"."accounts" SET "username" = \'\', "is_active" = false WHERE "id" = 0;');
        });

        it('uses backticks and proper qualification for MySQL', () => {
            const sql = generateUpdate('app', 'accounts', columnsWithPk, 'mysql');
            expect(sql).toBe('UPDATE `app`.`accounts` SET `username` = \'\', `is_active` = false WHERE `id` = 0;');
        });

        it('handles composite primary keys in WHERE clause', () => {
            const compositeCols: db.Column[] = [
                {Name: 'tenant_id', Type: 'integer', IsPrimaryKey: true, IsGenerated: false, Nullable: false} as db.Column,
                {Name: 'user_id', Type: 'integer', IsPrimaryKey: true, IsGenerated: false, Nullable: false} as db.Column,
                {Name: 'role', Type: 'text', IsPrimaryKey: false, IsGenerated: false, Nullable: false} as db.Column,
            ];
            const sql = generateUpdate('public', 'user_tenants', compositeCols, 'postgres');
            expect(sql).toBe('UPDATE "public"."user_tenants" SET "role" = \'\' WHERE "tenant_id" = 0 AND "user_id" = 0;');
        });

        it('appends warning comment and dummy condition when no primary key is detected', () => {
            const noPkCols: db.Column[] = [
                {Name: 'log_msg', Type: 'text', IsPrimaryKey: false, IsGenerated: false, Nullable: true} as db.Column,
                {Name: 'severity', Type: 'integer', IsPrimaryKey: false, IsGenerated: false, Nullable: true} as db.Column,
            ];
            const sql = generateUpdate('public', 'logs', noPkCols, 'postgres');
            expect(sql).toBe('UPDATE "public"."logs" SET "log_msg" = \'\', "severity" = 0 WHERE 1 = 0; -- WARNING: No primary key detected');
        });

        it('handles table with only PK columns', () => {
            const onlyPkCols: db.Column[] = [
                {Name: 'tag_id', Type: 'integer', IsPrimaryKey: true, IsGenerated: false, Nullable: false} as db.Column,
            ];
            const sql = generateUpdate('public', 'tags', onlyPkCols, 'postgres');
            expect(sql).toBe('UPDATE "public"."tags" SET "tag_id" = 0 WHERE "tag_id" = 0;');
        });
    });

    describe('generateDelete', () => {
        it('generates DELETE with PK condition for PostgreSQL', () => {
            const sql = generateDelete('public', 'users', ['id'], 'postgres');
            expect(sql).toBe('DELETE FROM "public"."users" WHERE "id" = 1;');
        });

        it('generates DELETE with backticks for MySQL', () => {
            const sql = generateDelete('mydb', 'orders', ['order_id'], 'mysql');
            expect(sql).toBe('DELETE FROM `mydb`.`orders` WHERE `order_id` = 1;');
        });

        it('handles composite primary keys in DELETE', () => {
            const sql = generateDelete('public', 'order_items', ['order_id', 'item_id'], 'postgres');
            expect(sql).toBe('DELETE FROM "public"."order_items" WHERE "order_id" = 1 AND "item_id" = 1;');
        });

        it('omits main schema in SQLite DELETE', () => {
            const sql = generateDelete('main', 'notes', ['id'], 'sqlite');
            expect(sql).toBe('DELETE FROM "notes" WHERE "id" = 1;');
        });

        it('appends warning comment and dummy condition when pkColumns is empty', () => {
            const sql = generateDelete('public', 'analytics_events', [], 'postgres');
            expect(sql).toBe('DELETE FROM "public"."analytics_events" WHERE 1 = 0; -- WARNING: No primary key detected');
        });
    });

    describe('generateCreateTable', () => {
        it('generates CREATE TABLE for PostgreSQL', () => {
            const sql = generateCreateTable('public', 'orders', 'postgres');
            expect(sql).toContain('CREATE TABLE "public"."orders"');
            expect(sql).toContain('BIGSERIAL PRIMARY KEY');
        });

        it('generates CREATE TABLE for MySQL', () => {
            const sql = generateCreateTable('shop', 'orders', 'mysql');
            expect(sql).toContain('CREATE TABLE `shop`.`orders`');
            expect(sql).toContain('AUTO_INCREMENT PRIMARY KEY');
        });

        it('generates CREATE TABLE for SQLite', () => {
            const sql = generateCreateTable('main', 'orders', 'sqlite');
            expect(sql).toContain('CREATE TABLE "orders"');
            expect(sql).toContain('AUTOINCREMENT');
        });
    });
});
