import {describe, it, expect} from 'vitest';
import {
    buildColumnCondition,
    buildFkCondition,
    buildTableQuery,
    toggleSort,
    type SortConfig,
    type TableFilterConfig,
} from './tableTabQuery';

describe('toggleSort', () => {
    it('starts with ASC when current sort is null', () => {
        expect(toggleSort(null, 'name')).toEqual({column: 'name', direction: 'ASC'});
    });

    it('toggles from ASC to DESC on the same column', () => {
        const current: SortConfig = {column: 'name', direction: 'ASC'};
        expect(toggleSort(current, 'name')).toEqual({column: 'name', direction: 'DESC'});
    });

    it('resets to null from DESC on the same column', () => {
        const current: SortConfig = {column: 'name', direction: 'DESC'};
        expect(toggleSort(current, 'name')).toBeNull();
    });

    it('resets to ASC when switching to a different column', () => {
        const current: SortConfig = {column: 'id', direction: 'DESC'};
        expect(toggleSort(current, 'name')).toEqual({column: 'name', direction: 'ASC'});
    });
});

describe('buildColumnCondition', () => {
    it('builds equality condition with postgres quoting', () => {
        const cond = buildColumnCondition({column: 'status', operator: '=', value: 'active'}, 'postgres');
        expect(cond).toBe('"status" = \'active\'');
    });

    it('builds equality condition with mysql backticks', () => {
        const cond = buildColumnCondition({column: 'status', operator: '=', value: 'active'}, 'mysql');
        expect(cond).toBe('`status` = \'active\'');
    });

    it('escapes embedded quotes in column names and values', () => {
        const condPg = buildColumnCondition({column: 'user"name', operator: '=', value: "O'Reilly"}, 'postgres');
        expect(condPg).toBe('"user""name" = \'O\'\'Reilly\'');

        const condMy = buildColumnCondition({column: 'user`name', operator: '=', value: "O'Reilly"}, 'mysql');
        expect(condMy).toBe('`user``name` = \'O\'\'Reilly\'');
    });

    it('handles comparison operators !=, >, <', () => {
        expect(buildColumnCondition({column: 'age', operator: '!=', value: '18'}, 'postgres')).toBe('"age" != \'18\'');
        expect(buildColumnCondition({column: 'score', operator: '>', value: '50'}, 'sqlite')).toBe('"score" > \'50\'');
        expect(buildColumnCondition({column: 'price', operator: '<', value: '100'}, 'mysql')).toBe('`price` < \'100\'');
    });

    it('handles LIKE operator', () => {
        const cond = buildColumnCondition({column: 'email', operator: 'LIKE', value: '%@example.com'}, 'postgres');
        expect(cond).toBe('"email" LIKE \'%@example.com\'');
    });

    it('handles IS NULL and IS NOT NULL operators without value', () => {
        expect(buildColumnCondition({column: 'deleted_at', operator: 'IS NULL', value: ''}, 'postgres')).toBe('"deleted_at" IS NULL');
        expect(buildColumnCondition({column: 'deleted_at', operator: 'IS NOT NULL', value: 'ignored'}, 'mysql')).toBe('`deleted_at` IS NOT NULL');
    });

    it('handles ILIKE on postgres with native ILIKE', () => {
        const cond = buildColumnCondition({column: 'name', operator: 'ILIKE', value: '%alice%'}, 'postgres');
        expect(cond).toBe('"name" ILIKE \'%alice%\'');
    });

    it('handles ILIKE fallback on mysql and sqlite with LOWER(...) LIKE LOWER(...)', () => {
        const condMy = buildColumnCondition({column: 'name', operator: 'ILIKE', value: '%bob%'}, 'mysql');
        expect(condMy).toBe('LOWER(`name`) LIKE LOWER(\'%bob%\')');

        const condSqlite = buildColumnCondition({column: 'name', operator: 'ILIKE', value: '%bob%'}, 'sqlite');
        expect(condSqlite).toBe('LOWER("name") LIKE LOWER(\'%bob%\')');
    });
});

