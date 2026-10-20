# Véspera — plataforma de RPG do RPServer

Uma única aplicação para organizar campanhas e jogar em grupo: lobby, criação de campanhas, controles do mestre, personagens, mapa com tokens, mensagens privadas/públicas e dados. Toda a experiência usa a mesma identidade gótica, escura e legível. **Nocturne é o primeiro modelo demonstrativo de campanha**, não uma aplicação separada.

## Estrutura

```text
backend/
  server.js                 Express, HTTP e Socket.IO
  campaigns.js              Campanhas, permissões, estado e persistência
  dice.js                   Expressões de dados compartilhadas
  data/nocturne/            Sessões JSON (privado, ignorado pelo Git)
  test/                     Testes de domínio e servidor real
  scripts/browser-check.cjs Verificação desktop/mobile com Playwright
frontend/
  index.html                Entrada, lobby e mesa na mesma aplicação
  style.css                 Tokens visuais e componentes compartilhados
  app.js                    Navegação, formulários e sincronização
  map.js                    Mapa canvas, mouse, toque e teclado
docker-compose.yml          Execução e volume persistente
.env.example                Configuração sem credenciais
```

Mantém Node.js, Express 4, Socket.IO 4, CommonJS, HTML/CSS/JavaScript e canvas, sem framework, banco externo ou etapa de build. A lógica de mapa e a notação de dados do RPServer foram adaptadas ao mesmo modelo persistente das fichas e mensagens. O cliente usa **um namespace Socket.IO (`/`) e um estado por campanha**. Não existem frontends ou históricos de chat paralelos.

## Executar com Docker

Requer Docker com Compose. Na raiz, crie seu próprio `.env` a partir de `.env.example`, sem sobrescrever arquivos existentes. Preencha `RPSERVER_GM_KEY` com um segredo aleatório de no mínimo 24 caracteres; use o mesmo valor para entrar como mestre.

```powershell
docker compose config --quiet
docker compose up
```

Abra **http://localhost:3000/**. O Compose usa Node 24 e `npm ci --omit=dev`, monta backend/frontend e mantém dados no volume `nocturne-data`, em `/data/nocturne`. O nome do volume foi preservado para compatibilidade com a integração anterior. Não é mais necessário um complemento Compose para Nocturne.

```powershell
docker compose down
```

Parar/recriar o container preserva os dados. **`down -v` apaga volumes**; faça backup antes. Use `config --quiet` para validar sem imprimir variáveis resolvidas. Sem uma chave configurada, o processo inicia, mas a autenticação de mestre fica bloqueada. Convites previamente criados continuam funcionando.

## Executar com Node

Recomendado: **Node.js 24 LTS**. No PowerShell:

```powershell
cd backend
npm ci
$env:RPSERVER_GM_KEY = (node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
# Guarde a chave em local privado e use seu valor na tela de acesso do mestre.
# $env:RPSERVER_DATA_DIR = 'C:/caminho/privado/campanhas'
# $env:PORT = '3000'
npm start
```

Também pode configurar um `.env` privado e iniciar com `node --env-file=../.env server.js`. `npm start` não carrega `.env` automaticamente.

| Variável | Finalidade | Padrão |
| --- | --- | --- |
| `RPSERVER_GM_KEY` | Chave de mestre, mínimo 24 caracteres | Sem valor |
| `RPSERVER_DATA_DIR` | Diretório privado de campanhas | `backend/data/nocturne` |
| `PORT` | Porta HTTP no processo local | `3000` |

`NOCTURNE_GM_KEY` e `NOCTURNE_DATA_DIR` continuam aceitas como alternativas quando as variáveis novas não estão definidas. O Compose aceita a chave antiga como fallback e mantém o diretório no volume. A porta interna do Compose permanece 3000. Não coloque o diretório de dados dentro de `frontend/`, que é servido publicamente. Chaves não ficam no código, em URLs, `localStorage` ou `sessionStorage`; a página as mantém em memória para reconectar.

## Organizar uma campanha

