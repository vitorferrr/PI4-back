-- DT-03: tokens encerrados pelo logout. Rodar no SQL Editor do Supabase.
CREATE TABLE IF NOT EXISTS tokens_revogados (
  id SERIAL PRIMARY KEY,
  jti VARCHAR(255) NOT NULL UNIQUE,
  expira_em TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_revogados_expira_em ON tokens_revogados (expira_em);
