# Correções da revisão de UI — 2026-09-15

Os cinco fixes foram aplicados, sem dependências novas e sem commit. `STATE.md`, `.env` e memory MCP não foram alterados/consultados (STATE foi somente lido). Os diretórios não rastreados `receipts/` e `review-receipts/`, presentes no início, foram preservados.

## Diff resumido por arquivo

| Fix | Arquivo / linha inicial | Alteração |
| --- | --- | --- |
| 1 — aplicado | `frontend/src/lib/valueFormat.ts:35` (+31/-28) | Escape de texto e atributos, incluindo caracteres de whitespace que exigem referências numéricas para sobreviver à normalização XML. Preserva CDATA e comentários, inclusive comentários fora do elemento raiz. Folhas mantêm texto sem trim e CDATA sem reindentação interna. Conteúdo misto, xml:space preservado, declarações/instruções de processamento e DTD retornam o original. |
| 2 — aplicado | `internal/db/sqlite.go:420` (+21/-2) | Guarda ações por ID da FK, acrescenta ON DELETE/UPDATE diferentes de NO ACTION, omite lista referenciada ausente e aplica quoteIdent em tabelas/colunas. Name sintético, RefSchema e metadados das colunas permanecem iguais. |
| 2 — verificação | `internal/db/sqlite_test.go:170` (+31) | Teste de regressão com SQLite real temporário: FK composta explícita e implícita, espaços/aspas em identificadores, CASCADE, SET NULL, RESTRICT e ausência das cláusulas padrão. Reutiliza helper existente; é a forma direta de provar a reconstrução contra o driver real. |
| 3 — aplicado | `frontend/src/components/Sidebar.tsx:40`, `:88`, `:204` (+14/-3) | Estado de erro visual com classe existente e role alert; captura falhas individualmente por schema e continua o loop. Reinício e cleanup limpam loading; respostas canceladas não atualizam resultados nem erros. |
| 4 — aplicado | `frontend/src/components/ResultGrid.tsx:1`, `:217` (+15/-1) | Guarda o mapeamento anterior e compara a linha original da célula selecionada com o novo mapeamento. useLayoutEffect limpa seleção deslocada ou fora dos limites antes da pintura, preservando seleção quando o índice original permanece igual. |
| 5 — aplicado | `testdata/postgres-seed.sql:6` (+4/-4) | Remove recomendação de reaplicação via psql e promessa de idempotência. Documenta recriação com docker compose down -v seguido de up -d, incluindo aviso de remoção dos dados/volumes de teste. Nenhum comando Docker foi executado. |

## Causas e conferência dos cenários

- **Sidebar:** o finally cancelado não limpava loading e não havia catch no loop. Agora limpar a busca durante uma chamada pendente executa cleanup e reinício com loading=false; rejeitar um schema registra mensagem e permite buscar o seguinte. Conferência por leitura do fluxo, sem execução interativa no WebView. Isso não implementa timeout para chamada backend que nunca resolve nem altera refresh/expansão manual.
- **SQLite:** onDelete/onUpdate eram descartados e os identificadores/listas eram concatenados sem quoting. O teste real passou nos três casos e protege contra reincidência.
- **Grid:** reset dependia apenas do texto do filtro. Conferência manual do algoritmo: antes `[0, 1]`, seleção visual 0 => original 0; após editar a primeira linha para sair do filtro, `[1]`, visual 0 => original 1; a diferença limpa a seleção. Novo render sem célula selecionada retorna sem atualizar estado, evitando loop. Append que preserva o índice selecionado não limpa seleção. Limitação: compara índices originais, não PKs; substituição/reordenação de todo o resultado no mesmo índice e seleções sem current.cell não ganham rastreamento de identidade neste ajuste.
- **XML:** DOMParser decodifica entidades; remontagem sem escape gerava XML inválido e textContent apagava a distinção entre texto/CDATA/comentários. O serializer agora trata esses nós separadamente. XML com conteúdo misto retorna integralmente o original; nos elementos formatados, o exemplo `<r a="&quot;">A &amp; B &lt; C</r>` mantém os escapes necessários. Conferência por leitura e compilação, sem execução de DOMParser em navegador. A formatação estrutural continua normalizando whitespace entre elementos quando não existe indicação de conteúdo misto/xml:space; não promete identidade textual universal.
- **Fixture:** CREATE IF NOT EXISTS não migra schema e SERIAL permite novas linhas ao reaplicar. A documentação agora exige base recriada.

## Verificações executadas

| Comando | Resultado |
| --- | --- |
| `GOCACHE=/tmp/wisp-go-build go build ./...` | Passou, código 0, sem diagnóstico. |
| `GOCACHE=/tmp/wisp-go-build go vet ./...` | Passou, código 0, sem diagnóstico; repetido após inclusão do teste. |
| `cd frontend && npx tsc --noEmit` | Passou, código 0, sem diagnóstico. |
| `cd frontend && npm run build` | Passou, código 0. Vite emitiu avisos de anotações PURE na dependência Glide e chunk acima de 500 kB; portanto não foi uma saída livre de warnings. Não foram silenciados nem alteradas dependências fora do escopo. |
| `GOCACHE=/tmp/wisp-go-build go test ./internal/db -run TestSQLiteForeignKeyDefinitions -count=1` | Passou: `ok wisp/internal/db 0.004s`. |
| `git diff --check` | Passou. |

A primeira tentativa de `go build ./... && go vet ./...` falhou antes da compilação porque o cache padrão em `/home/matheusdutra/.cache/go-build` é somente leitura no sandbox. A solução foi apontar GOCACHE para `/tmp`, sem escalada de permissão. Lição: neste ambiente, usar cache Go em área gravável. Não houve falha de código nessa tentativa.

Todos os ajustes pedidos foram implementados. A validação visual no WebView e a execução do formatador em DOM real permanecem não realizadas; os quatro comandos obrigatórios concluíram com sucesso, com os warnings de frontend explicitados acima. Mantidas as restrições: mudança mínima, sem biblioteca nova, sem edição de STATE.md, sem acesso ao .env, sem memory MCP e sem commit.
