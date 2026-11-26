import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import usuarioRoutes from "../routes/usuarioRoutes.js";
import usuarioService from "../services/usuarioService.js";
import errorHandler from "../middlewares/errorHandler.js";
import AppError from "../utils/appError.js";

vi.mock("../services/authService.js", () => ({ default: { tokenRevogado: vi.fn(async () => false) } }));
vi.mock("../services/usuarioService.js", () => ({
  default: {
    criarComSenhaGerada: vi.fn(),
    listar: vi.fn(),
    buscarPorId: vi.fn(),
    atualizar: vi.fn(),
    remover: vi.fn(),
    aprovar: vi.fn(),
    reprovar: vi.fn(),
    reenviarSenha: vi.fn(),
  },
}));

const SEGREDO = "segredo-de-teste";
const usuarioFalso = { id: 1, nome: "Bia", email: "bia@exemplo.com", role: "fiscalizador" };

let servidor;
let urlBase;

const tokenDe = (role, id = 1) => jwt.sign({ id, role }, SEGREDO);

const requisitar = (metodo, caminho, role, corpo) =>
  fetch(`${urlBase}${caminho}`, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      ...(role && { Authorization: `Bearer ${tokenDe(role)}` }),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", SEGREDO);

  const app = express();
  app.use(express.json());
  app.use("/usuarios", usuarioRoutes);
  app.use(errorHandler);

  await new Promise((resolve) => {
    servidor = app.listen(0, resolve);
  });
  urlBase = `http://127.0.0.1:${servidor.address().port}/usuarios`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => servidor.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(usuarioService).forEach((metodo) => metodo.mockResolvedValue(usuarioFalso));
});

const rotas = [
  ["POST", "", "criarComSenhaGerada", ["admin"], ["gestor", "fiscalizador"]],
  ["GET", "", "listar", ["admin", "gestor"], ["fiscalizador"]],
  ["GET", "/1", "buscarPorId", ["admin"], ["gestor", "fiscalizador"]],
  ["PUT", "/1", "atualizar", ["admin"], ["gestor", "fiscalizador"]],
  ["DELETE", "/1", "remover", ["admin"], ["gestor", "fiscalizador"]],
  ["PATCH", "/1/aprovar", "aprovar", ["admin"], ["gestor", "fiscalizador"]],
  ["PATCH", "/1/reprovar", "reprovar", ["admin"], ["gestor", "fiscalizador"]],
  ["POST", "/1/reenviar-senha", "reenviarSenha", ["admin"], ["gestor", "fiscalizador"]],
];

describe.each(rotas)("%s /usuarios%s", (metodo, caminho, funcaoService, permitidos, bloqueados) => {
  const corpo =
    metodo === "POST"
      ? { nome: "Bia", email: "bia@exemplo.com", role: "fiscalizador" }
      : metodo === "PUT"
        ? { nome: "Bia" }
        : undefined;

  it.each(permitidos)("permite acesso para %s", async (role) => {
    const resposta = await requisitar(metodo, caminho, role, corpo);

    expect(resposta.status).toBeLessThan(300);
    expect(usuarioService[funcaoService]).toHaveBeenCalledTimes(1);
  });

  it.each(bloqueados)("responde 403 para %s sem chamar o service", async (role) => {
    const resposta = await requisitar(metodo, caminho, role, corpo);

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({
      mensagem: "Usuário não possui permissão para acessar este recurso",
    });
    expect(usuarioService[funcaoService]).not.toHaveBeenCalled();
  });

  it("responde 401 sem token e não chama o service", async () => {
    const resposta = await requisitar(metodo, caminho, undefined, corpo);

    expect(resposta.status).toBe(401);
    expect(usuarioService[funcaoService]).not.toHaveBeenCalled();
  });
});

