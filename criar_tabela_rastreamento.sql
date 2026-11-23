/*
  Portal de Envios Wepink · AGF Morada dos Lagos
  Tabela que guarda o último rastreamento de cada objeto consultado pelo portal.

  Rode no banco MANAGER (o mesmo da REGISTROSMICROPOST).
  Uma linha por objeto: cada nova consulta atualiza a linha e soma em QTD_CONSULTAS.
*/
USE manager;
GO

IF OBJECT_ID('dbo.PORTAL_RASTREAMENTO', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PORTAL_RASTREAMENTO (
        COD_OBJETO          VARCHAR(13)    NOT NULL,              -- ex.: QB123456789BR
        STATUS              NVARCHAR(255)  NULL,                  -- descrição do último evento
        DETALHE             NVARCHAR(500)  NULL,                  -- detalhe / destino do último evento
        LOCAL_ULTIMO        NVARCHAR(255)  NULL,                  -- unidade e cidade/UF do último evento
        ETAPA               TINYINT        NOT NULL DEFAULT 0,    -- 0 sem eventos, 1 postado, 2 em trânsito, 3 saiu para entrega, 4 entregue
        ENTREGUE            BIT            NOT NULL DEFAULT 0,
        ALERTA              BIT            NOT NULL DEFAULT 0,    -- não entregue, devolução, aguardando retirada etc.
        DATA_ULTIMO_EVENTO  DATETIME2(0)   NULL,
        DATA_POSTAGEM       DATETIME2(0)   NULL,                  -- data do primeiro evento nos Correios
        PRAZO               DATE           NULL,                  -- previsão de entrega informada pelos Correios
        SERVICO             NVARCHAR(150)  NULL,                  -- tipo postal (ex.: SEDEX, PAC)
        EVENTOS_JSON        NVARCHAR(MAX)  NULL,                  -- histórico completo de eventos
        MENSAGEM            NVARCHAR(500)  NULL,                  -- mensagem dos Correios quando não há eventos
        CONSULTADO_EM       DATETIME2(0)   NOT NULL DEFAULT SYSDATETIME(),
        CONSULTADO_POR      VARCHAR(60)    NULL,                  -- usuário do portal que consultou
        QTD_CONSULTAS       INT            NOT NULL DEFAULT 1,
        CONSTRAINT PK_PORTAL_RASTREAMENTO PRIMARY KEY CLUSTERED (COD_OBJETO),
        CONSTRAINT CK_PORTAL_RASTREAMENTO_JSON CHECK (EVENTOS_JSON IS NULL OR ISJSON(EVENTOS_JSON) = 1)
    );

    CREATE INDEX IX_PORTAL_RASTREAMENTO_STATUS
        ON dbo.PORTAL_RASTREAMENTO (ENTREGUE, ALERTA, CONSULTADO_EM)
        INCLUDE (STATUS, PRAZO);
END
GO

/* Permissões para o login do portal (ajuste o nome se usar outro login)
   Se o portal usa o login portal_wepink sugerido no LEIAME: */
-- GRANT SELECT, INSERT, UPDATE ON dbo.PORTAL_RASTREAMENTO TO portal_wepink;
-- GRANT SELECT ON dbo.REGISTROSMICROPOST TO portal_wepink;
GO

/* Consultas úteis */
-- Objetos com problema na entrega:
-- SELECT COD_OBJETO, STATUS, LOCAL_ULTIMO, DATA_ULTIMO_EVENTO FROM dbo.PORTAL_RASTREAMENTO WHERE ALERTA = 1 ORDER BY DATA_ULTIMO_EVENTO DESC;

-- Atrasados (previsão vencida e ainda não entregue):
-- SELECT COD_OBJETO, STATUS, PRAZO FROM dbo.PORTAL_RASTREAMENTO WHERE ENTREGUE = 0 AND PRAZO < CAST(GETDATE() AS date);

-- Histórico de eventos de um objeto:
-- SELECT j.* FROM dbo.PORTAL_RASTREAMENTO r
-- CROSS APPLY OPENJSON(r.EVENTOS_JSON) WITH (data varchar(19), descricao nvarchar(255), local nvarchar(255), destino nvarchar(255)) j
-- WHERE r.COD_OBJETO = 'QB123456789BR';
