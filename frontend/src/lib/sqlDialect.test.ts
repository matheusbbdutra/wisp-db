import {describe, it, expect} from 'vitest';
import {normalizeDialect, quoteIdent, qualifyTable} from './sqlDialect';

describe('sqlDialect', () => {
    describe('normalizeDialect', () => {
        it('maps postgres drivers to postgres', () => {
            expect(normalizeDialect('postgres')).toBe('postgres');
            expect(normalizeDialect('PostgreSQL')).toBe('postgres');
            expect(normalizeDialect('pgx')).toBe('postgres');
        });

        it('maps sqlite drivers to sqlite', () => {
            expect(normalizeDialect('sqlite')).toBe('sqlite');
            expect(normalizeDialect('SQLite')).toBe('sqlite');
            expect(normalizeDialect('  sqlite  ')).toBe('sqlite');
        });

        it('maps mysql and mariadb drivers to mysql', () => {
            expect(normalizeDialect('mysql')).toBe('mysql');
            expect(normalizeDialect('MySQL')).toBe('mysql');
            expect(normalizeDialect('mariadb')).toBe('mysql');
            expect(normalizeDialect('MariaDB')).toBe('mysql');
        });

        it('defaults unknown or empty drivers to postgres', () => {
            expect(normalizeDialect('')).toBe('postgres');
            expect(normalizeDialect('unknown_db')).toBe('postgres');
        });
    });

    describe('quoteIdent', () => {
        it('quotes identifiers with double quotes for postgres', () => {
            expect(quoteIdent('users', 'postgres')).toBe('"users"');
            expect(quoteIdent('order_items', 'postgres')).toBe('"order_items"');
            expect(quoteIdent('select', 'postgres')).toBe('"select"');
        });

        it('quotes identifiers with double quotes for sqlite', () => {
            expect(quoteIdent('users', 'sqlite')).toBe('"users"');
            expect(quoteIdent('orders', 'sqlite')).toBe('"orders"');
        });

        it('quotes identifiers with backticks for mysql', () => {
            expect(quoteIdent('users', 'mysql')).toBe('`users`');
            expect(quoteIdent('order_items', 'mysql')).toBe('`order_items`');
            expect(quoteIdent('group', 'mysql')).toBe('`group`');
        });

        it('escapes embedded double quotes by doubling them in postgres and sqlite', () => {
            expect(quoteIdent('user"table', 'postgres')).toBe('"user""table"');
            expect(quoteIdent('user"table', 'sqlite')).toBe('"user""table"');
            expect(quoteIdent('a"b"c', 'postgres')).toBe('"a""b""c"');
            expect(quoteIdent('"""', 'postgres')).toBe('""""""""');
        });

        it('escapes embedded backticks by doubling them in mysql', () => {
            expect(quoteIdent('user`table', 'mysql')).toBe('`user``table`');
            expect(quoteIdent('a`b`c', 'mysql')).toBe('`a``b``c`');
            expect(quoteIdent('```', 'mysql')).toBe('` SixBackticks `'.replace(' SixBackticks ', '``````'));
        });

        it('preserves other quote styles without unnecessary escaping', () => {
            expect(quoteIdent('user`table', 'postgres')).toBe('"user`table"');
            expect(quoteIdent('user"table', 'mysql')).toBe('`user"table`');
        });
    });

    describe('qualifyTable', () => {
        describe('postgres', () => {
            it('qualifies schema and table with double quotes', () => {
                expect(qualifyTable('public', 'users', 'postgres')).toBe('"public"."users"');
                expect(qualifyTable('auth', 'sessions', 'postgres')).toBe('"auth"."sessions"');
            });

            it('returns only quoted table when schema is undefined or empty', () => {
                expect(qualifyTable(undefined, 'users', 'postgres')).toBe('"users"');
                expect(qualifyTable('', 'users', 'postgres')).toBe('"users"');
                expect(qualifyTable('   ', 'users', 'postgres')).toBe('"users"');
            });

            it('omits schema when schema is main', () => {
                expect(qualifyTable('main', 'users', 'postgres')).toBe('"users"');
            });

            it('escapes embedded double quotes in schema and table', () => {
                expect(qualifyTable('my"schema', 'my"table', 'postgres')).toBe('"my""schema"."my""table"');
            });
        });

        describe('sqlite', () => {
            it('omits schema when schema is main', () => {
                expect(qualifyTable('main', 'customers', 'sqlite')).toBe('"customers"');
            });

            it('omits schema when schema is undefined or empty', () => {
                expect(qualifyTable(undefined, 'customers', 'sqlite')).toBe('"customers"');
                expect(qualifyTable('', 'customers', 'sqlite')).toBe('"customers"');
            });

            it('qualifies attached database schema', () => {
                expect(qualifyTable('attached_db', 'items', 'sqlite')).toBe('"attached_db"."items"');
            });

            it('escapes embedded double quotes', () => {
                expect(qualifyTable('db"1', 'item"2', 'sqlite')).toBe('"db""1"."item""2"');
            });
        });

        describe('mysql', () => {
            it('qualifies database and table with backticks', () => {
                expect(qualifyTable('mydb', 'users', 'mysql')).toBe('`mydb`.`users`');
                expect(qualifyTable('reporting', 'orders', 'mysql')).toBe('`reporting`.`orders`');
            });

            it('omits schema when schema is def (default catalog)', () => {
                expect(qualifyTable('def', 'users', 'mysql')).toBe('`users`');
            });

            it('omits schema when schema is undefined, empty, or main', () => {
                expect(qualifyTable(undefined, 'users', 'mysql')).toBe('`users`');
                expect(qualifyTable('', 'users', 'mysql')).toBe('`users`');
                expect(qualifyTable('main', 'users', 'mysql')).toBe('`users`');
            });

            it('escapes embedded backticks in schema and table', () => {
                expect(qualifyTable('my`db', 'my`table', 'mysql')).toBe('`my``db`.`my``table`');
            });
        });
    });
});
