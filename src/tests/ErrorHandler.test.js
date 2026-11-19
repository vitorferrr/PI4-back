import { beforeEach, describe, expect, it, vi } from "vitest";
import errorHandler, { criarErroHttp } from "../middlewares/errorHandler.js";

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

  it("retorna 400 com lista de erros para ValidacaoError e SequelizeValidationError", () => {
    const res = criarRes();
    const erro = {
      name: "SequelizeValidationError",
      message: "Dados inválidos",
      errors: [{ message: "Campo obrigatório" }],
    };

    errorHandler(erro, {}, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Dados inválidos",
      erros: ["Campo obrigatório"],
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
