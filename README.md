# Finança Pessoal — Backend com SQL + Autenticação

Sistema de finanças pessoais com backend próprio (Node.js + Express),
banco de dados SQL (SQLite via `better-sqlite3`), autenticação por
login/senha (JWT) e edição/exclusão individual de despesas.

## O que mudou em relação à versão anterior

- **Antes**: tudo em `localStorage` do navegador, sem usuários, sem servidor.
- **Agora**:
  - Banco de dados SQL real (SQLite), com tabelas `usuarios`, `despesas`,
    `despesas_futuras`, `devedores`, `rendas`.
  - Login/senha com hash `bcrypt` e sessão via token `JWT`.
  - Cada usuário só enxerga e altera os próprios dados (isolamento por `usuario_id`
    em todas as queries).
  - **Edição individual de despesa** (título, valor, dia, categoria, status) —
    o que faltava antes.
  - **Exclusão individual de despesa** — remove só o registro clicado, sem afetar
    outras parcelas do mesmo grupo.
  - Exclusão em lote continua disponível para despesas parceladas (remove a
    parcela atual + as futuras, mantendo as já passadas).

## Estrutura do projeto

```
financeiro/
├── package.json
├── .env.example          # copie para .env e ajuste
├── backend/
│   ├── server.js         # servidor Express (ponto de entrada)
│   ├── db/
│   │   ├── schema.sql    # definição das tabelas SQL
│   │   ├── connection.js # abre o SQLite e aplica o schema automaticamente
│   │   └── init.js       # script opcional para inicializar/inspecionar o banco
│   ├── middleware/
│   │   └── auth.js       # valida o JWT em rotas protegidas
│   └── routes/
│       ├── auth.js       # /api/auth/registrar, /login, /me
│       ├── despesas.js   # CRUD de despesas mensais (inclui editar/excluir individual)
│       ├── futuras.js    # CRUD de despesas futuras
│       ├── devedores.js  # CRUD de devedores
│       └── rendas.js     # CRUD de rendas
└── public/
    └── index.html        # frontend (mesmo visual de antes, agora consumindo a API)
```

## Como rodar

### 1. Pré-requisitos
- Node.js 18 ou superior instalado.

### 2. Instalar dependências
```bash
cd financeiro
npm install
```

### 3. Configurar variáveis de ambiente
```bash
cp .env.example .env
```
Abra o `.env` e troque o `JWT_SECRET` por um valor aleatório e seguro. Você pode gerar um com:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4. Iniciar o servidor
```bash
npm start
```
O servidor sobe em `http://localhost:3000` (ou na porta definida em `PORT` no `.env`).
O banco SQLite é criado automaticamente na primeira execução, junto com todas as tabelas.

> **Já tinha o banco de uma versão anterior?** Sem problema — ao subir, o servidor
> aplica automaticamente uma migração (`backend/db/migrate.js`) que adiciona as
> colunas/tabelas novas (dica de senha, despesa fixa, recebimento de devedor, saldo
> transferido) sem apagar nenhum dado existente. Isso roda sozinho, não precisa
> executar nada manualmente.

### 5. Usar o app
Abra `http://localhost:3000` no navegador. Na primeira vez, clique em **"Criar conta"**,
cadastre-se com nome/e-mail/senha, e comece a usar. Todos os dados ficam vinculados
à sua conta no banco SQLite (`backend/db/financeiro.sqlite`).

## Editar e excluir despesas individualmente

Na aba **Despesas Mensais**, cada linha da tabela agora tem dois botões à direita:
- **✏️ Editar** — abre um modal para alterar título, valor, dia de vencimento,
  categoria e status daquele registro específico. Se for uma parcela, só aquela
  parcela é alterada; as demais permanecem intactas.
- **✕ Excluir** — remove o registro. Se for uma despesa parcelada, você escolhe entre
  excluir só aquela parcela ou a parcela atual + as futuras do mesmo grupo.

## Endpoints da API

Todas as rotas abaixo (exceto `/auth/registrar` e `/auth/login`) exigem o header:
```
Authorization: Bearer <token>
```

### Autenticação
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/registrar` | Cria uma conta (`nome`, `email`, `senha`, `dicaSenha` opcional) |
| POST | `/api/auth/login` | Login (`email`, `senha`), retorna `token` |
| POST | `/api/auth/dica-senha` | Retorna a dica de senha cadastrada para um e-mail |
| GET | `/api/auth/me` | Retorna os dados do usuário logado |

### Despesas mensais
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/despesas?ano=2026&mes=7` | Lista despesas do período (gera ocorrências de despesas fixas sob demanda) |
| POST | `/api/despesas` | Cria despesa, parcelas (`parcelado`) ou despesa fixa (`fixa`) |
| PUT | `/api/despesas/:id` | **Edita uma despesa específica** |
| PATCH | `/api/despesas/:id/status` | Alterna pago/aguardando |
| DELETE | `/api/despesas/:id` | **Exclui uma despesa específica** |
| DELETE | `/api/despesas/grupo/:gid?aPartirDe=:id` | Exclui parcela atual + futuras do grupo |
| DELETE | `/api/despesas/grupo-fixo/:fid?aPartirDe=:id` | Encerra uma despesa fixa (a partir do mês indicado) |

