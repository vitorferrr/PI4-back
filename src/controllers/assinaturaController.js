import { waitUntil } from "@vercel/functions";
import assinaturaService from "../services/assinaturaService.js";
import documentoService from "../services/documentoService.js";
import AppError from "../utils/appError.js";

const ID_VALIDO = /^[1-9]\d{0,9}$/;

const erroDocumentoNaoEncontrado = () =>
  new AppError("Documento não encontrado", 404);

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
  const assinatura = await assinaturaService.registrar(req.params.id, req.body, req.usuario);

  if (!assinatura) throw erroDocumentoNaoEncontrado();

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
};

const remover = async (req, res) => {
  if (!ID_VALIDO.test(req.params.assinaturaId)) {
    throw new AppError("Id inválido", 400);
  }

  const removida = await assinaturaService.remover(
    Number(req.params.id),
    Number(req.params.assinaturaId),
    req.usuario
  );

  if (!removida) {
    throw new AppError("Assinatura não encontrada", 404);
  }

  return res.status(204).send();
};

const finalizar = async (req, res) => {
  let finalizacao;

  try {
    finalizacao = await documentoService.finalizar(Number(req.params.id), { usuario: req.usuario });
  } catch (erro) {
    // O app usa o assinatura_id para pedir a assinatura de novo; o errorHandler
    // global não conhece esse campo, então este caso é respondido aqui.
    if (erro.assinatura_id) {
      return res.status(400).json({
        mensagem: "Erro ao finalizar documento",
        erros: [erro.message],
        assinatura_id: erro.assinatura_id,
      });
    }

    throw erro;
  }

  const { email_pendente: emailPendente, ...resultado } = finalizacao ?? {};

  if (!resultado.situacao) throw erroDocumentoNaoEncontrado();

  if (emailPendente) {
    const envio = await documentoService.enviarEmail(resultado.documento_id);

    resultado.enviado_email = envio === "enviado";
    if (envio === "em_andamento") resultado.envio_email = "em_andamento";
  }

  return res.status(200).json(resultado);
};

export default {
  registrar,
  remover,
  finalizar,
};
