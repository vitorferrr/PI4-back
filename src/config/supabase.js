import { createClient } from "@supabase/supabase-js";

const erroConfiguracao = () => {
  const erro = new Error("Configuração do Supabase Storage ausente ou inválida.");
  erro.name = "StorageConfiguracaoError";
  erro.codigo = "STORAGE_CONFIGURACAO_INVALIDA";
  return erro;
};

const ehChaveServidor = (chave) => {
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(chave)) return true;

  // Compatibilidade com service_role legado. A autenticidade é verificada pelo
  // Supabase; esta inspeção apenas rejeita chaves anon/publishable por engano.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(chave)) return false;
  try {
    const payload = JSON.parse(Buffer.from(chave.split(".")[1], "base64url"));
    return payload.role === "service_role";
  } catch {
    return false;
  }
};

// Não lê configuração nem cria cliente durante o import. As demais funções do
// backend continuam disponíveis quando o Storage não está configurado.
export const getStorageContext = () => {
  const url = process.env.SUPABASE_URL?.trim();
  const chave = process.env.SUPABASE_SECRET_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim();

  try {
    const endereco = new URL(url);
    if (
      endereco.protocol !== "https:" ||
      endereco.username || endereco.password || endereco.search || endereco.hash ||
      endereco.pathname !== "/" ||
      !chave || !ehChaveServidor(chave) ||
      !bucket || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(bucket)
    ) {
      throw erroConfiguracao();
    }

    const client = createClient(endereco.origin, chave, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    return { client, bucket };
  } catch {
    // Não propaga erros do SDK que possam carregar URL/chave fornecidas.
    throw erroConfiguracao();
  }
};
