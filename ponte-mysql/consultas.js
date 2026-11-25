/*
 * CONSULTAS LIBERADAS PELA PONTE
 * ------------------------------
 * A ponte só executa o que estiver aqui. Ninguém consegue mandar SQL pela internet.
 *
 * Cada consulta tem:
 *   titulo     : nome que aparece no portal
 *   descricao  : explicação curta
 *   perfis     : quem pode ver no portal: 'cliente', 'transporte', 'operacao', 'admin'
 *   parametros : lista de { nome, rotulo, tipo, obrigatorio, padrao }
 *                tipos: 'data' (AAAA-MM-DD), 'hora' (HH:MM ou HH:MM:SS), 'inteiro', 'texto' (até 100 caracteres), 'lista' (com opcoes: [...])
 *   limite     : (opcional) máximo de linhas desta consulta
 *   tela       : (opcional) consulta usada por uma tela própria do portal, não aparece em Dados locais
 *   sql        : SELECT com marcadores :nome para os parâmetros (nunca concatene texto)
 *
 * Use sempre um usuário do MySQL só com permissão de SELECT (veja o LEIAME).
 */
module.exports = {
  teste: {
    titulo: 'Teste de conexão',
    descricao: 'Versão do MySQL, banco em uso e hora do servidor.',
    perfis: ['admin'],
    parametros: [],
    sql: `SELECT VERSION() AS versao, DATABASE() AS banco, NOW() AS hora_servidor`
  },

  tabelas: {
    titulo: 'Tabelas do banco',
    descricao: 'Lista as tabelas com a quantidade aproximada de linhas. Serve para escolher o que trazer para o portal.',
    perfis: ['admin'],
    parametros: [],
    sql: `SELECT TABLE_NAME AS tabela, TABLE_ROWS AS linhas_aprox, ROUND((DATA_LENGTH + INDEX_LENGTH) / 1048576, 1) AS tamanho_mb,
            UPDATE_TIME AS atualizada_em
          FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
          ORDER BY TABLE_NAME`
  },

  colunas: {
    titulo: 'Colunas de uma tabela',
    descricao: 'Mostra as colunas e os tipos de uma tabela.',
    perfis: ['admin'],
    parametros: [{ nome: 'tabela', rotulo: 'Nome da tabela', tipo: 'texto', obrigatorio: true }],
    sql: `SELECT COLUMN_NAME AS coluna, COLUMN_TYPE AS tipo, IS_NULLABLE AS aceita_nulo, COLUMN_KEY AS chave
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tabela
          ORDER BY ORDINAL_POSITION`
  },


  /* ---------- Cubadoras Pitney (tela Cubadoras do portal) ---------- */
  cubadora_hora: {
    titulo: 'Cubadoras: bipagens por hora',
    descricao: 'Quantidade de registros por dia, hora e operador nas tabelas imps e servicos.',
    perfis: ['operacao', 'admin'],
    tela: 'cubadora',
    limite: 200000,
    parametros: [
      { nome: 'ini', rotulo: 'De (data)', tipo: 'data', obrigatorio: true },
      { nome: 'hi', rotulo: 'De (hora)', tipo: 'hora', obrigatorio: true, padrao: '00:00:00' },
      { nome: 'fim', rotulo: 'Até (data)', tipo: 'data', obrigatorio: true },
      { nome: 'hf', rotulo: 'Até (hora)', tipo: 'hora', obrigatorio: true, padrao: '23:59:59' }
    ],
    sql: `SELECT 'imps' AS fonte, DATE(data1) AS dia, HOUR(hora) AS h, operador, COUNT(*) AS qtd
          FROM imps
          WHERE data1 IS NOT NULL AND data1 >= :ini AND data1 < DATE_ADD(:fim, INTERVAL 1 DAY)
            AND TIMESTAMP(DATE(data1), hora) BETWEEN TIMESTAMP(:ini, :hi) AND TIMESTAMP(:fim, :hf)
          GROUP BY DATE(data1), HOUR(hora), operador
          UNION ALL
          SELECT 'servicos' AS fonte, DATE(data1) AS dia, HOUR(hora) AS h, operador, COUNT(*) AS qtd
          FROM servicos
          WHERE data1 IS NOT NULL AND data1 >= :ini AND data1 < DATE_ADD(:fim, INTERVAL 1 DAY)
            AND TIMESTAMP(DATE(data1), hora) BETWEEN TIMESTAMP(:ini, :hi) AND TIMESTAMP(:fim, :hf)
          GROUP BY DATE(data1), HOUR(hora), operador`
  },

  cubadora_extremos: {
    titulo: 'Cubadoras: primeiro e último registro',
    descricao: 'Primeira e última bipagem de cada operador no período.',
    perfis: ['operacao', 'admin'],
    tela: 'cubadora',
    parametros: [
      { nome: 'ini', rotulo: 'De (data)', tipo: 'data', obrigatorio: true },
      { nome: 'hi', rotulo: 'De (hora)', tipo: 'hora', obrigatorio: true, padrao: '00:00:00' },
      { nome: 'fim', rotulo: 'Até (data)', tipo: 'data', obrigatorio: true },
      { nome: 'hf', rotulo: 'Até (hora)', tipo: 'hora', obrigatorio: true, padrao: '23:59:59' }
    ],
    sql: `SELECT 'imps' AS fonte, operador, MIN(TIMESTAMP(DATE(data1), hora)) AS primeiro, MAX(TIMESTAMP(DATE(data1), hora)) AS ultimo
          FROM imps
          WHERE data1 IS NOT NULL AND data1 >= :ini AND data1 < DATE_ADD(:fim, INTERVAL 1 DAY)
            AND TIMESTAMP(DATE(data1), hora) BETWEEN TIMESTAMP(:ini, :hi) AND TIMESTAMP(:fim, :hf)
          GROUP BY operador
          UNION ALL
          SELECT 'servicos' AS fonte, operador, MIN(TIMESTAMP(DATE(data1), hora)) AS primeiro, MAX(TIMESTAMP(DATE(data1), hora)) AS ultimo
          FROM servicos
          WHERE data1 IS NOT NULL AND data1 >= :ini AND data1 < DATE_ADD(:fim, INTERVAL 1 DAY)
            AND TIMESTAMP(DATE(data1), hora) BETWEEN TIMESTAMP(:ini, :hi) AND TIMESTAMP(:fim, :hf)
          GROUP BY operador`
  },

  /* EXEMPLO de consulta de negócio (descomente e ajuste à sua tabela):
  ,ocorrencias: {
    titulo: 'Ocorrências por período',
    descricao: 'Ocorrências registradas no sistema local.',
    perfis: ['operacao', 'admin'],
    parametros: [
      { nome: 'ini', rotulo: 'De', tipo: 'data', obrigatorio: true },
      { nome: 'fim', rotulo: 'Até', tipo: 'data', obrigatorio: true }
    ],
    sql: `SELECT id, data, descricao FROM ocorrencias WHERE data BETWEEN :ini AND :fim ORDER BY data DESC`
  }
  */
};
