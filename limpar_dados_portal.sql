/*
  Portal Wepink · AGF Morada dos Lagos
  LIMPEZA DOS DADOS DO PORTAL (mantém os usuários)

  Apaga:  coletas, caminhões das coletas, embarques, pendências, anexos (protocolos e arquivos),
          histórico, status de rastreamento salvo e registro de envios de WhatsApp.
  Opcional: cadastro da frota (caminhões e motoristas), veja @LIMPAR_FROTA.
  Mantém: PORTAL_USUARIOS (logins, perfis, senhas e WhatsApp de cada usuário).
  NUNCA mexe: REGISTROSMICROPOST (os envios da Wepink).

  Os números das coletas voltam a começar do 1.

  COMO USAR
  1. Faça um backup do banco antes.
  2. Rode uma vez como está: só mostra quantos registros seriam apagados.
  3. Troque @CONFIRMAR para 'SIM' e rode de novo para apagar de verdade.
*/
USE manager;
GO

DECLARE @CONFIRMAR    VARCHAR(3) = 'NAO';   -- troque para 'SIM' para apagar
DECLARE @LIMPAR_FROTA BIT        = 1;       -- 1 = apaga caminhões e motoristas também | 0 = mantém a frota

SET NOCOUNT ON;
SET XACT_ABORT ON;

/* Tabelas na ordem certa de exclusão (filhas antes das mães) */
DECLARE @tabelas TABLE (ordem INT, nome SYSNAME, frota BIT);
INSERT INTO @tabelas VALUES
    (1,  'PORTAL_PENDENCIAS',      0),
    (2,  'PORTAL_ANEXOS',          0),
    (3,  'PORTAL_EMBARQUES',       0),
    (4,  'PORTAL_COLETA_VEICULOS', 0),
    (5,  'PORTAL_HISTORICO',       0),
    (6,  'PORTAL_COLETAS',         0),
    (7,  'PORTAL_RASTREAMENTO',    0),
    (8,  'PORTAL_WHATSAPP_LOG',    0),
    (9,  'PORTAL_VEICULOS',        1),
    (10, 'PORTAL_MOTORISTAS',      1);

/* ---------- Prévia ---------- */
DECLARE @previa TABLE (tabela SYSNAME, registros BIGINT, acao VARCHAR(20));
DECLARE @nome SYSNAME, @frota BIT, @sql NVARCHAR(MAX), @n BIGINT;

DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT nome, frota FROM @tabelas ORDER BY ordem;
OPEN c; FETCH NEXT FROM c INTO @nome, @frota;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF OBJECT_ID('dbo.' + @nome, 'U') IS NOT NULL
    BEGIN
        SET @sql = N'SELECT @n = COUNT_BIG(*) FROM dbo.' + QUOTENAME(@nome);
        EXEC sp_executesql @sql, N'@n BIGINT OUTPUT', @n = @n OUTPUT;
        INSERT INTO @previa VALUES (@nome, @n, CASE WHEN @frota = 1 AND @LIMPAR_FROTA = 0 THEN 'mantém' ELSE 'apaga' END);
    END
    FETCH NEXT FROM c INTO @nome, @frota;
END
CLOSE c; DEALLOCATE c;

SELECT tabela, registros, acao FROM @previa
UNION ALL
SELECT 'PORTAL_USUARIOS', (SELECT COUNT_BIG(*) FROM dbo.PORTAL_USUARIOS), 'mantém'
WHERE OBJECT_ID('dbo.PORTAL_USUARIOS', 'U') IS NOT NULL;

IF @CONFIRMAR <> 'SIM'
BEGIN
    PRINT 'Prévia apenas. Nada foi apagado. Troque @CONFIRMAR para ''SIM'' para executar.';
    RETURN;
END

/* ---------- Limpeza ---------- */
BEGIN TRAN;

DECLARE d CURSOR LOCAL FAST_FORWARD FOR SELECT nome, frota FROM @tabelas ORDER BY ordem;
OPEN d; FETCH NEXT FROM d INTO @nome, @frota;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF OBJECT_ID('dbo.' + @nome, 'U') IS NOT NULL AND NOT (@frota = 1 AND @LIMPAR_FROTA = 0)
    BEGIN
        SET @sql = N'DELETE FROM dbo.' + QUOTENAME(@nome) + N'; SET @n = @@ROWCOUNT;';
        EXEC sp_executesql @sql, N'@n BIGINT OUTPUT', @n = @n OUTPUT;
        PRINT @nome + ': ' + CAST(@n AS VARCHAR(20)) + ' registros apagados';

        /* Recomeça a numeração (ex.: coleta nº 1) só em tabelas que já tiveram registros */
        IF EXISTS (SELECT 1 FROM sys.identity_columns WHERE object_id = OBJECT_ID('dbo.' + @nome) AND last_value IS NOT NULL)
        BEGIN
            SET @sql = N'DBCC CHECKIDENT (''dbo.' + @nome + N''', RESEED, 0) WITH NO_INFOMSGS;';
            EXEC sp_executesql @sql;
        END
    END
    FETCH NEXT FROM d INTO @nome, @frota;
END
CLOSE d; DEALLOCATE d;

COMMIT;
PRINT 'Limpeza concluída. Usuários mantidos.';
GO
