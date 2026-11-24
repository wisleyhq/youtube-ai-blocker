-- Fila de vídeos enviados pela extensão, esperando o robô conferir
CREATE TABLE IF NOT EXISTS pendentes (
  id TEXT PRIMARY KEY,        -- ID do vídeo no YouTube (11 caracteres)
  recebido INTEGER NOT NULL   -- quando chegou (ms)
);
CREATE INDEX IF NOT EXISTS pendentes_recebido ON pendentes (recebido);

-- Limite de envios por pessoa e por dia (chave = hash do IP + dia; o IP não é guardado)
CREATE TABLE IF NOT EXISTS limites (
  chave TEXT NOT NULL,
  dia TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (chave, dia)
);
