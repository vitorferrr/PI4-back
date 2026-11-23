import assinaturaService from "../services/assinaturaService.js";
import tratarErro from "../utils/tratarErro.js";
import { podeAcessarVisita } from "../utils/acessoVisita.js";

const responderDocumentoNaoEncontrado = (res) =>
  res.status(404).json({
    mensagem: "Documento não encontrado",
  });

const registrar = async (req, res) => {
  try {
    const documento = await assinaturaService.buscarParaAcesso(req.params.id);

    if (!documento?.visita || !podeAcessarVisita(req.usuario, documento.visita)) {
      return responderDocumentoNaoEncontrado(res);
    }

    const assinatura = await assinaturaService.registrar(documento.id, req.body);

    if (!assinatura) {
      return responderDocumentoNaoEncontrado(res);
    }

    return res.status(201).json(assinatura);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao registrar assinatura");
  }
};

export default {
  registrar,
};
