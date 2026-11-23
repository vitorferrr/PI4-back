-- INT-03: matrícula do fiscal impressa no documento. O sync() não cria colunas em tabela existente: rodar no SQL Editor do Supabase.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS matricula VARCHAR(255);
