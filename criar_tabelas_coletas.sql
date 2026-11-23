/*
  Portal de Envios Wepink · AGF Morada dos Lagos
  Protocolo de coletas: usuários por perfil, coletas, embarques, pendências e histórico.

  Rode no banco MANAGER. Pode rodar mais de uma vez: só cria o que ainda não existe.

  Fluxo:
    1. Cliente solicita a coleta ............................ status 'solicitada'
    2. Transporte agenda (opcional) e confirma a coleta ..... 'agendada' -> 'coletada'
    3. Operação lança os embarques (nº, qtd, horário) ....... 'em_tratamento'
    4. Operação confere cada embarque; objetos com problema viram pendências
    5. Operação finaliza ..................................... 'concluida' ou 'pendente'
    6. Cliente dá ciência das pendências; operação marca como resolvidas -> 'concluida'
*/
USE manager;
GO

/* ---------- Usuários ---------- */
IF OBJECT_ID('dbo.PORTAL_USUARIOS', 'U') IS NULL
CREATE TABLE dbo.PORTAL_USUARIOS (
    ID              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PORTAL_USUARIOS PRIMARY KEY,
    LOGIN           VARCHAR(60)    NOT NULL CONSTRAINT UQ_PORTAL_USUARIOS_LOGIN UNIQUE,
    NOME            NVARCHAR(120)  NOT NULL,
    EMAIL           NVARCHAR(160)  NULL,
    PERFIL          VARCHAR(20)    NOT NULL CONSTRAINT CK_PORTAL_USUARIOS_PERFIL CHECK (PERFIL IN ('cliente','transporte','operacao','admin')),
    SENHA_HASH      VARCHAR(200)   NOT NULL,          -- scrypt$sal$hash (gerado pelo portal)
    ATIVO           BIT            NOT NULL CONSTRAINT DF_PORTAL_USUARIOS_ATIVO DEFAULT 1,
    CRIADO_EM       DATETIME2(0)   NOT NULL CONSTRAINT DF_PORTAL_USUARIOS_CRIADO DEFAULT SYSDATETIME(),
    ULTIMO_ACESSO   DATETIME2(0)   NULL
);
GO

