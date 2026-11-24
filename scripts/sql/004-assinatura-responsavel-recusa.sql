-- BE-23: dados do responsável, recusa e uma assinatura por pessoa. O sync() não altera tabela existente: rodar no SQL Editor do Supabase.
ALTER TABLE assinaturas
  ALTER COLUMN imagem_assinatura_url DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios (id),
  ADD COLUMN IF NOT EXISTS assinante_documento VARCHAR(255),
  ADD COLUMN IF NOT EXISTS assinante_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS recusou BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_documento_fiscal ON assinaturas (documento_id, usuario_id) WHERE usuario_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_documento_responsavel ON assinaturas (documento_id) WHERE assinante_tipo = 'denunciado';
