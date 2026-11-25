/*
  Portal Wepink · AGF Morada dos Lagos
  Cadastro de operadores das cubadoras (Pitney). Rode no banco MANAGER (SQL Server).
  O NUMERO é o código do operador gravado pela cubadora nas tabelas imps e servicos do MySQL.
*/
USE manager;
GO

IF OBJECT_ID('dbo.PORTAL_OPERADORES_CUBADORA', 'U') IS NULL
CREATE TABLE dbo.PORTAL_OPERADORES_CUBADORA (
    ID          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PORTAL_OP_CUB PRIMARY KEY,
    NUMERO      VARCHAR(20)    NOT NULL CONSTRAINT UQ_PORTAL_OP_CUB_NUMERO UNIQUE,
    NOME        NVARCHAR(120)  NOT NULL,
    TURNO       NVARCHAR(30)   NULL,              -- ex.: Manhã, Tarde, Noite
    ATIVO       BIT            NOT NULL CONSTRAINT DF_PORTAL_OP_CUB_ATIVO DEFAULT 1,
    CRIADO_EM   DATETIME2(0)   NOT NULL CONSTRAINT DF_PORTAL_OP_CUB_CRIADO DEFAULT SYSDATETIME()
);
GO

/* Permissão para o login do portal (se usar o portal_wepink):
GRANT SELECT, INSERT, UPDATE ON dbo.PORTAL_OPERADORES_CUBADORA TO portal_wepink;
*/
