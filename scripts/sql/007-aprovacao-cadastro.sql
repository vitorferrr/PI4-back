-- DT-02: cadastro público fica pendente até um admin aprovar. Rodar no SQL Editor do Supabase ANTES do deploy.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS aprovado BOOLEAN NOT NULL DEFAULT true;
