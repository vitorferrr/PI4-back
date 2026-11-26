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

const linkPdf = async (req, res) => {
  try {
    const resultado = await documentoService.gerarLinkPdf(req.params.id);

    if (!resultado) {
      return res.status(404).json({ mensagem: "Documento não encontrado" });
    }

    if (!resultado.gerado) {
      return res.status(409).json({ mensagem: "O PDF deste documento ainda não foi gerado" });
    }

    return res.status(200).json({ url: resultado.url, expira_em: resultado.expira_em });
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao abrir o PDF");
  }
};

export default {
  gerar,
  linkPdf,
};
