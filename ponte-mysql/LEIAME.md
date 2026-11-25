# Ponte MySQL · Portal Wepink

Serviço pequeno que roda **num computador da sua rede**, ao lado do MySQL. O portal (na Vercel) pede uma consulta pelo nome, a ponte executa e devolve o resultado.

```
Portal (Vercel) --HTTPS + token--> Cloudflare Tunnel --> Ponte (127.0.0.1:8787) --> MySQL local
```

- A ponte só executa as consultas cadastradas em `consultas.js`. Ninguém consegue mandar um SQL qualquer.
- Só aceita consultas de leitura (SELECT / WITH / SHOW).
- Exige o token secreto em toda chamada. Depois de 10 tentativas erradas, bloqueia o IP por 15 minutos.
- Não abre nenhuma porta no roteador: a Cloudflare cria o túnel de dentro para fora.

## 1. Usuário só de leitura no MySQL
No MySQL, como administrador:
```sql
CREATE USER 'ponte_portal'@'localhost' IDENTIFIED BY 'UmaSenhaForte!2026';
GRANT SELECT ON nome_do_banco.* TO 'ponte_portal'@'localhost';
FLUSH PRIVILEGES;
```
Se a ponte rodar em outro computador da rede, troque `localhost` pelo IP desse computador.

## 2. Instalar a ponte
1. Instale o **Node.js 20 LTS** no computador que fica sempre ligado.
2. Copie a pasta `ponte-mysql` para ele.
3. Copie `.env.example` para `.env` e preencha os dados do MySQL.
4. Gere o token, uma senha longa e aleatória. No PowerShell:
   ```powershell
   -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
   ```
   Cole o resultado em `PONTE_TOKEN=` no `.env`.
5. Dê dois cliques em `iniciar-ponte.bat`. Deve aparecer: `Ponte MySQL ouvindo em http://127.0.0.1:8787`.

## 3. Túnel da Cloudflare (gratuito)
**Para testar rápido (o endereço muda a cada reinício):**
1. Baixe o `cloudflared` para Windows: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. No PowerShell: `cloudflared tunnel --url http://127.0.0.1:8787`
3. Ele mostra um endereço `https://algo-aleatorio.trycloudflare.com`. Esse é o `PONTE_URL`.

**Para uso definitivo (endereço fixo):** precisa de um domínio na Cloudflare (pode ser o mesmo do portal).
1. No painel da Cloudflare: **Zero Trust → Networks → Tunnels → Create a tunnel** (tipo Cloudflared).
2. Instale o conector no computador da ponte com o comando que o painel mostra. Ele já vira serviço do Windows.
3. Em **Public Hostname**, crie por exemplo `ponte.seudominio.com.br` apontando para `http://127.0.0.1:8787`.
4. O `PONTE_URL` passa a ser `https://ponte.seudominio.com.br`.

## 4. Ligar no portal
Na Vercel, em **Settings → Environment Variables**:
- `PONTE_URL`: o endereço do túnel (sem barra no final)
- `PONTE_TOKEN`: o mesmo token do `.env` da ponte

Faça **Redeploy**. No portal, entre como administrador e abra a aba **Dados locais**: deve aparecer "Ponte online" com a versão do MySQL.

## 5. Deixar sempre ligada
- **Ponte:** use o NSSM (https://nssm.cc) para criar um serviço do Windows que rode `node --env-file=.env ponte.js` nesta pasta. Outra opção é o `pm2` (`npm i -g pm2`, depois `pm2 start ponte.js --node-args="--env-file=.env"` e `pm2 save`).
- **Túnel:** no modo definitivo, o conector da Cloudflare já instala como serviço.

## Cadastrar novas consultas
Abra `consultas.js`, copie o exemplo e ajuste:
- `perfis` diz quem vê a consulta no portal (cliente, transporte, operacao, admin).
- Os parâmetros entram no SQL como `:nome` e são validados (data, inteiro, texto, lista).

Depois reinicie a ponte. O portal enxerga as consultas novas sozinho.
