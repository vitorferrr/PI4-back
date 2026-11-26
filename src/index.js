import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { sequelize } from "./models/index.js";
import usuarioRoutes from "./routes/usuarioRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import visitaRoutes from "./routes/visitaRoutes.js";
import questionarioRoutes from "./routes/questionarioRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import documentoRoutes from "./routes/documentoRoutes.js";
import errorHandler from "./middlewares/errorHandler.js";

const app = express();

app.use(helmet());
app.use(
  cors({
    exposedHeaders: ["X-Total-Count", "X-Truncated", "Content-Disposition"],
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use((erro, req, res, next) => {
  if (erro.type === "entity.too.large") {
    return res.status(413).json({
      mensagem: "O corpo da requisição deve ter no máximo 1 MB",
    });
  }

  if (erro.type === "entity.parse.failed") {
    return res.status(400).json({
      mensagem: "JSON inválido no corpo da requisição",
    });
  }

  return next(erro);
});
app.use(async (req, res, next) => {
  try {
    await ready;
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

app.use(errorHandler);

const port = process.env.PORT || 3000;
const eraseDatabaseOnSync =
  process.env.ERASE_DATABASE_ON_SYNC === "true" && !process.env.VERCEL;

const ready = sequelize
  .sync({ force: eraseDatabaseOnSync })
  .then(() => {
    if (!process.env.VERCEL) {
      app.listen(port, () => console.log(`Servidor rodando na porta ${port}!`));
    }
  })
  .catch((erro) => {
    console.error("Erro ao conectar com o banco de dados:", erro.message);
    if (!process.env.VERCEL) process.exit(1);
    throw erro;
  });

ready.catch(() => {});

export { ready };
export default app;