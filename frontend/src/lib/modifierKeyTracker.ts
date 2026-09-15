// Rastreia se Ctrl/Meta está pressionado via keydown/keyup, independente do
// clique do mouse.
//
// Necessário porque nesta stack (GTK/WebKitGTK sob Wayland, ex. Hyprland)
// o MouseEvent.ctrlKey de um clique real do usuário nem sempre reflete o
// estado do teclado — confirmado testando: Ctrl+Enter funciona (atalho do
// Monaco via keydown), mas Ctrl+click no DOM chega sempre com ctrlKey=false.
// Ler o estado via keydown/keyup contorna essa fonte não confiável, em vez
// de depender do modificador embutido no próprio evento de clique.
let ctrlHeld = false;

if (typeof window !== 'undefined') {
    window.addEventListener('keydown', e => {
        if (e.key === 'Control' || e.key === 'Meta') ctrlHeld = true;
    });
    window.addEventListener('keyup', e => {
        if (e.key === 'Control' || e.key === 'Meta') ctrlHeld = false;
    });
    // Janela perdeu o foco (troca de aba/app) — não confiar em estado antigo,
    // o keyup pode nunca chegar se a tecla foi solta fora da janela.
    window.addEventListener('blur', () => {
        ctrlHeld = false;
    });
}

export function isCtrlHeld(): boolean {
    return ctrlHeld;
}
