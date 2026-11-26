import { documentoService } from "../services/index.js";
import { AppError, erroVisitaNaoEncontrada } from "../utils/index.js";

const gerar = async (req, res) => {
  const resultado = await documentoService.gerar(req.visita.id);

  if (!resultado) {
    throw erroVisitaNaoEncontrada();
  }

  return res.status(resultado.criado ? 201 : 200).json(resultado.documento);
};

const linkPdf = async (req, res) => {
  const resultado = await documentoService.gerarLinkPdf(req.params.id);

  if (!resultado) {
    throw new AppError("Documento não encontrado", 404);
  }

  if (!resultado.gerado) {
    throw new AppError("O PDF deste documento ainda não foi gerado", 409);
  }

  return res.status(200).json({ url: resultado.url, expira_em: resultado.expira_em });
};

export default {
  gerar,
  linkPdf,
};
