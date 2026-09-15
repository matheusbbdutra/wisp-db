# Revisão de correção das mudanças de UI — 2026-09-15

## Escopo e validação

Revisão do working tree, incluindo drivers, bindings Go/Wails, tabApi, grid, painel de valor, Sidebar, abas de metadados, CSS e fixture. As decisões de painel dockado e Sidebar colapsável foram preservadas. Nenhum código foi alterado; este relatório é o único arquivo criado nesta rodada. STATE.md não foi editado, .env não foi consultado e memory MCP não foi utilizado.

Validação executada: `frontend/node_modules/.bin/tsc --noEmit`, a partir de `frontend`, passou. A análise abaixo é estática, com rastreamento de chamadas e leitura do codec ByteaCodec do pgx instalado; não foram criados ou executados testes unitários, consultas a bancos ou testes de navegador/Wails. Os cenários são reproduções propostas a partir do código, não relatos de execução na interface. Não identifiquei achado crítico; há problemas médios de fidelidade de dados e comportamento e problemas baixos de estado/fixture.

## Achados

### 1. Médio — bytes binários perdem informação no transporte

**Fonte:** `internal/db/driver.go:19`, `internal/db/postgres.go:71`, `internal/db/postgres.go:117`, `internal/db/sqlite.go:509`.

**Cenário:** resultado de `SELECT decode('ff0080', 'hex') AS bin` no PostgreSQL, ou BLOB equivalente no SQLite → `normalizeCellValue` converte os bytes em string → a serialização JSON de uma string com UTF-8 inválido substitui bytes inválidos por U+FFFD. A ponte continua transportando JSON válido, mas o conteúdo original é perdido; copiar/exportar já não recupera os bytes. O `ByteaCodec.DecodeValue` do pgx instalado realmente devolve `[]byte`, portanto não se trata de um risco meramente teórico. O caminho de streaming também aplica a normalização.

**Sugestão:** diferenciar valores textuais de binários pelos metadados do driver e manter uma representação reversível para bytea/BLOB (hex/base64 identificável). Não basta documentar como conversão genérica: o comentário atual não explicita essa perda. Checar apenas UTF-8 também não distingue binário válido como UTF-8 de texto.

### 2. Médio — o formatador XML produz conteúdo inválido ou alterado

**Fonte:** `frontend/src/lib/valueFormat.ts:45`, `frontend/src/lib/valueFormat.ts:55`, `frontend/src/lib/valueFormat.ts:63`, `frontend/src/components/CellValueViewer.tsx:31`.

**Cenário:** `<r a="&quot;">A &amp; B &lt; C</r>` → DOMParser decodifica entidades → o serializador concatena atributo/texto sem escaping, produzindo aspas, `&` e `<` literais em posições inválidas. O botão Copiar copia essa versão alterada. Além disso, `<r><![CDATA[a<b]]><x/></r>` perde a seção CDATA porque, havendo um filho elemento, o percurso descarta nós não TEXT/ELEMENT; texto misto tem seus espaços alterados por trim/indentação. Comentários e instruções de processamento também são descartados.

**Sugestão:** preservar escaping e tipos de nós com XMLSerializer e não reindentar conteúdo misto ou com espaços significativos; manter o original quando não for possível garantir fidelidade. React renderiza o resultado como texto, portanto este achado não é uma alegação de XSS.

### 3. Médio — arrasto do painel direito usa sinal invertido

**Fonte:** `frontend/src/components/ResultGrid.tsx:156`, `frontend/src/components/CellValueViewer.tsx:38`, `frontend/src/lib/useDragResize.ts:35`.

**Cenário:** painel à direita com largura 320; arrastar sua borda esquerda 40 px para a esquerda deveria aumentar a largura para 360. O hook soma o deslocamento horizontal e resulta em 280: a borda se move no sentido oposto ao cursor. O hook existente é apropriado para a Sidebar à esquerda, mas esta nova utilização tem orientação inversa.

**Sugestão:** permitir direção negativa do delta nesta chamada do hook, preservando a direção dos consumidores existentes.

### 4. Médio — índices UNIQUE do SQLite aparecem como “não”

**Fonte:** `internal/db/sqlite.go:330`, `internal/db/sqlite.go:360`, `frontend/src/components/TableTab.tsx:350`.

**Cenário:** tabela com `CREATE UNIQUE INDEX` explícito → indexInfo sempre retorna false → a coluna “Único” exibe “não”. O comentário reconhece a omissão, mas a UI comunica uma resposta falsa, não ausência de informação. O DDL no tooltip não corrige essa contradição.

**Sugestão:** obter o indicador por PRAGMA index_list e associá-lo pelo nome, preferencialmente uma consulta por tabela.

### 5. Médio — definição reconstruída de FK SQLite omite semântica

