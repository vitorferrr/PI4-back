import questionarioService from "../services/questionarioService.js";
import visitaService from "../services/visitaService.js";
import tratarErro from "../utils/tratarErro.js";

const listar = async (req, res) => {
  try {
    const perguntas = await questionarioService.listar();

    return res.status(200).json(perguntas);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao listar questionário");
  }
};

const salvarRespostas = async (req, res) => {
  try {
    const visita = await visitaService.buscarPorId(req.params.id);
    const atribuida = visita?.fiscalizadores?.some(
      (fiscalizador) => fiscalizador.id === req.usuario.id
    );

    if (!atribuida) {
      return res.status(404).json({
        mensagem: "Visita não encontrada",
      });
    }

    const respostas = await questionarioService.salvarRespostas(visita, req.body?.respostas);

    return res.status(200).json(respostas);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao salvar respostas");
  }
};

export default {
  listar,
  salvarRespostas,
};