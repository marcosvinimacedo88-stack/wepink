# Portal de Envios Wepink · AGF Morada dos Lagos

Portal web com os envios da SAVI Cosméticos Ltda. (Wepink), lidos direto da tabela `REGISTROSMICROPOST`.

## O que o portal mostra
- Painel do período: total de objetos e variação contra o período anterior, média por dia, maior dia e CEPs atendidos
- Gráfico diário de postagens com média móvel de 7 dias
- Distribuição por região e por estado (calculada pelo CEP de destino)
- Envios por departamento (campo Remetente) e por dia da semana
- Relação de objetos com busca por registro ou CEP, ordenação, paginação e atalho para o rastreamento
- Exportação para planilha CSV (abre no Excel) e impressão do relatório
- **Rastreamento de cada objeto**: botão Rastrear abre um painel com etapa da entrega, previsão e histórico completo, consultado na API dos Correios. O resultado é gravado na tabela `PORTAL_RASTREAMENTO`
- **Rastrear esta página**: atualiza o status de todos os objetos da página (3 consultas por vez), com barra de progresso
- Coluna de status na lista e na planilha exportada
- Login com usuário e senha. A senha do banco fica só no servidor e nunca chega ao navegador.

## Como instalar (Windows)
1. Instale o **Node.js 20 LTS ou superior**: https://nodejs.org
2. Copie esta pasta para o computador ou servidor que vai hospedar o portal.
3. Confira o arquivo `.env`: dados do banco, usuário e senha do portal.
4. Dê dois cliques em `iniciar.bat`. Na primeira vez ele roda `npm install`.
5. Abra http://localhost:3000 e entre com o usuário do `.env`.

Para a Wepink acessar de fora, publique a porta 3000 com HTTPS. O caminho mais simples é um proxy reverso (IIS, Nginx ou Cloudflare Tunnel) com um domínio, por exemplo `envios.agfmoradadoslagos.com.br`. Depois coloque `HTTPS=1` no `.env`.
Para o portal ficar sempre ligado, rode como serviço com `pm2` (`npm i -g pm2 pm2-windows-startup`) ou NSSM.

## Coletas e usuários (protocolo)
1. Rode `criar_tabelas_coletas.sql` no banco `manager`.
2. Entre com o usuário do `.env` (perfil administrador) e abra a aba **Usuários**.
3. Crie um login para cada pessoa: perfil **Cliente** (Wepink), **Transporte**, **Operação** ou **Administrador**.
4. Depois que tiver um administrador criado no banco, você pode tirar o usuário do `.env` (`PORTAL_USUARIOS=`).

Fluxo de uma coleta:
| Etapa | Quem | O que faz |
|---|---|---|
| Solicitada | Cliente | Pede a coleta (data, volumes previstos, observação) |
| Agendada / Coletada | Transporte | Informa motorista, placa e horário; confirma quando coletou |
| Em tratamento | Operação | Lança cada embarque (data, nº, quantidade, horário da coleta) e confere |
| Conferência | Operação | Em cada embarque: todos tratados, ou lista dos objetos com problema e motivo |
| Concluída / Com pendências | Operação | Finaliza. Se houve problema, o cliente é notificado no sino |
| Pendências | Cliente e operação | Cliente dá ciência e orienta; operação registra a solução. Resolvidas todas, a coleta é concluída |

- O sino no topo mostra o que precisa da ação de cada perfil (atualiza a cada minuto).
- **Imprimir protocolo** gera a folha no modelo da planilha de controle (total, média por caminhão, embarques e assinaturas).
- Tudo fica registrado no histórico da coleta (quem fez, o quê e quando), na tabela `PORTAL_HISTORICO`.
- Senhas ficam criptografadas (scrypt) na tabela `PORTAL_USUARIOS`. Cada usuário pode trocar a própria senha no botão **Senha**.
- Se mudar o perfil de alguém ou desativar um usuário, a mudança vale no próximo login (ou em até 12 horas).

## Rastreamento
1. Rode `criar_tabela_rastreamento.sql` no SQL Server (banco `manager`). Ele cria a tabela `PORTAL_RASTREAMENTO`.
2. Confira `CORREIOS_USUARIO` e `CORREIOS_CHAVE` no `.env` (as mesmas do script de rastreio do SQL Server).
3. Reinicie o portal. Sem a tabela, o rastreio funciona, mas o status não é gravado.