### Despesas futuras, devedores
Seguem o mesmo padrão REST (`GET`, `POST`, `PUT`, `PATCH /status`, `DELETE`) em
`/api/futuras` e `/api/devedores`. Em devedores, `PATCH /:id/status` também cria/remove
automaticamente a renda vinculada ao recebimento.

### Rendas
| Método | Rota | Descrição |
|---|---|---|
| GET / POST / DELETE | `/api/rendas` | CRUD padrão |
| POST | `/api/rendas/transferir-saldo` | Soma o saldo de `{mes,ano}` como renda no mês seguinte |
| GET | `/api/rendas/saldo-transferido?ano=&mes=` | Verifica se o saldo daquele mês já foi transferido |

## Segurança implementada

- Senhas armazenadas com hash `bcrypt` (nunca em texto puro).
- Autenticação via JWT assinado com chave secreta (`JWT_SECRET`).
- Toda query de leitura/escrita filtra por `usuario_id`, garantindo que um usuário
  nunca acesse ou altere dados de outro.
- Validações de entrada (valores positivos, dias entre 1-31, status válido, etc.)
  tanto no banco (constraints `CHECK`) quanto nas rotas.

## Novidades desta atualização

- **Dica de senha**: campo opcional no cadastro. Na tela de login, "Esqueci minha
  senha" busca a dica pelo e-mail informado (rota `POST /api/auth/dica-senha`).
- **Mostrar/ocultar senha**: botão de olho (👁) em todos os campos de senha do login e cadastro.
- **Layout centralizado**: o conteúdo do site agora fica centralizado na tela em
  monitores largos (antes ficava colado à esquerda).
- **Seletor de mês redesenhado**: cápsula destacada com ícone de calendário, tanto
  no topo (desktop) quanto na barra mobile.
- **Recebimento de devedor vira renda automaticamente**: ao marcar um devedor como
  recebido, o valor é somado à renda do mês em que o recebimento foi confirmado
  (não do mês de cadastro da dívida). Reverter o status remove essa renda automática.
- **Transferir saldo para o mês seguinte**: botão no card "Saldo Geral" do dashboard
  que soma o saldo (renda − despesas) do mês atual como uma renda extra no mês seguinte.
  Pode ser clicado novamente para atualizar o valor se algo mudar; não duplica.
- **Despesa fixa mensal**: checkbox "Despesa fixa" no cadastro (mutuamente exclusivo
  com "Parcelado"). Repete automaticamente todo mês até o usuário excluí-la — a
  ocorrência do mês é gerada sob demanda, ao navegar até aquele mês no app.
  Excluir uma despesa fixa oferece a opção de remover só aquele mês ou encerrá-la
  definitivamente (o histórico de meses passados é preservado).
- **Status de devedor**: pendente agora exibe "⏳ Aguardando pagamento" em vez de
  apenas "Aguardando".
- **Calendário do mês**: grade visual no dashboard mostrando em quais dias há
  despesas e o total de cada dia (verde = tudo pago, vermelho = pendente).
- **Painel "Vence hoje"**: lista dedicada no dashboard com as despesas que vencem
  no dia atual.
- **Notificações do navegador**: ao entrar no app, é solicitada permissão para
  notificações nativas do navegador; despesas vencidas ou que vencem hoje disparam
  uma notificação (uma vez por dia por despesa, para não repetir).
- **Cadastro rápido de despesa no dashboard**: botão "📋 Cadastrar" no card
  "Despesas do mês" abre um popup para lançar uma despesa sem trocar de aba,
  no mesmo padrão do botão "💵 Gerenciar" de renda.

## Próximos passos sugeridos (opcional)

- Trocar SQLite por PostgreSQL em produção (o `schema.sql` é quase 100% compatível;
  principais ajustes: `AUTOINCREMENT` → `SERIAL`/`IDENTITY`, `datetime('now')` → `now()`).
- Adicionar refresh token e expiração mais curta do JWT de acesso.
- Adicionar rate limiting no `/api/auth/login` contra força bruta.
- Deploy: qualquer serviço que rode Node.js (Render, Railway, Fly.io, VPS, etc.).
