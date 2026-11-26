# Review — PR #84 (vitorferrr)

[DT-42] Gera a senha aleatoriamente e envia por e-mail no cadastro

**Resultado:** 5 pontos — nenhum bloqueante, 1 importante e 4 sugestões. Rodei a suíte na branch da PR: **1071 testes, todos passando**.

Conferi também os pontos mais sensíveis, e estão corretos:
- A senha usa o crypto.randomInt, que é seguro para isso. São 12 caracteres de um conjunto de 54, o que dá cerca de 69 bits de entropia, e o banco guarda só o hash.
- O nome do usuário, o nome do admin e a senha passam pelo escaparHtml antes de entrar no HTML. O perfil vem de um mapa fixo.
- O corpo do cadastro usa looseObject. Por isso, enquanto o front (DT-43) ainda manda senha, o back ignora o campo e não responde 400.
- A faixa do topo está em src/assets, e o vercel.json já inclui src/assets/** no deploy.
- Dois cadastros simultâneos com o mesmo e-mail não mandam dois e-mails. O segundo INSERT espera o primeiro terminar, falha no índice único e responde 409 sem chegar ao envio.
- Sem EMAIL_ENVIO_REAL nem EMAIL_DESTINO_TESTE, o envio falha, a transação é desfeita e a API responde 503. Não sobra conta com senha desconhecida.

## Resumo

| # | Severidade | Ponto | Arquivo |
|---|---|---|---|
| 1 | 🟠 Importante | Um e-mail digitado errado entrega uma conta ativa a um estranho, e o texto diz o contrário | src/services/emailService.js:187 |
| 2 | 🟢 Sugestão | O envio do e-mail acontece com a transação aberta | src/services/usuarioService.js:56 |
| 3 | 🟢 Sugestão | O formato da senha não é o que a descrição da PR diz | src/utils/gerarSenha.js:12 |
| 4 | 🟢 Sugestão | O link do Google Fonts no e-mail não funciona na maioria dos clientes | src/services/emailService.js:168 |
| 5 | 🟢 Sugestão | O controller tira a senha do corpo sem precisar | src/controllers/usuarioController.js:5 |

## 🟠 Importante

### 1. Um e-mail digitado errado entrega uma conta ativa a um estranho, e o texto diz o contrário
**Arquivo:** src/services/emailService.js:187

O cadastro pelo admin cria o usuário com aprovado true (o padrão do model) e manda a senha para o e-mail informado. O fim do e-mail diz "Se não esperava este convite, ignore a mensagem e nenhuma conta será ativada". Mas a conta já está ativa, e a senha funciona.

**O que acontece:** se o admin errar uma letra no e-mail e o endereço existir, a pessoa que receber já consegue entrar no app ou no painel. Se o perfil for gestor, ela vê todas as visitas, com dados de denúncias, estabelecimentos e responsáveis. Ignorar o e-mail não desfaz nada, e quem recebeu não tem como avisar o Procon. Antes da PR, um e-mail errado criava uma conta que ninguém conseguia usar, porque a senha ficava com o admin. Além disso, a senha fica para sempre na caixa de entrada, e não há forma de trocá-la nem de reenviar o e-mail sem o admin digitar uma senha no PUT, o que volta ao problema que a PR quer resolver.

**Sugestão:** o mínimo é corrigir o texto, por exemplo "Se você não esperava este e-mail, avise o Procon Jaboatão para que o acesso seja cancelado", nas versões HTML e texto. Para resolver de verdade, dá para escolher uma destas opções:
- Pedir a troca da senha no primeiro login. Uma coluna senha_provisoria true bloqueia as rotas até a pessoa trocar a senha, e a senha do e-mail deixa de valer.
- Ter uma rota POST /usuarios/:id/reenviar-senha. Ela gera outra senha e manda de novo, e o admin consegue corrigir um erro sem apagar o usuário.

A primeira opção também resolve a senha guardada no e-mail. As duas podem ficar como débito técnico, mas o texto vale corrigir já.

## 🟢 Sugestões

### 2. O envio do e-mail acontece com a transação aberta
**Arquivo:** src/services/usuarioService.js:56

O criarComSenhaGerada manda o e-mail por SMTP dentro do sequelize.transaction. A ideia é boa: se o e-mail falhar, o usuário não é criado. Mas há dois efeitos colaterais:
- **Conexão presa:** a conexão do banco fica presa durante todo o envio. Os timeouts do transporte são de 10 s em cada etapa (DNS, conexão, saudação e socket). Num envio lento, a conexão do pool do Supabase fica parada esse tempo todo, e na Vercel isso também conta no limite de tempo da função.
- **E-mail sem conta:** se o servidor SMTP aceitar a mensagem e a resposta se perder (timeout depois do envio), ou se o commit falhar depois do envio, a pessoa recebe uma senha de uma conta que não existe. Quando o admin tentar de novo, ela recebe outra senha. É raro e não deixa dado errado, mas confunde.

Dá para manter como está e só registrar o risco. Se aparecer lentidão, outra opção é criar o usuário com uma flag de pendente, mandar o e-mail fora da transação e apagar o usuário se o envio falhar. Mas isso aumenta bastante o código.

### 3. O formato da senha não é o que a descrição da PR diz
**Arquivo:** src/utils/gerarSenha.js:12

A descrição fala em Xxxx-Xxxx-Xxxx, com maiúscula no começo de cada bloco (ex.: Kx7m-Q2pv-9Rta). Rodei o gerador, e as senhas saem com maiúsculas e minúsculas em qualquer posição: eht2-mTzh-tbsD, KRAK-4ZF6-Z9G5, dYat-yFaU-skn6. A senha continua forte, então basta ajustar a descrição.

Fica também a ideia de gerar só maiúsculas e números (A-Z sem O e I, mais 2-9). A senha fica mais fácil de digitar no celular, onde o teclado troca maiúsculas sozinho. Com 12 caracteres de um conjunto de 32, ainda são 60 bits de entropia.

### 4. O link do Google Fonts no e-mail não funciona na maioria dos clientes
**Arquivo:** src/services/emailService.js:168

Gmail e Outlook removem o link para fonts.googleapis.com, e o e-mail cai nas fontes reservas. Isso já está previsto, porque os estilos têm reservas (system-ui, monospace). Nos clientes que carregam o link, como o Apple Mail, o Google fica sabendo quando o e-mail foi aberto. Dá para remover o link e deixar só as fontes do sistema. O visual muda pouco e o HTML fica mais simples.

### 5. O controller tira a senha do corpo sem precisar
**Arquivo:** src/controllers/usuarioController.js:5

O criarComSenhaGerada já sobrescreve a senha com { ...dados, senha }. Por isso o const { senha, ...dados } = req.body não muda nada, e a variável senha fica sem uso. Dá para passar req.body direto. Se a ideia é deixar claro que a senha do corpo é ignorada, um comentário curto explica melhor.