**Fonte:** `internal/db/sqlite.go:379`, `internal/db/sqlite.go:403`, `frontend/src/components/TableTab.tsx:369`.

**Cenário:** FK com ON DELETE CASCADE/ON UPDATE CASCADE → as ações são lidas, mas descartadas na Definition. Com `REFERENCES parent` sem lista explícita de colunas, RefColumns fica vazio e a definição vira `REFERENCES parent ()`, que não representa uma declaração válida equivalente. Identificadores contendo espaços ou aspas também são concatenados sem quoting.

**Sugestão:** preservar ações, aplicar quoteIdent a identificadores e tratar referência implícita à PK sem gerar parênteses vazios. Identificar a definição como reconstruída, pois o contrato de ForeignKey em driver.go promete DDL completo/verbatim, algo que este caminho não fornece.

### 6. Baixo — cancelar a busca pode deixar “buscando…” permanentemente

**Fonte:** `frontend/src/components/Sidebar.tsx:88`, `frontend/src/components/Sidebar.tsx:97`, `frontend/src/components/Sidebar.tsx:106`, `frontend/src/components/Sidebar.tsx:109`.

**Cenário:** após o debounce, ListTables está em voo e searchLoading=true; o usuário limpa o campo → cleanup marca cancelled → o novo efeito retorna imediatamente e o finally antigo não limpa o indicador. A interface permanece em “buscando…” sem busca ativa. O mesmo estado pode sobreviver a desconectar/reconectar sem desmontar o componente.

**Sugestão:** encerrar explicitamente o estado de carregamento ao invalidar a busca e nos caminhos sem texto/sem schemas pendentes, vinculando atualizações à geração corrente.

### 7. Médio — erro de ListTables interrompe silenciosamente a busca global

**Fonte:** `frontend/src/components/Sidebar.tsx:96`, `frontend/src/components/Sidebar.tsx:101`, `frontend/src/components/Sidebar.tsx:105`.

**Cenário:** ListTables rejeita durante a busca sequencial → o async do setTimeout rejeita sem catch, os demais schemas não são carregados e não há mensagem de erro. O finally limpa o indicador, deixando resultados incompletos com aparência de busca concluída. Rejeitar a chamada não bloqueia a fila; o defeito é tratamento de erro e feedback.

**Sugestão:** capturar a rejeição, distinguir busca cancelada de falha vigente e oferecer erro/repetição explícitos. Definir se uma falha de schema interrompe toda a busca ou permite continuar.

### 8. Baixo — seleção antiga é usada durante mudança de filtro; edição pode tornar a troca persistente

**Fonte:** `frontend/src/components/ResultGrid.tsx:185`, `frontend/src/components/ResultGrid.tsx:210`, `frontend/src/components/ResultGrid.tsx:220`.

**Cenário transitório:** linhas A/B, seleção visual 0 em A e painel aberto; digitar filtro que mantém apenas B → filteredIndices já aponta para B enquanto gridSelection ainda contém 0 → valuePanelCell calcula B antes do efeito limpar a seleção. A proteção de limites evita crash quando a posição deixa de existir. Há uma inconsistência de render comprovável pelo fluxo; não foi verificado se um frame intermediário fica visível no WebView.

**Cenário persistente:** filtro “ativo”, duas linhas correspondentes, primeira selecionada; editar a primeira para deixar de corresponder → rows muda, filteredIndices remove a primeira, mas filterText não muda e o efeito não roda. A seleção visual 0 passa a significar a segunda linha; painel e operações seguintes sobre seleção passam a usar essa linha sem seleção explícita. O UPDATE já iniciado mantém o índice original correto: não encontrei troca de alvo nesse UPDATE.

**Sugestão:** limpar a seleção na mesma atualização de filtro e invalidar/remapear a seleção quando a identidade das linhas visíveis mudar; não limpar indiscriminadamente em todo append de paginação.

### 9. Baixo — instrução da fixture não funciona sobre o seed anterior

**Fonte:** `testdata/postgres-seed.sql:6`, `testdata/postgres-seed.sql:19`, `testdata/postgres-seed.sql:28`, `testdata/postgres-seed.sql:56`.

**Cenário:** seguir a instrução de reaplicar o arquivo no container inicializado pela versão anterior → CREATE TABLE IF NOT EXISTS não adiciona profile/updated_at/customer_id/metadata_xml → INSERTs e outras instruções que dependem dessas colunas falham. Mesmo numa base nova, reaplicar adiciona novas invoice_lines: seu SERIAL gera chaves novas, portanto ON CONFLICT DO NOTHING não torna esse trecho idempotente.

**Sugestão:** documentar exigência de base de teste nova ou fornecer atualização explícita da fixture; se prometer idempotência, usar identificadores estáveis também nas linhas sem chave natural. Nenhuma aplicação do seed foi executada nesta revisão.

