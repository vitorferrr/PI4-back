-- BE-22: documento criado antes do PDF (gerado na INT-04) e um por visita. O sync() não altera colunas: rodar no SQL Editor do Supabase.
ALTER TABLE documentos ALTER COLUMN url_arquivo_pdf DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS documentos_visita_id ON documentos (visita_id);