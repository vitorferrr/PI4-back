import { beforeEach, describe, expect, it, vi } from "vitest";
import tratarErro from "../utils/tratarErro.js";

const criarRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("tratarErro", () => {
  it("retorna 400 com lista de erros quando for SequelizeValidationError", () => {
    const res = criarRes();
    const erro = {
      name: "SequelizeValidationError",
      errors: [
        { message: "Campo nome é obrigatório" },
        { message: "E-mail inválido" },
      ],
    };

    tratarErro(res, erro, "Erro de validação");

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Erro de validação",
      erros: ["Campo nome é obrigatório", "E-mail inválido"],
    });
  });

  it("retorna 400 com mensagem padrão quando for SequelizeForeignKeyConstraintError", () => {
    const res = criarRes();
    const erro = {
      name: "SequelizeForeignKeyConstraintError",
    };

    tratarErro(res, erro, "Erro ao salvar");

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Registro relacionado informado não existe no sistema.",
    });
  });

  it("retorna 400 com mensagem customizada quando for SequelizeForeignKeyConstraintError", () => {
    const res = criarRes();
    const erro = {
      name: "SequelizeForeignKeyConstraintError",
    };

    tratarErro(res, erro, "Erro ao salvar", "Usuário não encontrado.");

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Usuário não encontrado.",
    });
  });

  it("retorna 500 para erros genéricos", () => {
    const res = criarRes();
    const erro = new Error("Falha inesperada");

    tratarErro(res, erro, "Erro interno");

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Erro interno",
    });
  });
});