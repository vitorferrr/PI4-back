import "dotenv/config";
import cors from "cors";
import express from "express";
import { sequelize } from "./models/index.js";
import usuarioRoutes from "./routes/usuarioRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import visitaRoutes from "./routes/visitaRoutes.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

app.get("/", (req, res) => {
  return res.send("Servidor express executando...");
});

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