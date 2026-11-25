-- INT-04: reserva do envio do e-mail, separada do enviado_email. Rodar no SQL Editor do Supabase antes do deploy.
ALTER TABLE documentos
  ADD COLUMN IF NOT EXISTS email_enviando_em TIMESTAMP WITH TIME ZONE;
