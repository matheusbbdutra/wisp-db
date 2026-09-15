import {describe, expect, it} from 'vitest';
import {withQueue} from './tabCallQueue';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return {promise, resolve};
}

describe('withQueue', () => {
    it('serializa a mesma chave em ordem de invocação sem sobreposição', async () => {
        const events: string[] = [];
        const started = deferred();
        const release = deferred();
        const first = withQueue('same', async () => {
            events.push('primeira iniciou');
            started.resolve();
            await release.promise;
            events.push('primeira terminou');
            return 1;
        });
        const second = withQueue('same', async () => {
            events.push('segunda iniciou');
            await Promise.resolve();
            events.push('segunda terminou');
            return 2;
        });
        await started.promise;
        try {
            await Promise.resolve();
            expect(events).toEqual(['primeira iniciou']);
        } finally {
            release.resolve();
        }
        expect(await Promise.all([first, second])).toEqual([1, 2]);
        expect(events).toEqual(['primeira iniciou', 'primeira terminou', 'segunda iniciou', 'segunda terminou']);
    });

    it('permite progresso de outra chave enquanto a primeira está bloqueada', async () => {
        const started = deferred();
        const release = deferred();
        const events: string[] = [];
        const first = withQueue('independent-a', async () => {
            events.push('a iniciou');
            started.resolve();
            await release.promise;
            events.push('a terminou');
        });
        await started.promise;
        try {
            await withQueue('independent-b', async () => { events.push('b terminou'); });
            expect(events).toEqual(['a iniciou', 'b terminou']);
        } finally {
            release.resolve();
            await first;
        }
    });

    it('propaga erro e libera a próxima chamada já enfileirada', async () => {
        const failure = new Error('falha de trabalho');
        const first = withQueue('failure', async () => { throw failure; });
        const second = withQueue('failure', async () => 'continuou');
        await expect(first).rejects.toBe(failure);
        await expect(second).resolves.toBe('continuou');
    });
});
