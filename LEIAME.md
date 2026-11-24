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

## Frota, caminhões e protocolo
1. Rode `criar_tabelas_frota_whatsapp.sql` no banco `manager` (depois do de coletas).
2. Ao criar a coleta, é obrigatório escolher o **local da coleta**: Galpão, SLV ou SAVI CD. Ele aparece na coleta, nos cartões, na imagem do protocolo, na impressão e nas mensagens de WhatsApp. Para mudar a lista, use a variável `LOCAIS_COLETA` (separados por ponto e vírgula).
3. O transporte cadastra **caminhões** (placa, descrição, capacidade em paletes) e **motoristas** na aba **Frota**.
4. Em cada coleta, o transporte registra **Caminhão 1, 2, 3…**: caminhão, motorista, horário da coleta, quantidade de paletes e ocupação (marque **Ocupação 100%** ou informe o %; se o caminhão tem capacidade cadastrada, o portal sugere pela conta paletes ÷ capacidade). O nº de objetos é opcional.
5. A operação, ao lançar cada embarque, escolhe de qual caminhão ele veio. O nº de objetos de cada caminhão passa a ser a soma dos embarques dele.
6. **Enviar protocolo ao cliente** gera a imagem no modelo da planilha (total de objetos, média por caminhão, caminhões com horário, paletes, ocupação e objetos), salva na coleta, avisa o cliente no sino e manda por WhatsApp.
7. **Compartilhar / baixar** abre o compartilhamento do celular (dá para mandar direto no WhatsApp) ou baixa o PNG no computador.
8. **PDF de várias coletas:** na aba Coletas, marque **No PDF** nos cartões (ou "Selecionar todas da lista") e clique em **Gerar PDF dos protocolos**. Sai um único arquivo com uma página de resumo (coleta, data, local, caminhões, paletes, objetos e totais) e, em seguida, o protocolo de cada coleta. No celular, abre o compartilhamento (dá para mandar direto no WhatsApp).
9. Transporte e operação também podem **anexar fotos ou PDF** (até 3 MB) na coleta.

## Imagem do protocolo (modelo da planilha)
A imagem segue o modelo "Controle de Coletas - AGF Morada dos Lagos": faixa com a logo da Wepink e o título, cartões de Total de Objetos Postados e Média por Caminhão (total ÷ nº de caminhões) e a tabela com data e local, Caminhão 1, 2, 3…, Horário da Coleta, Quantidade de Paletes e No. Objetos Postados (mínimo de 5 linhas).

**Logos:** coloque os arquivos de vocês na pasta `public/` com estes nomes exatos e suba no GitHub:
- `logo-wepink.png`: logo da Wepink (de preferência branca, fundo transparente), vai na faixa rosa
- `logo-agf.png`: símbolo usado na planilha, vai ao lado do título

Sem os arquivos, a faixa rosa mostra "wepink" escrito e o título fica centralizado.

## WhatsApp automático
Cada usuário cadastra o próprio número em **Minha conta** e marca "Quero receber os avisos". O administrador também pode preencher na aba Usuários.

| Quem recebe | Quando |
|---|---|
| Cliente | Protocolo da coleta enviado (com a imagem) e objetos com problema no tratamento |
| Transporte | Nova coleta solicitada |
| Operação | Caminhão registrado na coleta |

Todos os envios ficam registrados na tabela `PORTAL_WHATSAPP_LOG` (enviado ou erro, com a resposta do provedor).

Escolha um provedor em `WHATSAPP_PROVEDOR`:

**Opção 1: `zapi` (Z-API, mais rápida de ligar).** Crie uma instância em z-api.io, conecte o WhatsApp da AGF pelo QR Code e preencha `ZAPI_INSTANCIA`, `ZAPI_TOKEN` e `ZAPI_CLIENT_TOKEN` (token de segurança da conta). Atenção: a Z-API usa o WhatsApp comum (não é a API oficial da Meta), então existe risco de bloqueio do número se houver muitas reclamações. Use um número só para isso.

**Opção 2: `meta` (API oficial).** Precisa de conta no Meta Business, um número de WhatsApp Business na Cloud API e dois modelos aprovados no WhatsApp Manager (categoria Utilidade, idioma pt_BR):
- `agf_aviso`, só texto. Corpo: `Olá! {{1}} Mensagem automática do portal Wepink · AGF Morada dos Lagos.`
- `agf_protocolo`, com cabeçalho do tipo Imagem. Corpo: `Olá! Protocolo da coleta nº {{1}} de {{2}}: {{3}} caminhões, {{4}} paletes e {{5}} objetos postados. Os detalhes estão no portal Wepink · AGF Morada dos Lagos.`
Depois preencha `WHATSAPP_META_TOKEN` (token permanente de usuário do sistema) e `WHATSAPP_META_PHONE_ID`. A Meta cobra por mensagem de modelo enviada.

Sem provedor configurado, tudo continua funcionando: os avisos aparecem no sino e o botão Compartilhar manda a imagem pelo WhatsApp do próprio celular.
Na Vercel, cadastre as mesmas variáveis em Settings → Environment Variables e faça Redeploy.

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
   `SESSAO_SEGREDO` (obrigatório na Vercel), `CORREIOS_URL`, `CORREIOS_USUARIO`, `CORREIOS_CHAVE`, `CORREIOS_RESULTADO`, `PORTAL_URL`
   e, se for usar WhatsApp automático, as variáveis `WHATSAPP_*` ou `ZAPI_*`.
   Não precisa de `PORTA` nem `HTTPS` (a Vercel já usa HTTPS e o cookie sai como Secure).
4. **Deploy**.

Segurança na Vercel:
- As funções da Vercel saem por IPs que mudam. Para o SQL Server aceitar só a Vercel, ative **Static IPs** (plano Pro) e libere no firewall do servidor apenas esses IPs. Sem isso, seria preciso abrir a porta 1433 para a internet inteira, o que não é recomendado.
- Use o login `portal_wepink` com permissões mínimas, não o `realbras`.
- Ative a criptografia da conexão (`DB_CRIPTOGRAFAR=1`) quando o SQL Server tiver certificado.
- Na Vercel cada instância tem memória própria: o bloqueio após 5 senhas erradas e o limite de rastreios por minuto valem por instância, então ficam mais fracos que num servidor único.

Na Hostinger/VPS continua funcionando igual: `npm start` (ou `iniciar.bat` no Windows).
