import Sequelize from "sequelize";
import pg from "pg";
import { env } from "../config/index.js";

import getUsuarioModel from "./usuario.js";
import getVisitaModel from "./visita.js";
import getVisitaFiscalizadorModel from "./visitaFiscalizador.js";
import getPerguntaQuestionarioModel from "./perguntaQuestionario.js";
import getRespostaQuestionarioModel from "./respostaQuestionario.js";
import getDocumentoModel from "./documento.js";
import getAssinaturaModel from "./assinatura.js";
import getTokenRevogadoModel from "./tokenRevogado.js";

const opcoesSequelize = {
  dialect: "postgres",
  dialectModule: pg,
};

// Sem DATABASE_URL, new Sequelize(undefined) quebra já no import, antes de o
// validarEnv() da subida mostrar a mensagem clara (DT-35). Sem a URL o Sequelize
// é criado sem conexão, e quem avisa e impede a subida é o validarEnv().
const sequelize = env.DATABASE_URL
  ? new Sequelize(env.DATABASE_URL, opcoesSequelize)
  : new Sequelize(opcoesSequelize);

const models = {
    Usuario: getUsuarioModel(sequelize, Sequelize),
    Visita: getVisitaModel(sequelize, Sequelize),
    VisitaFiscalizador: getVisitaFiscalizadorModel(sequelize, Sequelize),
    PerguntaQuestionario: getPerguntaQuestionarioModel(sequelize, Sequelize),
    RespostaQuestionario: getRespostaQuestionarioModel(sequelize, Sequelize),
    Documento: getDocumentoModel(sequelize, Sequelize),
    Assinatura: getAssinaturaModel(sequelize, Sequelize),
    TokenRevogado: getTokenRevogadoModel(sequelize, Sequelize),
};

Object.keys(models).forEach((key) => {
  if ("associate" in models[key]) {
    models[key].associate(models);
  }
});

export { sequelize };
export default models;