1. Na entrada, selecione **Sou mestre** e informe a chave da instância. O lobby mostra as campanhas salvas. A chave de mestre dá acesso a todas as campanhas desta instância; não há contas individuais de mestres nesta versão.
2. Use **Criar campanha** para uma mesa em branco, ou **Criar a partir deste exemplo** no cartão Nocturne. Informe título, código único (2–32 letras minúsculas, números, `_` ou `-`), sistema e descrição. Abrir uma campanha existente não cria ou reinicializa seus dados.
3. Nocturne cria Alex, Bia, Caio, Dani e Rafa uma única vez nessa campanha. Tudo nas fichas pode ser editado. Campanhas em branco começam sem personagens e com d20. O cartão do modelo não representa uma sessão pública existente e não grava dados até a criação confirmada.
4. Em **Personagem**, crie quantas fichas precisar, até 30 por campanha. Elas recebem identificadores próprios; a plataforma não fica limitada aos cinco exemplos. Selecione um personagem na lateral para abrir sua ficha ou controlar seu token. A remoção é confirmada, revoga convites e apaga o token, preservando mensagens históricas.
5. Em **Ferramentas do mestre**, altere título, sistema, descrição, faces do dado padrão (2–1000), regra de teste e os nomes dos três status. Por exemplo: Vida/Mana/Corrupção ou Vitalidade/Esforço/Ferimentos. Fichas mantêm os valores atuais e máximos correspondentes, identidade, história, ocupação/classe, idade, atributos, perícias e inventário.
6. Na ficha, use **Gerar código de acesso**. Compartilhe endereço da plataforma, código da campanha, identificador do personagem e código de acesso por um canal privado. O código é exibido uma vez, com apenas seu hash salvo. Gerar outro invalida o anterior e desconecta todas as conexões daquele personagem.
7. O jogador escolhe **Sou jogador** e informa os dados recebidos. Pode editar apenas sua ficha e mover apenas seu token. Vê nomes e presença do grupo no mapa; outras fichas e mensagens privadas são filtradas no servidor.

## Jogar à mesma mesa

- **Mapa:** clique para colocar o token selecionado ou arraste-o. A grade usa coordenadas de 1200 × 760 com passos de 50; mouse e toque são suportados. Com foco no mapa, use as setas para mover. O mestre pode selecionar qualquer personagem; o jogador controla somente o seu. As posições são persistidas junto da campanha.
- **Fichas:** pressione **Salvar ficha** para gravar e sincronizar. Status atuais vão de zero ao máximo; máximos de 1 a 999. Atributos continuam editáveis, até 30 valores, com uma linha `Nome: número` por item (−999 a 9999).
- **Perícias:** em **Ferramentas do mestre → Perícias disponíveis no jogo**, o mestre define até 30 opções com seus valores iniciais, uma linha `Nome: valor` por perícia. Na ficha, **Selecionar perícias** abre uma lista com caixas de marcação: o jogador escolhe as que terá e salva a ficha. Ele não pode criar perícias nem alterar seus valores. O mestre também pode selecionar perícias para cada personagem e ajustar os valores individuais ao lado das rolagens. Alterar um valor inicial afeta novas escolhas; valores já atribuídos são preservados. Remover uma perícia do catálogo a remove das fichas e invalida os rascunhos afetados. Campanhas antigas recebem como catálogo inicial a união das perícias já presentes nas fichas, sem alterar seus valores; em nomes com valores diferentes, o valor inicial usa a última ficha na ordem salva.
- **Dados:** use expressões como `1d100`, `1d20`, `2d6+3` ou `3d20-2`. São permitidos até 20 dados de 2–1000 faces e modificador de −1000 a 1000. Os resultados são calculados no servidor, públicos e persistidos no diário. Os botões na ficha usam o dado padrão e o valor **salvo** do atributo/perícia. O mestre também pode rolar sem personagens.
- **Testes:** configure `Dado ≤ valor: sucesso` para testes percentuais ou outros testes abaixo do alvo; para `Dado + valor: total`, o atributo/perícia vira modificador. A campanha em branco usa d20 + valor e o exemplo Nocturne usa d100 ≤ valor. Resultados dependem dos valores e da regra escolhida pelo mestre; não há automação completa de sistemas comerciais.
- **Mensagens:** jogador envia ao mestre (privado) ou à mesa. Mestre envia a todos ou a um personagem. Um único diário guarda conversa e dados. O servidor filtra mensagens privadas em cada transmissão e reconexão.
- **Conflitos:** fichas e configurações têm revisões. Se outro cliente alterar a mesma ficha/configuração, o rascunho local é preservado e a gravação antiga é rejeitada. Recarregue a versão atual antes de reaplicar suas alterações.
- **Navegação:** Campanhas e Mesa atual pertencem à mesma aplicação. Voltar ao lobby preserva o rascunho e a conexão; entrar em outra campanha ou sair da mesa solicita confirmação quando houver alterações não salvas. Quedas temporárias reconectam enquanto a página estiver aberta; recarregar a página exige novo acesso.