Como funciona:
- O portal só rastreia objetos que pertencem à SAVI Cosméticos (confere na `REGISTROSMICROPOST` antes).
- Usa `srorastro/v1/objetos?resultado=T` (histórico completo) e guarda o token dos Correios em memória até expirar.
- Se o objeto foi consultado há menos de `RASTREIO_CACHE_MIN` minutos, ou já foi entregue, mostra o que está salvo. O botão **Atualizar status** força uma consulta nova.
- Se os Correios não responderem, o painel mostra a última consulta salva com um aviso.
- O código é completado com `BR` quando o registro tem 11 caracteres.

## Alterar o visual
A página fica em `src/index.html`. O Tailwind já vai compilado e embutido em `public/index.html`, sem depender de CDN. Se mudar classes do Tailwind em `src/index.html`, rode `npm install` e depois `npm run build`.

## Usuários
No `.env`, `PORTAL_USUARIOS=wepink:senha;agf:outrasenha`. Reinicie o portal depois de mudar.

## Segurança (importante)
- **Troque a senha do usuário `realbras`**, porque ela foi compartilhada em texto. Crie um login só de leitura para o portal:
  ```sql
  CREATE LOGIN portal_wepink WITH PASSWORD = 'UmaSenhaForte!2026';
  USE manager; CREATE USER portal_wepink FOR LOGIN portal_wepink;
  GRANT SELECT ON dbo.REGISTROSMICROPOST TO portal_wepink;
  ```
  Depois troque `DB_USUARIO` e `DB_SENHA` no `.env`.
- Se o portal rodar na mesma rede do SQL Server, feche a porta 1433 para a internet.
- Não envie o arquivo `.env` para ninguém. Ele também guarda a chave da API dos Correios.
- O login sugerido precisa de `SELECT, INSERT, UPDATE` na `PORTAL_RASTREAMENTO` (está no script).

## Observações técnicas
- Filtro do cliente: `Remetente LIKE '%SAVI COSMETICOS LTDA%'` (variável `FILTRO_REMETENTE`).
- O portal espera que a coluna `data` seja `datetime` ou `date`. Se ela for texto (varchar), me avise para ajustar as consultas.
- Recomendação de desempenho: um índice em `REGISTROSMICROPOST (data) INCLUDE (Remetente, registro, cep)`.
- SQL Server 2012 ou superior (usa `TRY_CAST` e `OFFSET/FETCH`).
- Para ver a página sem banco, abra `public/index.html` direto no navegador. Ela entra em modo demonstração com dados fictícios.

## Publicar na Vercel
O projeto já vem pronto: `vercel.json` serve a página de `public/` e manda `/api/*` para a função `api/index.js` (região São Paulo, `gru1`).

1. Suba este repositório no GitHub (privado). O `.env` fica fora pelo `.gitignore`.
2. Na Vercel: **Add New → Project**, importe o repositório. Framework: **Other**. Não mude os comandos.
3. Em **Settings → Environment Variables**, cadastre as variáveis do `.env.example` com os valores reais do seu `.env`:
   `DB_SERVIDOR`, `DB_PORTA`, `DB_USUARIO`, `DB_SENHA`, `DB_BANCO`, `DB_CRIPTOGRAFAR`, `FILTRO_REMETENTE`, `PORTAL_USUARIOS`,
   `SESSAO_SEGREDO` (obrigatório na Vercel), `CORREIOS_URL`, `CORREIOS_USUARIO`, `CORREIOS_CHAVE`, `CORREIOS_RESULTADO`.
   Não precisa de `PORTA` nem `HTTPS` (a Vercel já usa HTTPS e o cookie sai como Secure).
4. **Deploy**.

Segurança na Vercel:
- As funções da Vercel saem por IPs que mudam. Para o SQL Server aceitar só a Vercel, ative **Static IPs** (plano Pro) e libere no firewall do servidor apenas esses IPs. Sem isso, seria preciso abrir a porta 1433 para a internet inteira, o que não é recomendado.
- Use o login `portal_wepink` com permissões mínimas, não o `realbras`.
- Ative a criptografia da conexão (`DB_CRIPTOGRAFAR=1`) quando o SQL Server tiver certificado.
- Na Vercel cada instância tem memória própria: o bloqueio após 5 senhas erradas e o limite de rastreios por minuto valem por instância, então ficam mais fracos que num servidor único.

Na Hostinger/VPS continua funcionando igual: `npm start` (ou `iniciar.bat` no Windows).
