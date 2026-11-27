import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";
import { env } from "../config/index.js";
import { emailValido, erroValidacao } from "../utils/index.js";

const TEMPO_LIMITE_MS = 10_000;

let transporteAtual;
let configuracaoAtual;

const erroEmail = (codigo, mensagem) => {
  const erro = new Error(mensagem);
  erro.name = "EmailError";
  erro.codigo = codigo;
  return erro;
};

const lerConfiguracao = () => {
  const host = env.SMTP_HOST;
  const porta = env.SMTP_PORT;
  const usuario = env.SMTP_USER;
  const senha = env.SMTP_PASS;
  const remetente = env.EMAIL_REMETENTE || usuario;
  const destinoTeste = env.EMAIL_DESTINO_TESTE || null;
  const envioReal = env.EMAIL_ENVIO_REAL;

  if (
    !host || !Number.isInteger(porta) || porta < 1 || porta > 65535 ||
    !usuario || !senha || !remetente ||
    (destinoTeste && !emailValido(destinoTeste))
  ) {
    throw erroEmail("EMAIL_CONFIGURACAO_INVALIDA", "Configuração de e-mail ausente ou inválida.");
  }

  if (!destinoTeste && !envioReal) {
    throw erroEmail(
      "EMAIL_ENVIO_DESATIVADO",
      "Envio desativado: defina EMAIL_DESTINO_TESTE ou EMAIL_ENVIO_REAL=true."
    );
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

  return anexos.map(({ nome, conteudo, tipo, cid } = {}) => {
    if (typeof nome !== "string" || !nome.trim() || !Buffer.isBuffer(conteudo) || !conteudo.length) {
      throw erroValidacao("Os anexos do e-mail são inválidos");
    }
    return { filename: nome, content: conteudo, contentType: tipo, ...(cid && { cid }) };
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
  } catch (falha) {
    console.error(
      "Falha no envio SMTP:",
      falha?.code ?? "sem código",
      falha?.responseCode ?? "",
      falha?.command ?? ""
    );
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

const AVISO_ENGANO =
  "Se você não esperava este e-mail, avise o Procon Jaboatão para que o acesso seja cancelado.";

const PERFIS_SENHA = { admin: "administrador", gestor: "gestor", fiscalizador: "fiscalizador" };
const CID_FAIXA = "faixa-topo@constata";

let faixaTopo;
const lerFaixaTopo = () => {
  faixaTopo ??= readFileSync(new URL("../assets/email/faixa-topo.png", import.meta.url));
  return faixaTopo;
};

const escaparHtml = (texto) =>
  String(texto).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const htmlSenhaGerada = ({ titulo, apresentacao, senha }) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#F5F5F7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F7">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td style="font-size:0;line-height:0"><img src="cid:${CID_FAIXA}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>
<tr><td align="center" style="padding:40px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#FFFFFF;border-radius:18px">
<tr><td style="padding:40px 40px 36px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',Inter,system-ui,sans-serif;color:#1C1C1E;-webkit-font-smoothing:antialiased">
<p style="margin:0 0 22px;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:21px;line-height:1;text-transform:uppercase;color:#172F6E">Constata</p>
<h1 style="margin:0 0 22px;font-size:28px;font-weight:700;letter-spacing:-0.5px;line-height:1.2;color:#1C1C1E">${titulo}</h1>
<p style="margin:0 0 22px;font-size:16px;line-height:1.55;color:#3A3A3C">${apresentacao}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">
<tr><td align="center" style="padding:18px 16px;border-radius:12px;background:#F2F2F7;border:1px dashed #C7C7CC">
<p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:#6E6E73">Sua senha</p>
<p style="margin:0;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:26px;font-weight:600;letter-spacing:2px;color:#1C1C1E;user-select:all;-webkit-user-select:all">${senha}</p>
</td></tr>
</table>
<p style="margin:0 0 22px;font-size:14px;line-height:1.55;color:#6E6E73">Toque duas vezes na senha para selecionar e copiar. Entre com este e-mail no app, pelo celular, ou no painel, pelo navegador do computador.</p>
<div style="height:1px;line-height:1px;font-size:0;background:#E3E3E6;margin:0 0 22px">&nbsp;</div>
<p style="margin:0;font-size:13px;line-height:1.55;color:#8E8E93">Você vai entrar com este e-mail. ${AVISO_ENGANO}</p>
</td></tr>
</table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

export const enviarSenhaGerada = async ({ para, nome, quemCadastrou, role, senha, reenvio = false } = {}) => {
  const perfil = PERFIS_SENHA[role];

  if (!perfil) throw erroValidacao("Perfil inválido para o e-mail de acesso");
  if (typeof senha !== "string" || !senha) throw erroValidacao("A senha gerada é obrigatória");

  const primeiroNome = String(nome ?? "").trim().split(/\s+/)[0] || "servidor";
  const autor = String(quemCadastrou ?? "").trim() || "O administrador";
  const titulo = reenvio
    ? `Olá, ${primeiroNome}. Sua senha foi renovada.`
    : `Olá, ${primeiroNome}. Seu acesso está pronto.`;
  const apresentacao = reenvio
    ? `${autor} gerou uma nova senha para o seu acesso ao Constata, o sistema de visitas do Procon Jaboatão. A senha anterior deixou de valer.`
    : `${autor} cadastrou você como ${perfil} no Constata, o sistema de visitas do Procon Jaboatão. Sua senha de acesso já foi gerada.`;

  return await enviarEmail({
    para,
    assunto: reenvio ? "Constata - Sua nova senha de acesso" : "Constata - Seu acesso está pronto",
    texto: [
      titulo,
      "",
      apresentacao,
      "",
      `Sua senha: ${senha}`,
      "",
      "Entre com este e-mail no app, pelo celular, ou no painel, pelo navegador do computador.",
      "",
      `Você vai entrar com este e-mail. ${AVISO_ENGANO}`,
    ].join("\n"),
    html: htmlSenhaGerada({
      titulo: escaparHtml(titulo),
      apresentacao: escaparHtml(apresentacao),
      senha: escaparHtml(senha),
    }),
    anexos: [{ nome: "faixa-topo.png", conteudo: lerFaixaTopo(), tipo: "image/png", cid: CID_FAIXA }],
  });
};

export default { enviarEmail, enviarDocumentoVisita, enviarSenhaGerada };
