import questionarioService from "../services/questionarioService.js";
import tratarErro from "../utils/tratarErro.js";

const listar = async (req, res) => {
  try {
    const perguntas = await questionarioService.listar();

    return res.status(200).json(perguntas);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao listar questionário");
  }
};

export default {
  listar,
};
