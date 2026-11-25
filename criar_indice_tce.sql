/*
  Portal Wepink · AGF Morada dos Lagos
  OPCIONAL: deixa mais rápidas as telas "TCE" e "Relatório" (consultas por data na REGISTROSMICROPOST).
  Rode no banco MANAGER (SQL Server), de preferência fora do horário de pico: em tabelas grandes leva alguns minutos.
*/
USE manager;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_REGISTROSMICROPOST_DATA_PORTAL' AND object_id = OBJECT_ID('dbo.REGISTROSMICROPOST'))
    CREATE INDEX IX_REGISTROSMICROPOST_DATA_PORTAL ON dbo.REGISTROSMICROPOST (data) INCLUDE (Login, Triagem, Remetente, Status);
GO
