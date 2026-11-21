import documentoService from "../services/documentoService.js";
import visitaService from "../services/visitaService.js";
import tratarErro from "../utils/tratarErro.js";
import { podeAcessarVisita, responderNaoEncontrada } from "../utils/acessoVisita.js";

const gerar = async (req, res) => {
  try {
    const visita = await visitaService.buscarParaAcesso(req.params.id);

    if (!visita || !podeAcessarVisita(req.usuario, visita)) {
      return responderNaoEncontrada(res);
    }

    const resultado = await documentoService.gerar(visita.id);

    if (!resultado) {
      return responderNaoEncontrada(res);
    }

    return res.status(resultado.criado ? 201 : 200).json(resultado.documento);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao gerar documento");
  }
};

export default {
  gerar,
};