describe("POST /usuarios (respostas do controller)", () => {
  const novoUsuario = { nome: "Bia", email: "bia@exemplo.com", role: "fiscalizador" };

  const criarErro = (name, extras = {}) =>
    Object.assign(new Error("erro do service"), { name, ...extras });

  it("responde 201 com o usuário criado e repassa o corpo e o admin ao service", async () => {
    const resposta = await requisitar("POST", "", "admin", novoUsuario);

    expect(resposta.status).toBe(201);
    expect(await resposta.json()).toEqual(usuarioFalso);
    expect(usuarioService.criarComSenhaGerada).toHaveBeenCalledWith(novoUsuario, 1);
  });

  it("aceita corpo com senha e deixa o service gerar a dele", async () => {
    const resposta = await requisitar("POST", "", "admin", { ...novoUsuario, senha: "123456" });

    expect(resposta.status).toBe(201);
    expect(usuarioService.criarComSenhaGerada).toHaveBeenCalledWith({ ...novoUsuario, senha: "123456" }, 1);
  });

  it("responde 503 quando o e-mail com a senha não sai", async () => {
    usuarioService.criarComSenhaGerada.mockRejectedValue(
      new AppError("Não foi possível enviar o e-mail com a senha. O usuário não foi cadastrado; tente novamente.", 503)
    );

    const resposta = await requisitar("POST", "", "admin", novoUsuario);

    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual({
      mensagem: "Não foi possível enviar o e-mail com a senha. O usuário não foi cadastrado; tente novamente.",
    });
  });

  it("responde 409 quando o banco acusa email duplicado", async () => {
    usuarioService.criarComSenhaGerada.mockRejectedValue(
      criarErro("SequelizeUniqueConstraintError", { fields: { email: novoUsuario.email } })
    );

    const resposta = await requisitar("POST", "", "admin", novoUsuario);

    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual({ mensagem: "Email já cadastrado" });
  });

  it("responde 400 quando o service rejeita os dados", async () => {
    usuarioService.criarComSenhaGerada.mockRejectedValue(
      Object.assign(new Error("A senha é obrigatória"), { name: "ValidacaoError" })
    );

    const resposta = await requisitar("POST", "", "admin", novoUsuario);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "A senha é obrigatória",
    });
  });

  it("responde 400 com a lista de erros de validação do Sequelize", async () => {
    usuarioService.criarComSenhaGerada.mockRejectedValue(
      criarErro("SequelizeValidationError", {
        errors: [{ message: "email inválido" }, { message: "Role deve ser admin, gestor ou fiscalizador" }],
      })
    );

    const resposta = await requisitar("POST", "", "admin", novoUsuario);

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "email inválido, Role deve ser admin, gestor ou fiscalizador",
    });
  });
});

describe("POST /usuarios/:id/reenviar-senha (respostas do controller)", () => {
  it("responde 200 com o usuário e repassa o id e o admin ao service", async () => {
    const resposta = await requisitar("POST", "/7/reenviar-senha", "admin");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(usuarioFalso);
    expect(usuarioService.reenviarSenha).toHaveBeenCalledWith("7", 1);
  });

  it("responde 404 quando o usuário não existe", async () => {
    usuarioService.reenviarSenha.mockResolvedValue(null);

    const resposta = await requisitar("POST", "/99/reenviar-senha", "admin");

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ mensagem: "Usuário não encontrado" });
  });

  it("responde 503 quando o e-mail com a nova senha não sai", async () => {
    usuarioService.reenviarSenha.mockRejectedValue(
      new AppError("Não foi possível enviar o e-mail com a nova senha. A senha anterior continua valendo; tente novamente.", 503)
    );

    const resposta = await requisitar("POST", "/7/reenviar-senha", "admin");

    expect(resposta.status).toBe(503);
  });

  it("responde 400 quando o cadastro não está aprovado", async () => {
    usuarioService.reenviarSenha.mockRejectedValue(
      Object.assign(new Error("Este cadastro não está aprovado. Aprove o usuário antes de reenviar a senha."), {
        name: "ValidacaoError",
      })
    );

    const resposta = await requisitar("POST", "/7/reenviar-senha", "admin");

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "Este cadastro não está aprovado. Aprove o usuário antes de reenviar a senha.",
    });
  });

  it("responde 400 para id inválido sem chamar o service", async () => {
    const resposta = await requisitar("POST", "/abc/reenviar-senha", "admin");

    expect(resposta.status).toBe(400);
    expect(usuarioService.reenviarSenha).not.toHaveBeenCalled();
  });
});

describe("GET /usuarios (respostas do controller)", () => {
  it("responde 200 com a lista do service", async () => {
    usuarioService.listar.mockResolvedValue([usuarioFalso]);

    const resposta = await requisitar("GET", "", "gestor");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([usuarioFalso]);
  });

  it.each([
    ["admin", "", undefined],
    ["admin", "?aprovado=false", false],
    ["admin", "?aprovado=true", true],
    ["gestor", "", true],
    ["gestor", "?aprovado=true", true],
  ])("%s com %s filtra aprovado = %s", async (role, query, aprovado) => {
    usuarioService.listar.mockResolvedValue([]);

    const resposta = await requisitar("GET", query, role);

    expect(resposta.status).toBe(200);
    expect(usuarioService.listar).toHaveBeenCalledWith({ aprovado });
  });

  it("gestor pedindo pendentes recebe lista vazia", async () => {
    const resposta = await requisitar("GET", "?aprovado=false", "gestor");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([]);
    expect(usuarioService.listar).not.toHaveBeenCalled();
  });

  it.each(["?aprovado=sim", "?aprovado=1", "?aprovado=FALSE"])(
    "responde 400 para filtro inválido (%s)",
    async (query) => {
      const resposta = await requisitar("GET", query, "admin");

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({
        mensagem: "aprovado deve ser true ou false",
      });
      expect(usuarioService.listar).not.toHaveBeenCalled();
    }
  );
});

