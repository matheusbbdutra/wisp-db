import {useCallback, useRef, useState} from 'react';

interface Options {
    axis: 'x' | 'y';
    initial: number;
    min: number;
    max: number;
    storageKey: string;
    // true pra painéis ANCORADOS À DIREITA (ou embaixo): o handle fica na
    // borda esquerda/superior do painel, então arrastar em direção ao painel
    // (delta negativo em X) deve AUMENTAR o tamanho — o oposto do caso padrão
    // (painel à esquerda, ex. Sidebar). Bug real encontrado em revisão de
    // código: o CellValueViewer (painel à direita) usava o hook sem inverter
    // e o arrasto respondia no sentido contrário ao cursor.
    invert?: boolean;
}

// Redimensionamento por arrasto (sidebar, split editor/grid) — persiste a
// preferência no localStorage, mesmo padrão do "Uppercase automático"
// (ver SqlEditor.tsx). Sem lib nova: Wails só renderiza uma webview comum,
// isso é CSS + mousemove/mouseup puros, nada específico de toolkit nativo.
export function useDragResize({axis, initial, min, max, storageKey, invert = false}: Options) {
    const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);
    const [size, setSize] = useState(() => {
        try {
            const stored = localStorage.getItem(storageKey);
            const parsed = stored ? parseFloat(stored) : NaN;
            if (!Number.isNaN(parsed)) return Math.min(max, Math.max(min, parsed));
        } catch {
            // localStorage indisponível (ex.: modo restrito) — usa o padrão.
        }
        return initial;
    });
    const dragStart = useRef({pos: 0, size: 0});

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        dragStart.current = {pos: axis === 'x' ? e.clientX : e.clientY, size};

        function onMouseMove(ev: MouseEvent) {
            const pos = axis === 'x' ? ev.clientX : ev.clientY;
            const delta = pos - dragStart.current.pos;
            setSize(clamp(dragStart.current.size + (invert ? -delta : delta)));
        }
        function onMouseUp() {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            setSize(current => {
                try {
                    localStorage.setItem(storageKey, String(current));
                } catch {
                    // localStorage indisponível — perde só a persistência.
                }
                return current;
            });
        }
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, [axis, size, clamp, storageKey, invert]);

    return {size, onMouseDown};
}
