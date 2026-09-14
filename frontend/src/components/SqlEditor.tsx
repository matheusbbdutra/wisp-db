import {useEffect, useRef} from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';

declare global {
    interface Window {
        MonacoEnvironment?: monaco.Environment;
    }
}

// Bundle 100% local dos workers do Monaco (sem CDN) — necessário para o
// Wisp funcionar offline. Só carregamos o worker base + json (usado
// internamente pelo editor); SQL usa apenas highlighting léxico simples,
// sem language service próprio (ver docs/ARCHITECTURE.md: "sem parser
// SQL customizado" — autocomplete real entra na Fase 2 via schema cache).
self.MonacoEnvironment = {
    getWorker(_: string, label: string) {
        if (label === 'json') return new jsonWorker();
        return new editorWorker();
    },
};

interface Props {
    value: string;
    onChange: (value: string) => void;
    onRunRequested: () => void;
    readOnly?: boolean;
}

export default function SqlEditor({value, onChange, onRunRequested, readOnly}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const onChangeRef = useRef(onChange);
    const onRunRef = useRef(onRunRequested);
    onChangeRef.current = onChange;
    onRunRef.current = onRunRequested;

    useEffect(() => {
        if (!containerRef.current) return;

        const editor = monaco.editor.create(containerRef.current, {
            value,
            language: 'sql',
            theme: 'vs-dark',
            automaticLayout: true,
            minimap: {enabled: false},
            fontSize: 14,
            readOnly: readOnly ?? false,
        });
        editorRef.current = editor;

        editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current());

        return () => editor.dispose();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const editor = editorRef.current;
        if (editor && editor.getValue() !== value) {
            editor.setValue(value);
        }
    }, [value]);

    return <div ref={containerRef} style={{height: '100%', width: '100%'}} />;
}
