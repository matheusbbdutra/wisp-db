# Contribuindo com o Wisp

## Antes de começar
1. Leia `docs/ARCHITECTURE.md` e os ADRs em `docs/adr/`.
2. Leia `STATE.md` para saber o que já foi decidido e o que está em andamento.
3. Leia `CLAUDE.md` se estiver usando um agente de IA para contribuir — ele define as regras específicas do projeto.

## Fluxo de trabalho
1. Toda mudança que altere uma decisão listada em `CLAUDE.md` ou `docs/adr/` precisa de um ADR novo (`docs/adr/000N-titulo.md`), não só um comentário no código.
2. PRs pequenos e focados — uma mudança lógica por PR.
3. Antes de abrir PR: `gofmt`/`goimports` no backend, lint padrão do frontend, e os itens da "Definição de pronto" em `CLAUDE.md`.

## Testes
- Testes contra drivers de banco: usar instância real (Docker local, ex. `docker run postgres`), nunca mock puro para validar comportamento de driver — mocks escondem divergência de comportamento real do dialeto.
- Não escrever teste unitário para código que ainda não existe (regra global do projeto).

## Estrutura de commits
- Mensagens em PT-BR, descrevendo o "porquê", não só o "o quê".
- Referenciar o ADR relacionado quando a mudança implementar uma decisão documentada (ex. `Implementa ADR 0002: build matrix para DuckDB`).
