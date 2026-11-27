-- 008-refresh-tokens.sql
-- Tabela de refresh tokens para renovação e rotação de sessão.

CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expira_em TIMESTAMPTZ NOT NULL,
  usado_em TIMESTAMPTZ NULL,
  revogado_em TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT refresh_tokens_usuario_id_fkey
    FOREIGN KEY (usuario_id)
    REFERENCES public.usuarios (id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS refresh_tokens_usuario_id_idx
  ON public.refresh_tokens (usuario_id);