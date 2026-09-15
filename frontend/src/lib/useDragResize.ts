import {useCallback, useRef, useState} from 'react';

interface Options {
    axis: 'x' | 'y';
    initial: number;
    min: number;
    max: number;
    storageKey: string;
}

// Redimensionamento por arrasto (sidebar, split editor/grid) — persiste a
// preferência no localStorage, mesmo padrão do "Uppercase automático"
// (ver SqlEditor.tsx). Sem lib nova: Wails só renderiza uma webview comum,
// isso é CSS + mousemove/mouseup puros, nada específico de toolkit nativo.
export function useDragResize({axis, initial, min, max, storageKey}: Options) {
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
            setSize(clamp(dragStart.current.size + (pos - dragStart.current.pos)));
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
    }, [axis, size, clamp, storageKey]);

    return {size, onMouseDown};
}