describe('buildFkCondition', () => {
    it('handles null and undefined values with IS NULL', () => {
        expect(buildFkCondition({column: 'author_id', value: null}, 'postgres')).toBe('"author_id" IS NULL');
        expect(buildFkCondition({column: 'author_id', value: undefined}, 'mysql')).toBe('`author_id` IS NULL');
    });

    it('formats numeric values as-is', () => {
        expect(buildFkCondition({column: 'author_id', value: 42}, 'postgres')).toBe('"author_id" = 42');
        expect(buildFkCondition({column: 'author_id', value: 0}, 'mysql')).toBe('`author_id` = 0');
    });

    it('formats boolean values as true/false', () => {
        expect(buildFkCondition({column: 'is_active', value: true}, 'postgres')).toBe('"is_active" = true');
        expect(buildFkCondition({column: 'is_active', value: false}, 'sqlite')).toBe('"is_active" = false');
    });

    it('formats string values enclosed with single quotes and escapes single quotes', () => {
        expect(buildFkCondition({column: 'code', value: 'X100'}, 'postgres')).toBe('"code" = \'X100\'');
        expect(buildFkCondition({column: 'title', value: "Don't Panic"}, 'mysql')).toBe('`title` = \'Don\'\'t Panic\'');
    });
});

describe('buildTableQuery', () => {
    it('builds base query without filter or sort', () => {
        const sql = buildTableQuery('"users"', null, null, null, 200, 'postgres');
        expect(sql).toBe('SELECT * FROM "users" LIMIT 200');
    });

    it('builds query with fkFilter only', () => {
        const sql = buildTableQuery('"orders"', null, {column: 'customer_id', value: 10}, null, 200, 'postgres');
        expect(sql).toBe('SELECT * FROM "orders" WHERE "customer_id" = 10 LIMIT 200');
    });

    it('builds query with columnFilter only', () => {
        const filter: TableFilterConfig = {
            columnFilter: {column: 'role', operator: '=', value: 'admin'},
        };
        const sql = buildTableQuery('"users"', filter, null, null, 50, 'postgres');
        expect(sql).toBe('SELECT * FROM "users" WHERE "role" = \'admin\' LIMIT 50');
    });

    it('builds query with rawWhere only', () => {
        const filter: TableFilterConfig = {
            rawWhere: "age > 18 AND status = 'active'",
        };
        const sql = buildTableQuery('`users`', filter, null, null, 100, 'mysql');
        expect(sql).toBe("SELECT * FROM `users` WHERE (age > 18 AND status = 'active') LIMIT 100");
    });

    it('combines fkFilter and columnFilter', () => {
        const filter: TableFilterConfig = {
            columnFilter: {column: 'status', operator: '=', value: 'shipped'},
        };
        const sql = buildTableQuery('"orders"', filter, {column: 'customer_id', value: 10}, null, 200, 'postgres');
        expect(sql).toBe('SELECT * FROM "orders" WHERE "customer_id" = 10 AND "status" = \'shipped\' LIMIT 200');
    });

    it('combines fkFilter and rawWhere', () => {
        const filter: TableFilterConfig = {
            rawWhere: 'total > 100',
        };
        const sql = buildTableQuery('"orders"', filter, {column: 'customer_id', value: 10}, null, 200, 'postgres');
        expect(sql).toBe('SELECT * FROM "orders" WHERE "customer_id" = 10 AND (total > 100) LIMIT 200');
    });

    it('adds ORDER BY when sort is specified', () => {
        const sort: SortConfig = {column: 'created_at', direction: 'DESC'};
        const sql = buildTableQuery('"events"', null, null, sort, 200, 'postgres');
        expect(sql).toBe('SELECT * FROM "events" ORDER BY "created_at" DESC LIMIT 200');
    });

    it('handles sort with MySQL backticks', () => {
        const sort: SortConfig = {column: 'user_count', direction: 'ASC'};
        const sql = buildTableQuery('`stats`', null, null, sort, 50, 'mysql');
        expect(sql).toBe('SELECT * FROM `stats` ORDER BY `user_count` ASC LIMIT 50');
    });

    it('combines all clauses: table, fkFilter, filter, sort and limit', () => {
        const filter: TableFilterConfig = {
            columnFilter: {column: 'status', operator: '=', value: 'pending'},
        };
        const sort: SortConfig = {column: 'id', direction: 'DESC'};
        const sql = buildTableQuery('"public"."orders"', filter, {column: 'customer_id', value: 5}, sort, 100, 'postgres');
        expect(sql).toBe('SELECT * FROM "public"."orders" WHERE "customer_id" = 5 AND "status" = \'pending\' ORDER BY "id" DESC LIMIT 100');
    });
});
