import { waitUntil } from "@vercel/functions";
import assinaturaService from "../services/assinaturaService.js";
import documentoService from "../services/documentoService.js";
import tratarErro from "../utils/tratarErro.js";

const ID_VALIDO = /^[1-9]\d{0,9}$/;

const responderDocumentoNaoEncontrado = (res) =>
  res.status(404).json({
    mensagem: "Documento não encontrado",
  });

const mensagemDaFalha = (erro) => {
  if (erro.name === "ValidacaoError") return erro.message;
  if (erro.name === "StorageError" || erro.name === "StorageConfiguracaoError") {
    return "Armazenamento indisponível. Tente finalizar novamente em instantes.";
  }
  return "Não foi possível gerar o PDF. Tente finalizar novamente.";
};

const finalizarDocumento = async (documentoId) => {
  try {
    return await documentoService.finalizar(documentoId);
  } catch (erro) {
    console.error("Falha ao finalizar o documento:", documentoId, erro.codigo ?? erro.name, erro.message);

    return {
      situacao: "erro",
      documento_id: documentoId,
      mensagem: mensagemDaFalha(erro),
      ...(erro.assinatura_id ? { assinatura_id: erro.assinatura_id } : {}),
    };
  }
};

const registrar = async (req, res) => {
  try {
    const assinatura = await assinaturaService.registrar(req.params.id, req.body, req.usuario);

    if (!assinatura) return responderDocumentoNaoEncontrado(res);

    const { email_pendente: emailPendente, ...finalizacao } = await finalizarDocumento(
      assinatura.documento_id
    );

    if (emailPendente) {
      waitUntil(
        documentoService.enviarEmail(assinatura.documento_id).catch((erro) =>
          console.error("Falha no envio do e-mail após a assinatura:", erro.message)
        )
      );
    }

    const dados = assinatura.toJSON?.() ?? assinatura;

    return res.status(201).json({
      ...dados,
      finalizacao: emailPendente ? { ...finalizacao, envio_email: "em_andamento" } : finalizacao,
    });
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao registrar assinatura");
  }
};

const remover = async (req, res) => {
  try {
    if (!ID_VALIDO.test(req.params.assinaturaId)) {
      return res.status(400).json({ mensagem: "Id inválido" });
    }

    const removida = await assinaturaService.remover(
      Number(req.params.id),
      Number(req.params.assinaturaId),
      req.usuario
    );

    if (!removida) {
      return res.status(404).json({ mensagem: "Assinatura não encontrada" });
    }

    return res.status(204).send();
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao remover assinatura");
  }
};

const finalizar = async (req, res) => {
  try {
    const { email_pendente: emailPendente, ...resultado } =
      (await documentoService.finalizar(Number(req.params.id), { usuario: req.usuario })) ?? {};

    if (!resultado.situacao) return responderDocumentoNaoEncontrado(res);

    if (emailPendente) {
      resultado.enviado_email = await documentoService.enviarEmail(resultado.documento_id);
    }

    return res.status(200).json(resultado);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao finalizar documento");
  }
};

export default {
  registrar,
  remover,
  finalizar,
};
