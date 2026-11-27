import { z } from "zod";

// DT-35: variáveis de ambiente validadas com Zod.
//
// - validarEnv() roda uma vez na subida do servidor (src/index.js) e para tudo com
//   uma mensagem clara quando falta algo obrigatório ou algum valor é inválido.
// - env.X é lido do process.env ATUAL a cada acesso, já com o tipo convertido.
//   Não é uma cópia congelada porque o Storage (DT-51) e o e-mail releem a
//   configuração a cada uso, e os testes trocam variáveis com vi.stubEnv.
//
// Só DATABASE_URL e JWT_SECRET são obrigatórias. Supabase e SMTP continuam
// opcionais: o back sobe sem eles e cada serviço avisa ao ser usado.

const MENSAGEM_OBRIGATORIA = "é obrigatória";
const MENSAGEM_PORTA = "deve ser um número de porta entre 1 e 65535";

const textoObrigatorio = () =>
  z
    .string({ error: MENSAGEM_OBRIGATORIA })
    .refine((valor) => valor.trim().length > 0, MENSAGEM_OBRIGATORIA);

const textoOpcional = () => z.string().trim().optional();

// "true" liga; qualquer outro valor (ou ausência) desliga.
const flag = () =>
  z
    .string()
    .optional()
    .transform((valor) => valor?.trim() === "true");

const porta = (padrao) =>
  z
    .string()
    .trim()
    .optional()
    .transform((valor) => (valor ? Number(valor) : padrao))
    .pipe(z.number({ error: MENSAGEM_PORTA }).int(MENSAGEM_PORTA).min(1, MENSAGEM_PORTA).max(65535, MENSAGEM_PORTA));

export const esquemaEnv = z.object({
  // Obrigatórias
  // Vazia já cai em "é obrigatória"; o formato só é conferido quando há valor.
  DATABASE_URL: textoObrigatorio().refine(
    (valor) => !valor.trim() || /^postgres(ql)?:\/\//.test(valor.trim()),
    "deve ser uma URL do Postgres (postgres:// ou postgresql://)"
  ),
  JWT_SECRET: textoObrigatorio(),

  // Servidor
  PORT: porta(3000),
  NODE_ENV: z
    .string()
    .trim()
    .optional()
    .transform((valor) => valor || "development"),
  // A Vercel define VERCEL=1; qualquer valor preenchido conta como "rodando na Vercel".
  VERCEL: z
    .string()
    .optional()
    .transform((valor) => Boolean(valor?.trim())),
  ERASE_DATABASE_ON_SYNC: flag(),
  // DT-33: origens liberadas no CORS, separadas por vírgula (opcional; padrão em middlewares/cors.js)
  ALLOWED_ORIGINS: textoOpcional(),

  // INT-06: Storage (opcional; validado em config/supabase.js ao ser usado)
  SUPABASE_URL: textoOpcional(),
  SUPABASE_SECRET_KEY: textoOpcional(),
  SUPABASE_STORAGE_BUCKET: textoOpcional(),

  // INT-03: e-mail (opcional; validado em services/emailService.js ao ser usado)
  SMTP_HOST: textoOpcional(),
  SMTP_PORT: textoOpcional(),
  SMTP_USER: textoOpcional(),
  SMTP_PASS: textoOpcional(),
  EMAIL_REMETENTE: textoOpcional(),
  EMAIL_DESTINO_TESTE: textoOpcional(),
  EMAIL_ENVIO_REAL: flag(),

  // Usadas só por scripts/criarAdmin.js (npm run seed:admin)
  ADMIN_NOME: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_SENHA: z.string().optional(),
});

const campos = esquemaEnv.shape;

// Nunca inclui o valor da variável na mensagem, para não vazar segredos no log.
const descreverProblemas = (erro) =>
  erro.issues.map((problema) => `- ${problema.path.join(".")}: ${problema.message}`);

export const validarEnv = (fonte = process.env) => {
  const resultado = esquemaEnv.safeParse(fonte);

  if (resultado.success) return resultado.data;

  const problemas = descreverProblemas(resultado.error);
  const erro = new Error(
    [
      "Variáveis de ambiente ausentes ou inválidas:",
      ...problemas,
      "Confira o arquivo .env (modelo em .env.example) ou as variáveis do ambiente de deploy.",
    ].join("\n")
  );
  erro.name = "ConfiguracaoAmbienteError";
  erro.problemas = problemas;
  throw erro;
};

// Valor inválido ou ausente vira undefined aqui; quem barra é o validarEnv() na subida.
const lerCampo = (chave) => {
  const resultado = campos[chave].safeParse(process.env[chave]);
  return resultado.success ? resultado.data : undefined;
};

export const env = Object.freeze(
  Object.defineProperties(
    {},
    Object.fromEntries(
      Object.keys(campos).map((chave) => [chave, { enumerable: true, get: () => lerCampo(chave) }])
    )
  )
);
