# Constata · Procon Jaboatão (Back-end)

API do **Constata**, sistema que digitaliza as visitas de fiscalização do Procon
de Jaboatão dos Guararapes: da denúncia ao documento assinado, sem papel.

**Disciplina:** Programação para Dispositivos Móveis · 2026.2

## Equipe

| Nome | RA |
| --- | --- |
| Lucas Gabriel Maciel de Barros | 00000858201 |
| Rafael de Assis Dias Nunes | 00000859118 |
| Marconi Taibe de Andrade Filho | 00000858175 |
| Vitor dos Santos Ferreira | 00000859882 |
| Andressa Karine de Lima Amorim Miranda | 00000859891 |
| Beatriz Farias Silva | 00000845759 |

## Sumário

- [Visão geral](#visão-geral)
- [Tecnologias](#tecnologias)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Como rodar](#como-rodar)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Banco de dados](#banco-de-dados)
- [Regras de negócio](#regras-de-negócio)
- [Rotas da API](#rotas-da-api)
- [Segurança](#segurança)
- [Documento, arquivos e e-mail](#documento-arquivos-e-e-mail)
- [Publicação](#publicação)
- [Testes](#testes)

## Visão geral

API REST consumida pelo painel web e pelo app de campo
([PI4-front](https://github.com/vitorferrr/PI4-front)).

| Perfil | Onde usa | O que faz |
| --- | --- | --- |
| `admin` | Painel web | Gerencia usuários e o questionário, vê indicadores e exporta visitas |
| `gestor` | Painel web | Cria e acompanha as visitas e abre o documento |
| `fiscalizador` | App mobile | Executa a visita, responde o questionário e colhe as assinaturas |

**API em produção:** https://pi4-back-one.vercel.app

**Painel em produção:** https://pi4-front-web.vercel.app

## Tecnologias

| Uso | Biblioteca ou serviço |
| --- | --- |
| Servidor | Node.js 22+, Express 5, JavaScript (ESM) |
| Banco de dados | PostgreSQL no Supabase, Sequelize |
| Arquivos | Supabase Storage (bucket privado) |
| Autenticação | JWT (jsonwebtoken) e Argon2 |
| Validação | Zod |
| Segurança | Helmet, CORS e express-rate-limit |
| PDF | PDFKit e pngjs |
| E-mail | Nodemailer (SMTP) |
| Testes | Vitest |
| Hospedagem | Vercel |

## Estrutura do repositório

```
.
├── src/
│   ├── index.js        monta o app, confere o ambiente e conecta ao banco
│   ├── config/         variáveis de ambiente e cliente do Storage
│   ├── routes/         caminhos, perfis permitidos e validação de cada rota
│   ├── middlewares/    autenticação, perfil, propriedade, CORS, limites e erros
│   ├── controllers/    traduzem a requisição para o serviço e montam a resposta
│   ├── services/       regras de negócio
│   ├── models/         tabelas e relações (Sequelize)
│   ├── utils/          funções compartilhadas
│   ├── assets/         logos do PDF e imagem do e-mail
│   └── tests/          testes automatizados
├── scripts/
│   ├── criarAdmin.js   cria o primeiro administrador
│   └── sql/            ajustes para bancos já existentes
├── coverage/           relatório de cobertura dos testes
└── vercel.json         configuração do deploy
```

O caminho de uma requisição é: **rota → middlewares → controller → service →
model**. Cada pasta tem um `index.js` que reúne as exportações.

## Como rodar

**Pré-requisitos:** Node.js 22 ou superior, npm e um banco PostgreSQL (o projeto
usa o Supabase).

```bash
git clone https://github.com/vitorferrr/PI4-back.git
cd PI4-back
npm install
cp .env.example .env   # preencha as variáveis
npm run seed:admin     # cria o primeiro administrador
npm run dev            # http://localhost:3000
```

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Sobe o servidor com recarga automática |
| `npm run build` | Compila para `dist/` com o Babel |
| `npm start` | Roda a versão compilada |
| `npm test` | Roda os testes |
| `npm run seed:admin` | Cria o admin com `ADMIN_NOME`, `ADMIN_EMAIL` e `ADMIN_SENHA` |

## Variáveis de ambiente

O modelo está em `.env.example`. O arquivo `.env` não é versionado.

| Variável | Obrigatória | Para que serve |
| --- | --- | --- |
| `DATABASE_URL` | Sim | Conexão com o Postgres. No Supabase, use o *Transaction pooler* (porta 6543) |
| `JWT_SECRET` | Sim | Assinatura dos tokens; mínimo de 32 caracteres |
| `PORT` | Não | Porta local (padrão 3000) |
| `ALLOWED_ORIGINS` | Em produção | Sites que podem chamar a API pelo navegador, separados por vírgula. Padrão: `http://localhost:8081` |
| `ERASE_DATABASE_ON_SYNC` | Não | `true` **apaga todo o banco** na subida. Só para banco local; ignorada na Vercel |
| `SUPABASE_URL` | Para arquivos | Endereço do projeto Supabase |
| `SUPABASE_SECRET_KEY` | Para arquivos | Chave de servidor (`sb_secret_...` ou `service_role`) |
| `SUPABASE_STORAGE_BUCKET` | Para arquivos | Nome do bucket privado (`documentos`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Para e-mail | Servidor de envio |
| `EMAIL_REMETENTE` | Não | Remetente exibido (padrão: `SMTP_USER`) |
| `EMAIL_DESTINO_TESTE` | Não | Se preenchida, **todo** e-mail vai para esse endereço |
| `EMAIL_ENVIO_REAL` | Não | `true` libera o envio ao destinatário real |
| `ADMIN_NOME`, `ADMIN_EMAIL`, `ADMIN_SENHA` | Só no seed | Dados do primeiro administrador |

As variáveis são conferidas na subida. Localmente, o servidor mostra o que falta e
encerra; na Vercel, responde `503` até a configuração ser corrigida.

Nunca envie as chaves do Supabase nem a senha do SMTP para o front ou para o Git.

## Banco de dados

| Tabela | Conteúdo |
| --- | --- |
| `usuarios` | Nome, e-mail, matrícula, perfil, hash da senha e aprovação |
| `visitas` | Denunciado, dados do estabelecimento, gestor, datas, localização, status e observações |
| `visita_fiscalizadores` | Fiscal de cada visita |
| `perguntas_questionario` | Texto, tipo de resposta e ordem |
| `respostas_questionario` | Uma resposta por pergunta em cada visita |
| `documentos` | Um por visita: caminho do PDF e situação do e-mail |
| `assinaturas` | Fiscal e responsável: imagem ou recusa |
| `tokens_revogados` | Sessões encerradas pelo logout |

Na inicialização, o `sequelize.sync()` cria as tabelas que não existem. Ele
**não altera tabelas já criadas**: para um banco antigo, rode os arquivos de
`scripts/sql/`, em ordem, no SQL Editor do Supabase **antes** do deploy.

## Regras de negócio

### Visita

```
agendada ──(iniciar)──> em_andamento ──(PDF gerado)──> concluida
    │                         │
    └──────(cancelar)─────────┴──> cancelada
```

- Toda visita tem exatamente **um** fiscalizador, já aprovado.
- Iniciar exige latitude e longitude.
- Só é possível trocar o fiscalizador de visitas agendadas.
- Depois de gerado o documento, a visita e as respostas não podem mais ser editadas.
- A conclusão exige o PDF do documento.

### Documento e assinaturas

1. Com todas as perguntas respondidas, o fiscal gera o documento da visita.
2. O fiscal logado assina.
3. O responsável pelo estabelecimento informa o nome (o e-mail é opcional) e
   assina ou recusa.
4. Com as assinaturas, o back gera o PDF, guarda no Storage, conclui a visita e
   envia o PDF ao responsável, quando há e-mail.
5. Se o PDF ou o e-mail falharem, `POST /documentos/:id/finalizar` tenta de novo.

### Usuários

- O admin cadastra gestores, fiscalizadores e outros admins. A senha é **gerada
  pelo servidor** (12 caracteres) e enviada por e-mail. Se o envio falhar, o
  usuário não é criado.
- O admin pode reenviar uma nova senha a um usuário aprovado.
- O cadastro público (`/auth/signup`) cria um fiscalizador **pendente**, que só
  entra depois de aprovado.

## Rotas da API

Fora `/`, `/auth/login` e `/auth/signup`, as rotas exigem o cabeçalho
`Authorization: Bearer <token>`.

Legenda: **A** admin · **G** gestor · **F** fiscalizador.

### Autenticação

| Método e rota | Perfil | Descrição |
| --- | --- | --- |
| `POST /auth/login` | público | Devolve o token e os dados do usuário |
| `POST /auth/signup` | público | Cadastro pendente de fiscalizador |
| `POST /auth/logout` | logado | Revoga o token |

### Usuários

| Método e rota | Perfil | Descrição |
| --- | --- | --- |
| `POST /usuarios` | A | Cadastra e envia a senha por e-mail |
| `GET /usuarios` | A, G | Lista (o gestor vê só os aprovados) |
| `GET /usuarios/:id` | A | Consulta |
| `PUT /usuarios/:id` | A | Edita |
| `DELETE /usuarios/:id` | A | Exclui |
| `PATCH /usuarios/:id/aprovar` | A | Aprova o cadastro |
| `PATCH /usuarios/:id/reprovar` | A | Bloqueia o fiscalizador |
| `POST /usuarios/:id/reenviar-senha` | A | Gera outra senha e envia |

### Visitas

| Método e rota | Perfil | Descrição |
| --- | --- | --- |
| `POST /visitas` | A, G | Cria |
| `GET /visitas` | A, G, F | Lista (o fiscal vê só as suas) |
| `GET /visitas/:id` | A, G, F | Detalhe |
| `PUT /visitas/:id` | A, G | Edita ou cancela |
| `DELETE /visitas/:id` | A, G | Exclui |
| `GET /visitas/:id/fiscalizadores` | A, G, F | Fiscal da visita |
| `POST /visitas/:id/fiscalizadores` | A, G | Adiciona |
| `PUT /visitas/:id/fiscalizadores` | A, G | Substitui |
| `DELETE /visitas/:id/fiscalizadores/:fiscalizadorId` | A, G | Remove |
| `PATCH /visitas/:id/iniciar` | F | Registra o início com a localização |
| `PATCH /visitas/:id/concluir` | A, G, F | Conclui |
| `PATCH /visitas/:id/observacoes` | F | Salva as observações livres |
| `POST /visitas/:id/respostas` | F | Envia as respostas |
| `GET /visitas/:id/respostas` e `/:respostaId` | A, G, F | Consulta as respostas |
| `PUT` e `DELETE /visitas/:id/respostas/:respostaId` | F | Altera ou apaga uma resposta |
| `POST /visitas/:id/documento` | F | Gera o documento |

O fiscalizador só acessa as próprias visitas. Para alterar ou excluir, o gestor
precisa ser o responsável pela visita; o admin altera qualquer uma.

### Documentos

| Método e rota | Perfil | Descrição |
| --- | --- | --- |
| `POST /documentos/:id/assinaturas` | F | Registra uma assinatura ou a recusa |
| `DELETE /documentos/:id/assinaturas/:assinaturaId` | F | Apaga antes do PDF |
| `POST /documentos/:id/finalizar` | F | Gera o PDF e envia o e-mail |
| `GET /documentos/:id/pdf` | A, G | Link temporário do PDF (5 minutos) |

### Questionário e administração

| Método e rota | Perfil | Descrição |
| --- | --- | --- |
| `GET /questionario` | A, G, F | Perguntas |
| `GET /questionario/:id` | A | Uma pergunta |
| `POST`, `PUT` e `DELETE /questionario` | A | Mantém as perguntas (`:id` no `PUT` e no `DELETE`) |
| `GET /admin/dados-gerais` | A | Totais de visitas, usuários, documentos e assinaturas |
| `GET /admin/exportar` | A | CSV das visitas, com filtros (até 5.000 linhas) |

Os tipos de resposta são `sim_nao`, `numero`, `data` e `texto`.

### Erros

As respostas de erro têm o formato:

```json
{ "mensagem": "texto para mostrar ao usuário", "erros": ["detalhes, quando houver"] }
```

| Status | Quando |
| --- | --- |
| 400 | Dados inválidos ou regra de negócio |
| 401 | Sem token, token vencido ou sessão encerrada |
| 403 | Perfil sem permissão, cadastro pendente ou origem bloqueada |
| 404 | Registro ou rota inexistente |
| 409 | Registro duplicado (por exemplo, e-mail) |
| 413 | Corpo maior que 1 MB |
| 429 | Excesso de requisições |
| 503 | Banco, Storage, e-mail ou configuração indisponível |

## Segurança

- Senhas com **Argon2**. Hashes antigos (bcrypt) são convertidos no primeiro login.
- Token JWT com validade de **1 hora**; o logout o revoga.
- O login responde no mesmo tempo para e-mail existente ou não.
- Limite de 500 requisições por IP a cada 15 minutos e de 5 tentativas de login
  com falha no mesmo período.
- CORS restrito às origens de `ALLOWED_ORIGINS`. Requisições sem `Origin`, como as
  do app no celular, são aceitas.
- Helmet nos cabeçalhos e validação das entradas com Zod.
- Controle por perfil e por propriedade da visita.
- Bucket privado: os arquivos só são acessados por link temporário.
- O CSV é protegido contra fórmulas maliciosas.

## Documento, arquivos e e-mail

- **PDF:** gerado com PDFKit, com os dados da visita, as respostas e as assinaturas.
- **Storage:** assinaturas em `visitas/{id}/assinaturas` e o PDF final no bucket
  privado `documentos`. O banco guarda o caminho do arquivo, não um link público.
- **E-mail de acesso:** enviado no cadastro e no reenvio de senha.
- **E-mail do documento:** enviado ao responsável pelo estabelecimento.
- O envio precisa de `EMAIL_ENVIO_REAL=true` ou de `EMAIL_DESTINO_TESTE`; sem
  nenhum dos dois, é recusado.

## Publicação

O projeto é publicado na **Vercel**; o merge na `main` gera o deploy.

1. Cadastre as variáveis de ambiente no projeto da Vercel.
2. Crie no Supabase o bucket **privado** `documentos`.
3. Rode os SQLs novos de `scripts/sql/` antes do deploy.
4. Inclua o endereço do painel em `ALLOWED_ORIGINS`.

O `vercel.json` envia todas as rotas para `src/index.js` e inclui as fontes do
PDFKit e a pasta `src/assets`.

## Testes

```bash
npm test                        # roda os testes
npx vitest run --coverage       # gera o relatório em coverage/
```

São **1184 testes** em 39 arquivos, com cerca de **97%** das linhas cobertas. Eles
simulam o banco, o Storage e o SMTP, então não precisam de credenciais.
