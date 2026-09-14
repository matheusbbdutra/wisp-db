# ADR 0004 — Edição inline de células: escopo restrito por segurança de dados

**Status:** Aceito
**Data:** 2026-09-14

## Contexto
Edição inline no grid (gerar `UPDATE` automático a partir de uma célula editada) é a maior fonte potencial de corrupção silenciosa de dados de todo o produto: tabelas sem PK, PKs compostas, colunas geradas/computed e concorrência (outro processo alterando a linha entre o fetch e o save) são casos reais, não hipotéticos.

## Decisão
1. **Habilitação por capability, não por heurística.** Ao carregar metadados da tabela, backend marca `isEditable: bool` com base em PK real do catálogo (simples ou composta). Nunca assumir unicidade por nome de coluna (ex. tratar `id` como PK sem checar constraint real).
2. **Colunas geradas/computed são sempre read-only**, detectadas via metadados de catálogo (`GENERATED ALWAYS AS` no Postgres, equivalentes por dialeto).
3. **Preview do SQL antes de commitar**: o `UPDATE` gerado é mostrado ao usuário (popover/confirmação) antes de executar — nunca silencioso.
4. **Checagem otimista de concorrência**: `WHERE pk = ? AND coluna_antiga = ?` usando o valor lido no momento do fetch, não só a PK. Se `0 rows affected`, avisar o usuário explicitamente em vez de assumir sucesso.
5. Tabela sem PK detectável: grid fica **read-only com aviso visível**, nunca falha silenciosa após tentativa de salvar.

## Alternativas consideradas
- **Edição livre sem checagem de PK**: rejeitado — risco de corrupção silenciosa incompatível com um cliente de produção.
- **Parser SQL próprio para inferir PK/unicidade**: rejeitado — decisão já fixada de não construir parser customizado (ver ARCHITECTURE.md); catálogo nativo do banco já expõe essa informação de forma confiável.

## Consequências
- Escopo da Fase 3 é deliberadamente restrito: só tabelas com PK simples/composta detectável entram no MVP de edição inline.
- Exige que o `DatabaseDriver` (Strategy) exponha introspecção de PK e de colunas geradas por dialeto — isso vira parte do contrato da interface, não opcional.
