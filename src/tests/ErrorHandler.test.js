import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import errorHandler from "../middlewares/errorHandler.js";
import { criarErroHttp } from "../utils/tratarErro.js";
import AppError from "../utils/appError.js";

const criarRes = () => {
  const res = { headersSent: false };
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("errorHandler", () => {
  it("retorna 401 padronizado para AutenticacaoError, erros de JWT ou status 401", () => {
    const erros = [
      Object.assign(new Error("Email ou senha inválidos"), {
        name: "AutenticacaoError",
      }),
      Object.assign(new Error("jwt malformed"), { name: "JsonWebTokenError" }),
      Object.assign(new Error("jwt expired"), { name: "TokenExpiredError" }),
      criarErroHttp(401, "Token não informado"),
    ];

    for (const erro of erros) {
      const res = criarRes();
      errorHandler(erro, {}, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ mensagem: erro.message });
    }
  });

  it("retorna 403 padronizado para AutorizacaoError ou status 403", () => {
    const res1 = criarRes();
    const erroSemMensagem = Object.assign(new Error(""), {
      name: "AutorizacaoError",
    });

    errorHandler(erroSemMensagem, {}, res1, vi.fn());

    expect(res1.status).toHaveBeenCalledWith(403);
    expect(res1.json).toHaveBeenCalledWith({
      mensagem: "Usuário não possui permissão para acessar este recurso",
    });

    const res2 = criarRes();
    errorHandler(criarErroHttp(403, "Acesso negado"), {}, res2, vi.fn());

    expect(res2.status).toHaveBeenCalledWith(403);
    expect(res2.json).toHaveBeenCalledWith({ mensagem: "Acesso negado" });
  });

  it("retorna 400 quando o JSON do corpo da requisição é inválido", () => {
    const res = criarRes();
    const erro = new SyntaxError("Unexpected token");
    erro.status = 400;
    erro.body = "{";

    errorHandler(erro, {}, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "JSON inválido no corpo da requisição",
    });
  });

  it("retorna 400 para SequelizeValidationError sem repetir a mensagem em erros", () => {
    const res = criarRes();
    const erro = {
      name: "SequelizeValidationError",
      message: "Dados inválidos",
      errors: [{ message: "Campo obrigatório" }],
    };

    errorHandler(erro, {}, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Campo obrigatório",
    });
  });

  it("retorna 409 com 'Email já cadastrado' quando o erro único é de email", () => {
    const res = criarRes();

    errorHandler(
      { name: "SequelizeUniqueConstraintError", fields: { email: "a@b.com" } },
      {},
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Email já cadastrado",
    });
  });

  it("retorna 409 com 'Registro duplicado' quando o erro único é de outra tabela", () => {
    const res = criarRes();

    errorHandler(
      { name: "SequelizeUniqueConstraintError", fields: { visita_id: 10 } },
      {},
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Registro duplicado",
    });
  });

  it("retorna 400 para SequelizeForeignKeyConstraintError", () => {
    const res = criarRes();

    errorHandler(
      { name: "SequelizeForeignKeyConstraintError" },
      {},
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Registro relacionado informado não existe no sistema.",
    });
  });

  it("retorna status 4xx criado via criarErroHttp", () => {
    const res = criarRes();

    errorHandler(criarErroHttp(404, "Visita não encontrada"), {}, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Visita não encontrada",
    });
  });

  it("retorna 500 sem expor detalhes de erros inesperados", () => {
    const res = criarRes();

    errorHandler(new Error("segredo do banco"), {}, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Erro interno do servidor",
    });
  });

  it("retorna 400 só com as mensagens do Zod, sem lista repetida", () => {
    const schema = z.object({
      body: z.object({
        email: z.email("Formato de e-mail inválido"),
        senha: z.string("Campo obrigatório"),
      }),
    });
    const { error } = schema.safeParse({ body: { email: "x" } });
    const res = criarRes();

    errorHandler(error, {}, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Formato de e-mail inválido; Campo obrigatório",
    });
  });

  it("não repete a mesma mensagem do Zod quando vários campos falham igual", () => {
    const schema = z.object({
      body: z.object({
        nome: z.string("Campo obrigatório"),
        senha: z.string("Campo obrigatório"),
      }),
    });
    const { error } = schema.safeParse({ body: {} });
    const res = criarRes();

    errorHandler(error, {}, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Campo obrigatório",
    });
  });

  it("usa o statusCode e a mensagem da AppError", () => {
    const res = criarRes();

    errorHandler(new AppError("Visita não encontrada", 404), {}, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ mensagem: "Visita não encontrada" });
  });

  it("retorna 400 quando o banco recusa o formato do ID (22P02)", () => {
    const res = criarRes();

    errorHandler(
      { name: "SequelizeDatabaseError", original: { code: "22P02" } },
      {},
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Identificador (ID) fornecido possui formato inválido.",
    });
  });

  it("retorna 400 quando um campo passa do tamanho da coluna (22001)", () => {
    const res = criarRes();

    errorHandler(
      { name: "SequelizeDatabaseError", original: { code: "22001" } },
      {},
      res,
      vi.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Um ou mais campos excedem o tamanho máximo permitido.",
    });
  });

  it("retorna 413 quando o corpo passa do limite", () => {
    const res = criarRes();

    errorHandler({ type: "entity.too.large", status: 413 }, {}, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "O corpo da requisição deve ter no máximo 1 MB",
    });
  });

  it("tira de erros o item igual à mensagem e mantém os outros", () => {
    const res = criarRes();
    const erro = {
      name: "ValidacaoError",
      message: "A pergunta 3 não foi respondida",
      errors: [
        { message: "A pergunta 3 não foi respondida" },
        { message: "A pergunta 5 não foi respondida" },
      ],
    };

    errorHandler(erro, {}, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({
      mensagem: "A pergunta 3 não foi respondida",
      erros: ["A pergunta 5 não foi respondida"],
    });
  });

  describe("log em produção", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it.each([
      ["token vencido", new AppError("Token inválido ou expirado", 401)],
      ["rota inexistente", new AppError("Rota /x não encontrada no servidor.", 404)],
      ["validação do Zod", z.object({ a: z.string() }).safeParse({}).error],
    ])("não registra erro esperado (%s)", (_, erro) => {
      errorHandler(erro, {}, criarRes(), vi.fn());

      expect(console.error).not.toHaveBeenCalled();
    });

    it("registra AppError 5xx", () => {
      errorHandler(new AppError("Banco de dados indisponível", 503), {}, criarRes(), vi.fn());

      expect(console.error).toHaveBeenCalledWith("Error: Banco de dados indisponível");
    });

    it("registra erro inesperado (500)", () => {
      const erro = new Error("falha no banco");

      errorHandler(erro, {}, criarRes(), vi.fn());

      expect(console.error).toHaveBeenCalledWith(erro);
    });
  });

  it("repassa para next(erro) quando os headers já foram enviados", () => {
    const res = criarRes();
    res.headersSent = true;
    const next = vi.fn();
    const erro = new Error("falha");

    errorHandler(erro, {}, res, next);

    expect(next).toHaveBeenCalledWith(erro);
    expect(res.status).not.toHaveBeenCalled();
  });
});