## Verificação explícita dos seis pontos solicitados

1. **Tradução visual ↔ original: verificado, sem problema nos caminhos de acesso examinados com mapeamento estável.** getCellContent (299), handleCellClicked (363) e handleCellContextMenu (445) traduzem uma vez. rowHasPkValues/isCellEditable recebem índice original; directEdit/pendingEdit armazenam índice original, incluindo preview, PK e onCellSaved. markedRowsMatrix (459) limita em rowCount e traduz; rangeMatrix (477) traduz as linhas e limita as colunas. selectionTarget (492) compara seleção em espaço visual e acessa matrizes em espaço original. handleCopyCell (543), handleCopyRow (547) e targetMatrix (583) recebem menu.row já traduzido. “Ver valor…” (689) usa menu.displayRow para selecionar; valuePanelCell traduz na leitura. getBounds corretamente recebe índice visual. Não há reordenação de colunas habilitada que exija tradução adicional. A invalidação temporal é o achado 8, não uma tradução ausente.
2. **valuePanelCell: há a janela de inconsistência descrita no achado 8.** useEffect não impede o cálculo com seleção anterior no primeiro render com o filtro novo; os guards de row/column evitam indexação fatal.
3. **normalizeCellValue: problema real, achado 1.** bytea efetivamente chega como []byte; string não garante preservação de bytes inválidos em JSON. A conversão beneficia XML/texto, mas não é segura para todo []byte.
4. **Sidebar/debounce: verificado, sem problema no descarte de respostas da busca após cleanup.** clearTimeout impede início pendente; cancelled é checado antes e depois de cada await; mudanças de search/schemas/connected/tabId invalidam o efeito. Não há paralelismo interno no loop. Há os achados 6 e 7. Limite: handleRefresh e toggleSchema preexistentes não têm a mesma proteção contra respostas antigas; a garantia vale para o novo efeito de busca, não para todas as requisições da Sidebar.
5. **Colapso e fila: verificado, sem problema de promise abandonada prendendo a fila.** `frontend/src/lib/tabCallQueue.ts:13` mantém a chamada backend independente do consumidor React e executa release no finally ao resolver/rejeitar. O cancelled só interrompe o loop depois do await; desmontar não cancela a execução de withQueue. Uma chamada backend que nunca termina continuaria prendendo a fila, mas isso não é causado pelo colapso. O Map retém chaves já concluídas, comportamento preexistente distinto de deadlock.
6. **CSS/fallback: verificado, sem problema funcional.** `frontend/src/App.css:27` define --accent-blue como #2563eb e a linha 41 define --accent-color por essa variável válida. O consumidor da linha 946 passa a resolver #2563eb em vez do fallback #3b82f6. A mudança de tom é real e explicitamente documentada no CSS; não há referência circular nem variável ausente nesse caminho.

## Observações adicionais e limites

- Bindings ListIndexes/ListForeignKeys e modelos correspondem aos métodos Go e passam pela fila de tabApi. Os consumidores tratam listas nulas com `?? []`. Não identifiquei divergência de assinatura na revisão; o type-check passou.
- Eventos documentais do menu têm cleanup. O timeout de “Copiado!” dura 1,5 s e não é cancelado no unmount; isso permite feedback temporariamente obsoleto ao trocar a célula, mas não demonstra um vazamento permanente. O hook de resize só remove listeners no mouseup, limitação preexistente; não foi testado fechamento de aba durante arrasto.
- O separador novo do painel só aceita mouse (`CellValueViewer.tsx:38`), sem foco, sem semântica de separator e sem alternativa de teclado para ajustar a largura. É uma limitação concreta de acessibilidade, já compartilhada pelos separadores existentes; recomendação: controle focável com ajuste por setas e anúncio do valor. Não foi executada auditoria com leitor de tela.
- Formatação JSON usa parse/stringify e pode arredondar inteiros grandes quando o valor de origem é texto, por exemplo `{"id":9007199254740993}`. Antes de garantir cópia fiel de dados pelo visor, preservar cópia bruta ou usar representação que não perca precisão; não é necessário introduzir biblioteca para oferecer cópia bruta.
- Não há validação de execução do backend nem de layout no Wails nesta rodada. Os achados não significam que as decisões de UX devam ser revistas. Prioridade sugerida: fidelidade XML/binária, direção do resize e veracidade dos metadados; depois cancelamento/erros da busca e invalidação da seleção.

Regras mantidas até o fim: revisão sem correções, sem novos testes unitários, sem .env/memory MCP e sem modificar STATE.md. As causas e os cenários ficam persistidos neste relatório para evitar repetir hipóteses já resolvidas.
