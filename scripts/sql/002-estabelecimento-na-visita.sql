-- INT-03: dados do estabelecimento impressos no documento. O sync() não cria colunas em tabela existente: rodar no SQL Editor do Supabase.
ALTER TABLE visitas
  ADD COLUMN IF NOT EXISTS razao_social VARCHAR(255),
  ADD COLUMN IF NOT EXISTS nome_fantasia VARCHAR(255),
  ADD COLUMN IF NOT EXISTS endereco VARCHAR(255),
  ADD COLUMN IF NOT EXISTS bairro VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cep VARCHAR(255),
  ADD COLUMN IF NOT EXISTS telefone VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cnpj_cpf VARCHAR(255),
  ADD COLUMN IF NOT EXISTS atividade VARCHAR(255);
