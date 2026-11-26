import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env, validarEnv } from "./config/index.js";
import { sequelize } from "./models/index.js";
import {
  adminRoutes,
  authRoutes,
  documentoRoutes,
  questionarioRoutes,
  usuarioRoutes,
  visitaRoutes,
} from "./routes/index.js";
import { errorHandler, notFoundMiddleware } from "./middlewares/index.js";

// DT-35: confere as variáveis antes de tudo. Local: mostra o que falta e encerra
// (process.exit lá embaixo). Na Vercel o processo não pode encerrar, então toda
// requisição responde 503 até a configuração ser corrigida.
let erroAmbiente = null;

try {
  validarEnv();
} catch (erro) {
  erroAmbiente = erro;
  console.error(erro.message);
}

const app = express();

app.use(helmet());
app.use(
  cors({
    exposedHeaders: ["X-Total-Count", "X-Truncated", "Content-Disposition"],
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(async (req, res, next) => {
  if (erroAmbiente) {
    return res.status(503).json({
      mensagem: "Servidor com configuração incompleta. Avise o responsável pelo deploy.",
    });
  }

  try {
    await conectarBanco();
    next();
  } catch {
    return res.status(503).json({
      mensagem: "Banco de dados indisponível",
    });
  }
});

app.use("/usuarios", usuarioRoutes);
app.use("/auth", authRoutes);
app.use("/visitas", visitaRoutes);
app.use("/questionario", questionarioRoutes);
app.use("/admin", adminRoutes);
app.use("/documentos", documentoRoutes);

app.get("/", (req, res) => {
  return res.send("Servidor express executando...");
});

app.use(notFoundMiddleware);

app.use(errorHandler);

const port = env.PORT;
const eraseDatabaseOnSync = env.ERASE_DATABASE_ON_SYNC && !env.VERCEL;

let conexao;

const conectarBanco = () => {
  conexao ??= sequelize.sync({ force: eraseDatabaseOnSync }).catch((erro) => {
    conexao = undefined;
    console.error("Erro ao conectar com o banco de dados:", erro.message);
    throw erro;
  });

  return conexao;
};

const ready = (erroAmbiente ? Promise.reject(erroAmbiente) : conectarBanco())
  .then(() => {
    if (!env.VERCEL) {
      app.listen(port, () => console.log(`Servidor rodando na porta ${port}!`));
    }
  })
  .catch((erro) => {
    if (!env.VERCEL) process.exit(1);
    throw erro;
  });

ready.catch(() => {});

export { ready };
export default app;