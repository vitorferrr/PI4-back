import models from "../models/index.js";

const { PerguntaQuestionario } = models;

const listar = async () => {
  return await PerguntaQuestionario.findAll({
    order: [["ordem", "ASC"]],
  });
};

export default {
  listar,
};
