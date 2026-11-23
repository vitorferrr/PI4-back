import nodemailer from "nodemailer";
import erroValidacao from "../utils/erroValidacao.js";

const EMAIL_VALIDO = /^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]+$/;
const TEMPO_LIMITE_MS = 10_000;

let transporteAtual;
let configuracaoAtual;

const erroEmail = (codigo, mensagem) => {
  const erro = new Error(mensagem);
  erro.name = "EmailError";
  erro.codigo = codigo;
  return erro;
};

const emailValido = (valor) => typeof valor === "string" && EMAIL_VALIDO.test(valor);

const lerConfiguracao = () => {
  const host = process.env.SMTP_HOST?.trim();
  const porta = Number(process.env.SMTP_PORT?.trim() || 465);
  const usuario = process.env.SMTP_USER?.trim();
  const senha = process.env.SMTP_PASS?.trim();
  const remetente = process.env.EMAIL_REMETENTE?.trim() || usuario;
  const destinoTeste = process.env.EMAIL_DESTINO_TESTE?.trim() || null;

  if (
    !host || !Number.isInteger(porta) || porta < 1 || porta > 65535 ||
    !usuario || !senha || !remetente ||
    (destinoTeste && !emailValido(destinoTeste))
  ) {
    throw erroEmail("EMAIL_CONFIGURACAO_INVALIDA", "Configuração de e-mail ausente ou inválida.");
  }

  return { host, porta, usuario, senha, remetente, destinoTeste };
};

const obterTransporte = (config) => {
  const mudou = ["host", "porta", "usuario", "senha"].some(
    (campo) => configuracaoAtual?.[campo] !== config[campo]
  );

  if (mudou) {
    transporteAtual = nodemailer.createTransport({
      host: config.host,
      port: config.porta,
      secure: config.porta === 465,
      requireTLS: config.porta !== 465,
      auth: { user: config.usuario, pass: config.senha },
      dnsTimeout: TEMPO_LIMITE_MS,
      connectionTimeout: TEMPO_LIMITE_MS,
      greetingTimeout: TEMPO_LIMITE_MS,
      socketTimeout: TEMPO_LIMITE_MS,
    });
    configuracaoAtual = config;
  }

  return transporteAtual;
};

const validarAnexos = (anexos) => {
  if (!Array.isArray(anexos)) throw erroValidacao("Os anexos do e-mail são inválidos");

  return anexos.map(({ nome, conteudo, tipo } = {}) => {
    if (typeof nome !== "string" || !nome.trim() || !Buffer.isBuffer(conteudo) || !conteudo.length) {
      throw erroValidacao("Os anexos do e-mail são inválidos");
    }
    return { filename: nome, content: conteudo, contentType: tipo };
  });
};

export const enviarEmail = async ({ para, assunto, texto, html, anexos = [] } = {}) => {
  const destinatario = typeof para === "string" ? para.trim() : para;

  if (!emailValido(destinatario)) throw erroValidacao("Informe um e-mail de destino válido");
  if (typeof assunto !== "string" || !assunto.trim()) {
    throw erroValidacao("O assunto do e-mail é obrigatório");
  }
  if (!texto && !html) throw erroValidacao("O e-mail precisa de conteúdo");

  const anexosValidos = validarAnexos(anexos);
  const config = lerConfiguracao();
  const transporte = obterTransporte(config);
  const enviarPara = config.destinoTeste ?? destinatario;

  try {
    const resultado = await transporte.sendMail({
      from: config.remetente,
      to: enviarPara,
      subject: config.destinoTeste ? `[TESTE para ${destinatario}] ${assunto}` : assunto,
      text: texto,
      html,
      attachments: anexosValidos,
    });

    return {
      id: resultado?.messageId ?? null,
      destinatario: enviarPara,
      redirecionado: Boolean(config.destinoTeste),
    };
  } catch {
    throw erroEmail("EMAIL_ENVIO_FALHOU", "Não foi possível enviar o e-mail.");
  }
};

export const enviarDocumentoVisita = async ({ para, numero, estabelecimento, pdf } = {}) => {
  const identificacao = String(numero ?? "").replace(/[^A-Za-z0-9-]/g, "");

  if (!identificacao) throw erroValidacao("O número do documento é obrigatório");

  const local = typeof estabelecimento === "string" && estabelecimento.trim()
    ? ` no estabelecimento ${estabelecimento.trim()}`
    : "";

  return await enviarEmail({
    para,
    assunto: `PROCON Jaboatão - Documento de fiscalização nº ${identificacao}`,
    texto: [
      "Prezado(a) responsável,",
      "",
      `Segue em anexo o documento da fiscalização realizada pelo PROCON Jaboatão dos Guararapes${local}.`,
      "",
      "Este é um e-mail automático; não é necessário respondê-lo.",
    ].join("\n"),
    anexos: [
      {
        nome: `documento-fiscalizacao-${identificacao}.pdf`,
        conteudo: pdf,
        tipo: "application/pdf",
      },
    ],
  });
};

export default { enviarEmail, enviarDocumentoVisita };
