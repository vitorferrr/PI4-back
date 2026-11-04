import "dotenv/config";
import cors from "cors";
import express from "express";
import { sequelize } from "./models/index.js";
import usuarioRoutes from "./routes/usuarioRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import visitaRoutes from "./routes/visitaRoutes.js";
import questionarioRoutes from "./routes/questionarioRoutes.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/usuarios", usuarioRoutes);
app.use("/auth", authRoutes);
app.use("/visitas", visitaRoutes);
app.use("/questionario", questionarioRoutes);

app.get("/", (req, res) => {
  return res.send("Servidor express executando...");
});

const port = process.env.PORT || 3000;
const eraseDatabaseOnSync = process.env.ERASE_DATABASE_ON_SYNC === "true";

sequelize
  .sync({ force: eraseDatabaseOnSync })
  .then(() => {
    app.listen(port, () => console.log(`Servidor rodando na porta ${port}!`));
  })
  .catch((erro) => {
    console.error("Erro ao conectar com o banco de dados:", erro.message);
    process.exit(1);
  });