describe("PATCH /usuarios/:id/reprovar (respostas do controller)", () => {
  it("responde 200 com o usuário reprovado", async () => {
    const resposta = await requisitar("PATCH", "/1/reprovar", "admin");

    expect(resposta.status).toBe(200);
    expect(usuarioService.reprovar).toHaveBeenCalledWith("1");
  });

  it("responde 400 quando o usuário não é fiscalizador", async () => {
    usuarioService.reprovar.mockRejectedValue(
      Object.assign(new Error("Só cadastros de fiscalizador podem ser reprovados"), {
        name: "ValidacaoError",
      })
    );

    const resposta = await requisitar("PATCH", "/1/reprovar", "admin");

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "Só cadastros de fiscalizador podem ser reprovados",
    });
  });

  it("responde 404 quando o usuário não existe", async () => {
    usuarioService.reprovar.mockResolvedValue(null);

    const resposta = await requisitar("PATCH", "/99/reprovar", "admin");

    expect(resposta.status).toBe(404);
  });
});

describe("PATCH /usuarios/:id/aprovar (respostas do controller)", () => {
  it("responde 200 com o usuário aprovado", async () => {
    const resposta = await requisitar("PATCH", "/1/aprovar", "admin");

    expect(resposta.status).toBe(200);
    expect(usuarioService.aprovar).toHaveBeenCalledWith("1");
  });

  it("responde 404 quando o usuário não existe", async () => {
    usuarioService.aprovar.mockResolvedValue(null);

    const resposta = await requisitar("PATCH", "/99/aprovar", "admin");

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ mensagem: "Usuário não encontrado" });
  });

  it("responde 400 para id inválido sem chamar o service", async () => {
    const resposta = await requisitar("PATCH", "/abc/aprovar", "admin");

    expect(resposta.status).toBe(400);
    expect(usuarioService.aprovar).not.toHaveBeenCalled();
  });
});

describe("GET /usuarios/:id (respostas do controller)", () => {
  it("responde 200 com o usuário e repassa o id ao service", async () => {
    const resposta = await requisitar("GET", "/1", "admin");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(usuarioFalso);
    expect(usuarioService.buscarPorId).toHaveBeenCalledWith("1");
  });

  it("responde 404 quando o usuário não existe", async () => {
    usuarioService.buscarPorId.mockResolvedValue(null);

    const resposta = await requisitar("GET", "/99", "admin");

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ mensagem: "Usuário não encontrado" });
  });
});

describe("PUT /usuarios/:id (respostas do controller)", () => {
  it("responde 200 com o usuário atualizado e repassa id e corpo ao service", async () => {
    const resposta = await requisitar("PUT", "/1", "admin", { nome: "Beatriz" });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(usuarioFalso);
    expect(usuarioService.atualizar).toHaveBeenCalledWith("1", { nome: "Beatriz" });
  });

  it("responde 404 quando o usuário não existe", async () => {
    usuarioService.atualizar.mockResolvedValue(null);

    const resposta = await requisitar("PUT", "/99", "admin", { nome: "Beatriz" });

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ mensagem: "Usuário não encontrado" });
  });

  it("responde 409 ao trocar para um email que já existe", async () => {
    usuarioService.atualizar.mockRejectedValue(
      Object.assign(new Error("duplicado"), { name: "SequelizeUniqueConstraintError" })
    );

    const resposta = await requisitar("PUT", "/1", "admin", { email: "outro@exemplo.com" });

    expect(resposta.status).toBe(409);
  });
});

describe("DELETE /usuarios/:id (respostas do controller)", () => {
  it("responde 200 com o usuário removido e repassa o id ao service", async () => {
    const resposta = await requisitar("DELETE", "/1", "admin");

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(usuarioFalso);
    expect(usuarioService.remover).toHaveBeenCalledWith("1");
  });

  it("responde 404 quando o usuário não existe", async () => {
    usuarioService.remover.mockResolvedValue(null);

    const resposta = await requisitar("DELETE", "/99", "admin");

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ mensagem: "Usuário não encontrado" });
  });
});

describe.each([
  ["POST", "", "criarComSenhaGerada"],
  ["GET", "", "listar"],
  ["GET", "/1", "buscarPorId"],
  ["PUT", "/1", "atualizar"],
  ["DELETE", "/1", "remover"],
])("erro inesperado em %s /usuarios%s", (metodo, caminho, funcaoService) => {
  it("responde 500 sem expor o erro interno", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    usuarioService[funcaoService].mockRejectedValue(new Error("falha no banco"));
    const corpo =
      metodo === "POST"
        ? { nome: "Bia", email: "bia@exemplo.com", role: "fiscalizador" }
        : metodo === "PUT"
          ? { nome: "Bia" }
          : undefined;

    const resposta = await requisitar(metodo, caminho, "admin", corpo);

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ mensagem: "Erro interno do servidor" });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