/* ---------- Coletas ---------- */
IF OBJECT_ID('dbo.PORTAL_COLETAS', 'U') IS NULL
CREATE TABLE dbo.PORTAL_COLETAS (
    ID                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PORTAL_COLETAS PRIMARY KEY,   -- nº da coleta
    DATA_COLETA         DATE           NOT NULL,
    STATUS              VARCHAR(20)    NOT NULL CONSTRAINT DF_PORTAL_COLETAS_STATUS DEFAULT 'solicitada'
                        CONSTRAINT CK_PORTAL_COLETAS_STATUS CHECK (STATUS IN ('solicitada','agendada','coletada','em_tratamento','pendente','concluida','cancelada')),
    -- cliente
    VOLUMES_PREVISTOS   INT            NULL,
    OBS_CLIENTE         NVARCHAR(1000) NULL,
    SOLICITADO_POR      INT            NULL,
    SOLICITADO_EM       DATETIME2(0)   NOT NULL CONSTRAINT DF_PORTAL_COLETAS_SOLIC DEFAULT SYSDATETIME(),
    -- transporte
    HORARIO_PREVISTO    TIME(0)        NULL,
    MOTORISTA           NVARCHAR(120)  NULL,
    PLACA               VARCHAR(10)    NULL,
    HORARIO_COLETA      TIME(0)        NULL,
    OBS_TRANSPORTE      NVARCHAR(1000) NULL,
    AGENDADO_POR        INT            NULL,
    AGENDADO_EM         DATETIME2(0)   NULL,
    COLETADO_POR        INT            NULL,
    COLETADO_EM         DATETIME2(0)   NULL,
    -- operação
    OBS_OPERACAO        NVARCHAR(1000) NULL,
    FINALIZADO_POR      INT            NULL,
    FINALIZADO_EM       DATETIME2(0)   NULL,
    CANCELADO_POR       INT            NULL,
    CANCELADO_EM        DATETIME2(0)   NULL,
    MOTIVO_CANCELAMENTO NVARCHAR(500)  NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PORTAL_COLETAS_DATA')
    CREATE INDEX IX_PORTAL_COLETAS_DATA ON dbo.PORTAL_COLETAS (DATA_COLETA, STATUS);
GO

/* ---------- Embarques (lançados pela operação) ---------- */
IF OBJECT_ID('dbo.PORTAL_EMBARQUES', 'U') IS NULL
CREATE TABLE dbo.PORTAL_EMBARQUES (
    ID              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PORTAL_EMBARQUES PRIMARY KEY,
    COLETA_ID       INT            NOT NULL CONSTRAINT FK_PORTAL_EMBARQUES_COLETA REFERENCES dbo.PORTAL_COLETAS(ID),
    DATA            DATE           NOT NULL,
    NUM_EMBARQUE    VARCHAR(30)    NOT NULL,
    QTD_OBJETOS     INT            NOT NULL CONSTRAINT CK_PORTAL_EMBARQUES_QTD CHECK (QTD_OBJETOS >= 0),
    HORARIO_COLETA  TIME(0)        NULL,
    -- conferência
    CONFERIDO       BIT            NOT NULL CONSTRAINT DF_PORTAL_EMBARQUES_CONF DEFAULT 0,
    TUDO_OK         BIT            NULL,              -- 1 = todos os objetos tratados
    QTD_TRATADOS    INT            NULL,
    OBS_CONFERENCIA NVARCHAR(1000) NULL,
    CONFERIDO_POR   INT            NULL,
    CONFERIDO_EM    DATETIME2(0)   NULL,
    CRIADO_POR      INT            NULL,
    CRIADO_EM       DATETIME2(0)   NOT NULL CONSTRAINT DF_PORTAL_EMBARQUES_CRIADO DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_PORTAL_EMBARQUES UNIQUE (COLETA_ID, NUM_EMBARQUE)
);
GO

/* ---------- Pendências (objetos com problema no tratamento) ---------- */
IF OBJECT_ID('dbo.PORTAL_PENDENCIAS', 'U') IS NULL
CREATE TABLE dbo.PORTAL_PENDENCIAS (
    ID               INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PORTAL_PENDENCIAS PRIMARY KEY,
    COLETA_ID        INT            NOT NULL CONSTRAINT FK_PORTAL_PEND_COLETA REFERENCES dbo.PORTAL_COLETAS(ID),
    EMBARQUE_ID      INT            NOT NULL CONSTRAINT FK_PORTAL_PEND_EMBARQUE REFERENCES dbo.PORTAL_EMBARQUES(ID),
    COD_OBJETO       VARCHAR(20)    NOT NULL,
    MOTIVO           NVARCHAR(100)  NOT NULL,
    OBS              NVARCHAR(500)  NULL,
    STATUS           VARCHAR(10)    NOT NULL CONSTRAINT DF_PORTAL_PEND_STATUS DEFAULT 'aberta'
                     CONSTRAINT CK_PORTAL_PEND_STATUS CHECK (STATUS IN ('aberta','ciente','resolvida')),
    CRIADO_POR       INT            NULL,
    CRIADO_EM        DATETIME2(0)   NOT NULL CONSTRAINT DF_PORTAL_PEND_CRIADO DEFAULT SYSDATETIME(),
    RESPOSTA_CLIENTE NVARCHAR(500)  NULL,
    CIENTE_POR       INT            NULL,
    CIENTE_EM        DATETIME2(0)   NULL,
    SOLUCAO          NVARCHAR(500)  NULL,
    RESOLVIDO_POR    INT            NULL,
    RESOLVIDO_EM     DATETIME2(0)   NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PORTAL_PENDENCIAS_COLETA')
    CREATE INDEX IX_PORTAL_PENDENCIAS_COLETA ON dbo.PORTAL_PENDENCIAS (COLETA_ID, STATUS);
GO

/* ---------- Histórico (quem fez o quê) ---------- */
IF OBJECT_ID('dbo.PORTAL_HISTORICO', 'U') IS NULL
CREATE TABLE dbo.PORTAL_HISTORICO (
    ID          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PORTAL_HISTORICO PRIMARY KEY,
    COLETA_ID   INT            NOT NULL,
    USUARIO_ID  INT            NULL,
    USUARIO     NVARCHAR(120)  NULL,
    PERFIL      VARCHAR(20)    NULL,
    ACAO        NVARCHAR(100)  NOT NULL,
    DETALHE     NVARCHAR(1000) NULL,
    EM          DATETIME2(0)   NOT NULL CONSTRAINT DF_PORTAL_HISTORICO_EM DEFAULT SYSDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PORTAL_HISTORICO_COLETA')
    CREATE INDEX IX_PORTAL_HISTORICO_COLETA ON dbo.PORTAL_HISTORICO (COLETA_ID, EM);
GO

/* Permissões para o login do portal (se usar o login portal_wepink sugerido no LEIAME):
GRANT SELECT, INSERT, UPDATE ON dbo.PORTAL_USUARIOS   TO portal_wepink;
GRANT SELECT, INSERT, UPDATE ON dbo.PORTAL_COLETAS    TO portal_wepink;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.PORTAL_EMBARQUES TO portal_wepink;
GRANT SELECT, INSERT, UPDATE ON dbo.PORTAL_PENDENCIAS TO portal_wepink;
GRANT SELECT, INSERT ON dbo.PORTAL_HISTORICO          TO portal_wepink;
*/

/* Os usuários são criados pela tela "Usuários" do portal (perfil admin).
   O primeiro acesso de administrador usa o usuário do .env (PORTAL_USUARIOS). */
