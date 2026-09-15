import {defineConfig} from 'vitest/config';

export default defineConfig({
    // Impede leitura automática de arquivos .env durante os testes.
    envDir: false,
    test: {
        environment: 'node',
    },
});
