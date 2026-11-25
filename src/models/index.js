import Sequelize from "sequelize";
import pg from "pg";

import getUsuarioModel from "./usuario.js";
import getVisitaModel from "./visita.js";
import getVisitaFiscalizadorModel from "./visitaFiscalizador.js";
import getPerguntaQuestionarioModel from "./perguntaQuestionario.js";
import getRespostaQuestionarioModel from "./respostaQuestionario.js";
import getDocumentoModel from "./documento.js";
import getAssinaturaModel from "./assinatura.js";
import getTokenRevogadoModel from "./tokenRevogado.js";

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: "postgres",
  dialectModule: pg,
});

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