## Persistência e compatibilidade

Cada campanha tem um arquivo `<código>.json` no diretório privado. O esquema v2 inclui metadados, regra de dados, nomes dos status, revisões, personagens, tokens, hashes de convites e as **300 mensagens mais recentes da campanha**, incluindo privadas. A gravação usa arquivo temporário e renomeação atômica; o estado em memória só muda após sucesso. Falha de disco não publica uma edição não salva. Arquivos ilegíveis aparecem indisponíveis no lobby e não são substituídos por exemplos.

Sessões JSON v1 da integração anterior são lidas com todos os personagens, valores, mensagens e hashes de convite preservados. Metadados padrão são acrescentados em memória. O arquivo passa a v2 somente após uma gravação bem-sucedida; não há migração destrutiva automática. O caminho padrão e o nome do volume antigos foram preservados. Se seus arquivos estiverem em outro diretório, configure `RPSERVER_DATA_DIR` para apontar a ele antes de iniciar.

O antigo endereço `/nocturne/` redireciona à entrada única. Os arquivos desse frontend e o namespace especial foram removidos. Os eventos antigos de entrada sem autenticação, chat e dados em memória deram lugar aos eventos autenticados de campanha, mapa e diário compartilhados. O cliente fornecido usa o protocolo novo; clientes externos baseados nos eventos antigos precisam ser adaptados. As mesas originais eram voláteis e não possuíam arquivos para migrar. Nenhuma sessão real é copiada ou apagada durante testes.

Para backup/restauração, pare o serviço, copie/restaure o diretório ou o volume privado e reinicie. Alterações manuais em arquivos com o processo aberto não atualizam o cache. Execute **um processo por diretório/volume**: o armazenamento local não coordena múltiplas réplicas. Para acesso remoto, use HTTPS e proteja o diretório de dados. Não há provedor externo de identidade nem serviços de terceiros necessários para jogar.

## Validação

No diretório `backend`:

```powershell
npm ci
npm run check
npm test
npm audit
```

Não existe etapa de build: Express serve os arquivos estáticos. As dependências de produção continuam Express e Socket.IO; `socket.io-client` é usado apenas para testes. O override de `qs` mantém a correção de segurança compatível com Express 4.

Sem Node no host, na raiz (PowerShell):

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/repo" -w /repo/backend node:24-bookworm-slim sh -c 'npm ci && npm run check && npm test && npm audit'
```

Os testes cobrem login, lobby privado, criação de campanhas, regras configuráveis, personagens dinâmicos, cinco jogadores simultâneos, mapa e permissões, dados, mensagens privadas, conflitos, revogação, falhas de disco, arquivos corrompidos, migração v1 e restauração após reinício real do processo.

Verificação visual e funcional opcional com Playwright, após `npm ci`:

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/repo" -e BROWSER_ARTIFACT_DIR=/repo/.artifacts -w /repo/backend mcr.microsoft.com/playwright:v1.56.1-noble sh -c 'npm install --prefix /tmp/browser playwright@1.56.1 && NODE_PATH=/tmp/browser/node_modules node scripts/browser-check.cjs'
```

O teste usa servidor/dados/credenciais temporários, contextos separados para mestre e jogador, e verifica entrada, lobby, criação de campanhas, mapa, fichas, ferramentas, mensagens, dados, conflitos, reconexão e encerramento de acesso em desktop e celular. Capturas são gravadas em `.artifacts/`, ignorado pelo Git, sem códigos de convite nas capturas.

## Direção visual e próximos passos

O [protótipo Nocturne](https://nocturne-rpg.divinespool32.chatgpt.site) continuou retornando HTTP 401 na inspeção. Não havia código-fonte dele no workspace. A linguagem visual foi implementada no frontend existente: verde quase preto, ouro envelhecido, serifas, ornamentos discretos, bordas e estados consistentes em todas as telas. A comparação de fidelidade com a referência depende de acesso ao protótipo. Não há iframe, incorporação ou dependência do site publicado.

Retratos, mapas com imagens, neblina de guerra, automações completas de regras, contas individuais de mestres e armazenamento distribuído ficam para etapas futuras. Os três status têm nomes configuráveis; quantidades arbitrárias de recursos exigiriam estender o esquema. A base atual comporta campanhas e listas de personagens próprias, dados genéricos e duas regras simples de teste, sem restringir a plataforma a Call of Cthulhu.
