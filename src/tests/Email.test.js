import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";

vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));

let emailService;
const transporte = { sendMail: vi.fn() };
const pdf = Buffer.from("%PDF-1.3 teste");

const configurar = () => {
  vi.stubEnv("SMTP_HOST", "smtp.gmail.com");
  vi.stubEnv("SMTP_PORT", "465");
  vi.stubEnv("SMTP_USER", "procon.projeto@gmail.com");
  vi.stubEnv("SMTP_PASS", "senha-de-app-teste");
  vi.stubEnv("EMAIL_REMETENTE", "PROCON Jaboatão <procon.projeto@gmail.com>");
  vi.stubEnv("EMAIL_DESTINO_TESTE", "");
};

const emailBase = {
  para: "responsavel@loja.com",
  assunto: "Assunto",
  texto: "Conteúdo",
};

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  configurar();
  nodemailer.createTransport.mockReturnValue(transporte);
  transporte.sendMail.mockResolvedValue({ messageId: "<id@gmail.com>" });
  emailService = (await import("../services/emailService.js")).default;
});

afterEach(() => vi.unstubAllEnvs());

describe("enviar e-mail", () => {
  it("envia pelo SMTP configurado com tempo limite e conexão segura na porta 465", async () => {
    const resultado = await emailService.enviarEmail(emailBase);

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: "procon.projeto@gmail.com", pass: "senha-de-app-teste" },
      dnsTimeout: 10_000,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
    expect(transporte.sendMail).toHaveBeenCalledWith({
      from: "PROCON Jaboatão <procon.projeto@gmail.com>",
      to: "responsavel@loja.com",
      subject: "Assunto",
      text: "Conteúdo",
      html: undefined,
      attachments: [],
    });
    expect(resultado).toEqual({
      id: "<id@gmail.com>",
      destinatario: "responsavel@loja.com",
      redirecionado: false,
    });
  });

  it("usa STARTTLS na porta 587 e o SMTP_USER como remetente padrão", async () => {
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("EMAIL_REMETENTE", "");

    await emailService.enviarEmail(emailBase);

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false, requireTLS: true })
    );
    expect(transporte.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "procon.projeto@gmail.com" })
    );
  });

  it("redireciona para EMAIL_DESTINO_TESTE e mostra o destinatário original no assunto", async () => {
    vi.stubEnv("EMAIL_DESTINO_TESTE", "equipe@teste.com");

    const resultado = await emailService.enviarEmail(emailBase);

    expect(transporte.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "equipe@teste.com",
        subject: "[TESTE para responsavel@loja.com] Assunto",
      })
    );
    expect(resultado).toMatchObject({ destinatario: "equipe@teste.com", redirecionado: true });
  });

  it("reaproveita o transporte enquanto a configuração não muda", async () => {
    await emailService.enviarEmail(emailBase);
    await emailService.enviarEmail(emailBase);
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);

    vi.stubEnv("SMTP_PASS", "outra-senha");
    await emailService.enviarEmail(emailBase);
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
  });

  it("converte os anexos para o formato do nodemailer", async () => {
    await emailService.enviarEmail({
      ...emailBase,
      anexos: [{ nome: "doc.pdf", conteudo: pdf, tipo: "application/pdf" }],
    });

    expect(transporte.sendMail.mock.calls[0][0].attachments).toEqual([
      { filename: "doc.pdf", content: pdf, contentType: "application/pdf" },
    ]);
  });

  it.each([
    [{ para: "sem-arroba" }, "Informe um e-mail de destino válido"],
    [{ para: undefined }, "Informe um e-mail de destino válido"],
    [{ para: "a,b@loja.com" }, "Informe um e-mail de destino válido"],
    [{ para: "a;b@loja.com" }, "Informe um e-mail de destino válido"],
    [{ para: "x<outro@loja.com>" }, "Informe um e-mail de destino válido"],
    [{ para: '"a"@loja.com' }, "Informe um e-mail de destino válido"],
    [{ assunto: "  " }, "O assunto do e-mail é obrigatório"],
    [{ texto: undefined }, "O e-mail precisa de conteúdo"],
    [{ anexos: [{ nome: "doc.pdf", conteudo: "texto" }] }, "Os anexos do e-mail são inválidos"],
    [{ anexos: [{ nome: "", conteudo: pdf }] }, "Os anexos do e-mail são inválidos"],
    [{ anexos: "doc.pdf" }, "Os anexos do e-mail são inválidos"],
  ])("rejeita dados inválidos sem enviar (%o)", async (alteracao, mensagem) => {
    await expect(emailService.enviarEmail({ ...emailBase, ...alteracao })).rejects.toMatchObject({
      name: "ValidacaoError",
      message: mensagem,
    });
    expect(transporte.sendMail).not.toHaveBeenCalled();
  });

  it.each([
    ["SMTP_HOST", ""],
    ["SMTP_USER", ""],
    ["SMTP_PASS", ""],
    ["SMTP_PORT", "porta"],
    ["SMTP_PORT", "70000"],
    ["EMAIL_DESTINO_TESTE", "invalido"],
  ])("rejeita configuração inválida em %s", async (variavel, valor) => {
    vi.stubEnv(variavel, valor);

    await expect(emailService.enviarEmail(emailBase)).rejects.toMatchObject({
      name: "EmailError",
      codigo: "EMAIL_CONFIGURACAO_INVALIDA",
    });
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it("não lê a configuração durante o import", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.resetModules();

    await expect(import("../services/emailService.js")).resolves.toBeDefined();
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it("esconde o erro do SMTP atrás de um erro genérico", async () => {
    transporte.sendMail.mockRejectedValue(
      new Error("535 Username and Password not accepted for procon.projeto@gmail.com")
    );

    const erro = await emailService.enviarEmail(emailBase).catch((e) => e);

    expect(erro).toMatchObject({ name: "EmailError", codigo: "EMAIL_ENVIO_FALHOU" });
    expect(erro.message).not.toContain("procon.projeto");
  });
});

describe("enviar documento da visita", () => {
  it("envia o PDF anexado com assunto e texto do PROCON", async () => {
    await emailService.enviarDocumentoVisita({
      para: "responsavel@loja.com",
      numero: 42,
      estabelecimento: "Mercado Bom Preço",
      pdf,
    });

    const enviado = transporte.sendMail.mock.calls[0][0];
    expect(enviado.subject).toBe("PROCON Jaboatão - Documento de fiscalização nº 42");
    expect(enviado.text).toContain("no estabelecimento Mercado Bom Preço.");
    expect(enviado.attachments).toEqual([
      { filename: "documento-fiscalizacao-42.pdf", content: pdf, contentType: "application/pdf" },
    ]);
  });

  it("omite o estabelecimento do texto quando não informado", async () => {
    await emailService.enviarDocumentoVisita({ para: "responsavel@loja.com", numero: 42, pdf });

    expect(transporte.sendMail.mock.calls[0][0].text).toContain(
      "realizada pelo PROCON Jaboatão dos Guararapes."
    );
  });

  it("limpa o número usado no nome do arquivo", async () => {
    await emailService.enviarDocumentoVisita({ para: "responsavel@loja.com", numero: "../42/2026", pdf });

    const enviado = transporte.sendMail.mock.calls[0][0];
    expect(enviado.attachments[0].filename).toBe("documento-fiscalizacao-422026.pdf");
  });

  it("rejeita documento sem número ou sem PDF", async () => {
    await expect(
      emailService.enviarDocumentoVisita({ para: "responsavel@loja.com", pdf })
    ).rejects.toThrow("O número do documento é obrigatório");
    await expect(
      emailService.enviarDocumentoVisita({ para: "responsavel@loja.com", numero: 42 })
    ).rejects.toThrow("Os anexos do e-mail são inválidos");
    expect(transporte.sendMail).not.toHaveBeenCalled();
  });
});
