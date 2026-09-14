/// <reference types="vite/client" />

// Submódulo sem .d.ts publicado nesta versão do monaco-editor — usado para
// registrar SQL manualmente sem importar o pacote "basic-languages" inteiro
// (ver frontend/src/components/SqlEditor.tsx).
declare module 'monaco-editor/languages/definitions/sql/sql' {
    import type * as monaco from 'monaco-editor/editor/editor.api';
    export const conf: monaco.languages.LanguageConfiguration;
    export const language: monaco.languages.IMonarchLanguage;
}
