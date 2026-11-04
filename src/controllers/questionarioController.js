import questionarioService from "../services/questionarioService.js";

const listar = async (req, res) => {
  try {
    const perguntas = await questionarioService.listar();

    return res.status(200).json(perguntas);
  } catch (erro) {
    console.error(erro);

    return res.status(500).json({
      mensagem: "Erro ao listar questionário",
    });
  }
};

export default {
  listar,
};
